import { GoogleGenAIClient } from '../provider/googleGenAIClient.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { promptManagerService } from './PromptManagerService.js';

interface GenerateRoadmapInput {
    userId: string;
    userPrompt: string;
    targetScore: number;
    studyTimePerDay: number;
    studyDaysPerWeek: number;
    userPreferences?: {
        primaryGoal?: string;
        currentLevel?: string;
        preferredStudyTime?: string;
        contentInterests?: string[];
        studyDaysOfWeek?: number[];
    };
    testAnalysis?: {
        score: number;
        weaknesses: unknown[];
        strengths: string[];
        summary: string;
        domainsPerformance?: unknown[];
    };
    providedWeaknesses?: unknown[];
    todayDayOfWeek?: number;
}

interface GenerateRoadmapOutput {
    currentLevel: string;
    learningStrategy: {
        foundationFocus: number;
        domainFocus: number;
    };
    totalWeeks: number;
    phaseSummary?: unknown;
    weeklyFocuses: Array<{
        weekNumber: number;
        title: string;
        summary: string;
        focusSkills: string[];
        targetWeaknesses: Array<{
            skillKey: string;
            skillName: string;
            severity: string;
            category: string;
            userAccuracy: number;
        }>;
        recommendedDomains: string[];
        foundationWeight: number;
        expectedProgress: number;
        dailyFocuses?: Array<{
            dayNumber: number;
            dayOfWeek: number;
            focus: string;
            targetSkills: string[];
            suggestedDomains: string[];
            foundationWeight: number;
            estimatedMinutes: number;
            status: string;
            scheduledDate: null;
        }>;
    }>;
}

export class LearningPlanAIService {
    private llmClient: GoogleGenAIClient;

    constructor() {
        this.llmClient = new GoogleGenAIClient();
    }

    async generateLearningRoadmap(
        input: GenerateRoadmapInput
    ): Promise<GenerateRoadmapOutput> {
        const prompt = await this.buildRoadmapPrompt(input);

        const parser = new JsonOutputParser<GenerateRoadmapOutput>();
        const chain = this.llmClient.getModel().pipe(parser);

        try {
            const result = await chain.invoke(prompt);
            return result as GenerateRoadmapOutput;
        } catch (error) {
            console.error('Error generating roadmap:', error);
            throw new Error('Failed to generate learning roadmap');
        }
    }

    private async buildRoadmapPrompt(
        input: GenerateRoadmapInput
    ): Promise<string> {
        // Normalize severity values to lowercase
        const normalizedTestAnalysis = input.testAnalysis
            ? {
                  ...input.testAnalysis,
                  weaknesses: (input.testAnalysis.weaknesses as unknown[])?.map(
                      (w: unknown) => ({
                          ...(w as Record<string, unknown>),
                          severity: (
                              (w as Record<string, unknown>).severity as string
                          )?.toLowerCase(),
                      })
                  ),
              }
            : undefined;

        const testAnalysisBlock = normalizedTestAnalysis
            ? `testAnalysis (optional):
- Score: ${normalizedTestAnalysis.score}
- Weaknesses: ${JSON.stringify(normalizedTestAnalysis.weaknesses)} // [{skillName, severity, category, userAccuracy?}]
- Strengths: ${JSON.stringify(normalizedTestAnalysis.strengths)}
- Domains Performance: ${JSON.stringify(normalizedTestAnalysis.domainsPerformance)}
- Summary: ${normalizedTestAnalysis.summary}
`
            : '';

        const providedWeaknessesBlock = input.providedWeaknesses
            ? `providedWeaknesses (optional): ${JSON.stringify(
                  (input.providedWeaknesses as unknown[])?.map(
                      (w: unknown) => ({
                          ...(w as Record<string, unknown>),
                          severity: (
                              (w as Record<string, unknown>).severity as string
                          )?.toLowerCase(),
                      })
                  )
              )} // same format as weaknesses
`
            : '';

        const variables = {
            userId: input.userId,
            userPrompt: input.userPrompt,
            targetScore: input.targetScore.toString(),
            studyTimePerDay: input.studyTimePerDay.toString(),
            studyDaysPerWeek: input.studyDaysPerWeek.toString(),
            primaryGoal:
                input.userPreferences?.primaryGoal || 'toeic_preparation',
            currentLevel: input.userPreferences?.currentLevel || 'intermediate',
            preferredStudyTime:
                input.userPreferences?.preferredStudyTime || 'N/A',
            contentInterests:
                input.userPreferences?.contentInterests?.join(', ') || 'N/A',
            studyDaysOfWeek:
                input.userPreferences?.studyDaysOfWeek?.join(', ') ||
                '1, 2, 3, 4, 5',
            todayDayOfWeek: (
                input.todayDayOfWeek ?? new Date().getDay()
            ).toString(),
            testAnalysisBlock,
            providedWeaknessesBlock,
        };

        return await promptManagerService.loadTemplate(
            'studyplan/roadmap_generation',
            variables
        );
    }
}

export const learningPlanAIService = new LearningPlanAIService();
