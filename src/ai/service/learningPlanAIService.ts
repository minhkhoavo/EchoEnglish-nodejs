import { GoogleGenAIClient } from '../provider/googleGenAIClient.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { promptManagerService } from './PromptManagerService.js';

interface GenerateRoadmapInput {
    userId: string;
    userPrompt: string;
    currentScore: number;
    targetScore: number;
    studyTimePerDay: number;
    studyDaysPerWeek: number;
    testAnalysis?: {
        score: number;
        weaknesses: unknown[];
        strengths: string[];
        summary: string;
        domainsPerformance?: unknown[];
    };
    providedWeaknesses?: unknown[];
}

interface GenerateRoadmapOutput {
    currentLevel: string;
    learningStrategy: {
        foundationFocus: number;
        domainFocus: number;
    };
    totalWeeks: number;
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

interface GenerateDailyActivitiesInput {
    userId: string;
    currentLevel: string;
    dailyFocusTitle: string;
    skillsToImprove: string[];
    studyTimeAvailable: number;
    weekContext?: {
        weekNumber: number;
        weeklyFocus: string;
    };
}

interface GenerateDailyActivitiesOutput {
    activities: Array<{
        activityId: string;
        type: string;
        title: string;
        description: string;
        resourceType: string;
        estimatedTime: number;
        difficulty: string;
    }>;
}

export class LearningPlanAIService {
    private llmClient: GoogleGenAIClient;

    constructor() {
        this.llmClient = new GoogleGenAIClient({
            model: 'models/gemini-flash-lite-latest',
        });
    }

    async generateLearningRoadmap(
        input: GenerateRoadmapInput
    ): Promise<GenerateRoadmapOutput> {
        console.log('Generating learning roadmap with LLM...');

        const prompt = await this.buildRoadmapPrompt(input);

        const parser = new JsonOutputParser<GenerateRoadmapOutput>();
        const chain = this.llmClient.getModel().pipe(parser);

        try {
            const result = await chain.invoke(prompt);
            console.log('LLM generated roadmap structure');
            return result as GenerateRoadmapOutput;
        } catch (error) {
            console.error('Error generating roadmap:', error);
            throw new Error('Failed to generate learning roadmap');
        }
    }

    async generateDailyActivities(
        input: GenerateDailyActivitiesInput
    ): Promise<GenerateDailyActivitiesOutput> {
        console.log('Generating daily activities with LLM...');

        const prompt = this.buildDailyActivitiesPrompt(input);

        const parser = new JsonOutputParser<GenerateDailyActivitiesOutput>();
        const chain = this.llmClient.getModel().pipe(parser);

        try {
            const result = await chain.invoke(prompt);
            console.log('LLM generated daily activities');
            return result as GenerateDailyActivitiesOutput;
        } catch (error) {
            console.error('Error generating daily activities:', error);
            throw new Error('Failed to generate daily activities');
        }
    }

    async shouldRecalibrateRoadmap(context: {
        roadmapId: string;
        currentWeek?: number;
        overallProgress?: number;
        sessionsCompleted?: number;
        totalSessions?: number;
    }): Promise<boolean> {
        const prompt = `
Analyze if this learning roadmap needs recalibration:

Current Week: ${context.currentWeek || 0}
Overall Progress: ${context.overallProgress || 0}%
Sessions Completed: ${context.sessionsCompleted || 0} / ${context.totalSessions || 0}

Return true if recalibration is needed, false otherwise.
Return JSON: { "needsRecalibration": boolean, "reason": string }
        `;

        try {
            const parser = new JsonOutputParser<{
                needsRecalibration: boolean;
                reason: string;
            }>();
            const chain = this.llmClient.getModel().pipe(parser);
            const result = await chain.invoke(prompt);

            console.log('Recalibration check:', result);
            return (result as { needsRecalibration: boolean; reason: string })
                .needsRecalibration;
        } catch (error) {
            console.error('Error checking recalibration:', error);
            return false;
        }
    }

