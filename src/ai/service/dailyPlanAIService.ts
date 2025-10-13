import { GoogleGenAIClient } from '../provider/googleGenAIClient.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { promptManagerService } from './PromptManagerService.js';

interface DailyPlanContext {
    // Daily Focus (Priority 1)
    dailyFocus: {
        focus: string;
        targetSkills: string[];
        suggestedDomains: string[];
        estimatedMinutes: number;
    };

    // Week Focus (Priority 2)
    weekFocus: {
        weekNumber: number;
        title: string;
        summary: string;
        focusSkills: string[];
        targetWeaknesses: Array<{
            skillKey: string;
            skillName: string;
            severity: string;
            category: string;
            userAccuracy?: number;
        }>;
        recommendedDomains: string[];
    };

    // Competency Profile (Supporting context)
    competencyProfile?: {
        currentLevel: string;
        lowestSkills?: Array<{
            skill: string;
            currentAccuracy: number;
            proficiency: string;
        }>;
    };

    // Available DB Resources (for LLM to choose)
    availableResources?: Array<{
        type: string;
        title: string;
        description: string;
        url?: string;
        domain?: string;
        topics?: string[];
    }>;
}

interface DailyPlanOutput {
    activities: Array<{
        priority: number;
        title: string;
        description: string;
        skillsToImprove: string[];

        // Resource decisions
        useDBResource: boolean;
        dbResourceIndex?: number; // Index in availableResources

        // Or generate new resource
        generateVocabularySet: boolean;
        generatePersonalizedGuide: boolean;

        // Metadata
        targetWeakness: {
            skillKey: string;
            skillName: string;
            severity: string;
        };
        estimatedTime: number;
        activityType: 'learn' | 'practice' | 'review' | 'drill';
    }>;

    reasoning: string; // LLM explains why it chose these activities
}

export class DailyPlanAIService {
    private llmClient: GoogleGenAIClient;

    constructor() {
        this.llmClient = new GoogleGenAIClient({
            model: 'models/gemini-flash-lite-latest',
        });
    }

    async generateDailyPlan(
        context: DailyPlanContext
    ): Promise<DailyPlanOutput> {
        console.log('Generating daily plan with LLM decision-making...');

        const prompt = await this.buildDailyPlanPrompt(context);

        const parser = new JsonOutputParser<DailyPlanOutput>();
        const chain = this.llmClient.getModel().pipe(parser);

        try {
            const result = await chain.invoke(prompt);
            console.log('LLM generated daily plan');
            console.log('Reasoning:', result.reasoning);
            return result as DailyPlanOutput;
        } catch (error) {
            console.error('Error generating daily plan:', error);
            throw new Error('Failed to generate daily plan');
        }
    }

    private async buildDailyPlanPrompt(
        context: DailyPlanContext
    ): Promise<string> {
        const availableResourcesList = context.availableResources
            ?.map(
                (r, idx) => `
  [${idx}] ${r.type.toUpperCase()}: "${r.title}"
      Description: ${r.description}
      Domain: ${r.domain || 'N/A'}
      Topics: ${r.topics?.join(', ') || 'N/A'}
      ${r.url ? `URL: ${r.url}` : ''}`
            )
            .join('\n');

        const competencyProfileBlock = context.competencyProfile
            ? `### Competency Profile (Supporting):
- Current Level: ${context.competencyProfile.currentLevel}
- Lowest Skills: ${context.competencyProfile.lowestSkills?.map((s) => `${s.skill} (${s.currentAccuracy}%)`).join(', ') || 'N/A'}`
            : '';

        const variables = {
            dailyFocus: context.dailyFocus.focus,
            targetSkills: context.dailyFocus.targetSkills.join(', '),
            suggestedDomains: context.dailyFocus.suggestedDomains.join(', '),
            estimatedMinutes: context.dailyFocus.estimatedMinutes.toString(),
            weekNumber: context.weekFocus.weekNumber.toString(),
            weekTitle: context.weekFocus.title,
            weekSummary: context.weekFocus.summary,
            weekFocusSkills: context.weekFocus.focusSkills.join(', '),
            targetWeaknesses: context.weekFocus.targetWeaknesses
                .map(
                    (w) =>
                        `${w.skillName} (${w.severity}, accuracy: ${w.userAccuracy || 'N/A'}%)`
                )
                .join('; '),
            recommendedDomains: context.weekFocus.recommendedDomains.join(', '),
            competencyProfileBlock,
            availableResourcesList: availableResourcesList || 'None available',
        };

        return await promptManagerService.loadTemplate(
            'studyplan/daily_plan_generation',
            variables
        );
    }
}

export const dailyPlanAIService = new DailyPlanAIService();