    async recalibrateLearningRoadmap(context: {
        oldRoadmap: {
            currentLevel?: string;
            currentWeek?: number;
            overallProgress?: number;
            weeklyFocuses?: unknown[];
        };
        newTestAnalysis?: unknown;
        studyTimePerDay?: number;
        studyDaysPerWeek?: number;
        targetScore?: number;
    }): Promise<{
        weeklyFocuses: unknown[];
        learningStrategy: string;
    }> {
        console.log('Recalibrating roadmap with LLM...');

        const prompt = `
Recalibrate the learning roadmap based on current progress:

Old Roadmap:
- Current Level: ${context.oldRoadmap.currentLevel}
- Current Week: ${context.oldRoadmap.currentWeek}
- Overall Progress: ${context.oldRoadmap.overallProgress}%

New Test Analysis: ${context.newTestAnalysis ? JSON.stringify(context.newTestAnalysis) : 'N/A'}

Study Schedule:
- Time Per Day: ${context.studyTimePerDay} minutes
- Days Per Week: ${context.studyDaysPerWeek}
- Target Score: ${context.targetScore}

Generate an updated weekly focuses array and learning strategy.
Return JSON with: { "weeklyFocuses": [...], "learningStrategy": "..." }
        `;

        try {
            const parser = new JsonOutputParser();
            const chain = this.llmClient.getModel().pipe(parser);
            const result = await chain.invoke(prompt);
            return result as {
                weeklyFocuses: unknown[];
                learningStrategy: string;
            };
        } catch (error) {
            console.error('Error recalibrating roadmap:', error);
            return {
                weeklyFocuses: context.oldRoadmap.weeklyFocuses || [],
                learningStrategy: 'Continue with current strategy',
            };
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
            currentScore: input.currentScore.toString(),
            targetScore: input.targetScore.toString(),
            studyTimePerDay: input.studyTimePerDay.toString(),
            studyDaysPerWeek: input.studyDaysPerWeek.toString(),
            testAnalysisBlock,
            providedWeaknessesBlock,
        };

        return await promptManagerService.loadTemplate(
            'studyplan/roadmap_generation',
            variables
        );
    }

    private buildDailyActivitiesPrompt(
        input: GenerateDailyActivitiesInput
    ): string {
        return `
You are an expert TOEIC learning consultant. Generate today's LEARNING activities for a student.

Context:
- User Level: ${input.currentLevel}
- Today's Focus: "${input.dailyFocusTitle}"
- Skills to Improve: ${input.skillsToImprove.join(', ')}
- Time Available: ${input.studyTimeAvailable} minutes

${
    input.weekContext
        ? `Week Context:
- Week ${input.weekContext.weekNumber}: ${input.weekContext.weeklyFocus}
`
        : ''
}

IMPORTANT: Generate ONLY learning activities:
- Videos: Watch instructional content
- Reading: Read articles or guides  
- Review: Review key concepts

Generate 2-3 learning activities that:
1. Start with foundation (video/reading to learn concept)
2. Follow with review/reinforcement
3. Are appropriate for ${input.currentLevel} level
4. Total time: ${input.studyTimeAvailable} minutes max
5. Each activity should be self-contained and actionable

Return JSON matching this schema:
{
    "activities": [
        {
            "activityId": "ACT_YYYYMMDD_001",
            "type": "learn|review",
            "title": "Clear, actionable title (e.g., 'Watch: TOEIC Part 1 Basics')",
            "description": "Brief description of what student will learn (50-100 words). Include key topics covered.",
            "resourceType": "video|reading|audio",
            "estimatedTime": <minutes>,
            "difficulty": "beginner|intermediate|advanced"
        }
    ]
}

Make activities:
- Clear and specific
- Focused on understanding concepts
- Building foundation for practice later
- Relevant to TOEIC test format
`;
    }
}

export const learningPlanAIService = new LearningPlanAIService();
