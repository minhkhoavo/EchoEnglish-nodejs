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

    // User Preferences (Supplementary hints - not priority)
    userPreferences?: {
        preferredStudyTime?: string;
        contentInterests?: string[];
    };

    // Mistakes to Practice (for practice drills)
    mistakesToReview?: Array<{
        questionId: string;
        questionText: string;
        contentTags?: string[];
        skillTag?: string;
        partNumber?: number;
        difficulty?: string;
        mistakeCount: number;
    }>;

    // Available DB Resources (for LLM to choose)
    availableResources?: Array<{
        type: string;
        title: string;
        description: string;
        url?: string;
        domain?: string;
        topics?: string[];
    }>;

    // Missed Sessions (to integrate into today's plan)
    missedSessions?: Array<{
        focus: string;
        targetSkills: string[];
        suggestedDomains: string[];
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

        // Or generate practice drill
        generatePracticeDrill: boolean;
        practiceQuestionIds?: string[]; // IDs of questions to practice
        minCorrectAnswers?: number; // Minimum correct answers to complete
        drillInstructions?: string; // Instructions for the practice drill

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
        // console.log('Generating daily plan with LLM decision-making...');

        const prompt = await this.buildDailyPlanPrompt(context);
        // console.log('Prompt built, invoking LLM...::::::::', prompt);
        const parser = new JsonOutputParser<DailyPlanOutput>();
        const chain = this.llmClient.getModel().pipe(parser);

        try {
            const result = await chain.invoke(prompt);
            // console.log('Reasoning:', result.reasoning);
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

        const mistakesToReviewBlock =
            context.mistakesToReview && context.mistakesToReview.length > 0
                ? `### Mistakes to Practice (${context.mistakesToReview.length} questions from stack):
${context.mistakesToReview
    .map(
        (mistake, idx) => `
  [${idx}] Question ID: ${mistake.questionId}
      Text: "${mistake.questionText.substring(0, 100)}..."
      Skill: ${mistake.skillTag || 'N/A'}
      Part: ${mistake.partNumber || 'N/A'}
      Difficulty: ${mistake.difficulty || 'N/A'}
      Mistake Count: ${mistake.mistakeCount}
      Tags: ${mistake.contentTags?.join(', ') || 'N/A'}`
    )
    .join('\n')}

**Suggestion**: These are the top mistakes from the stack. If daily focus aligns, create a practice drill with 3-5 questions.`
                : '### Mistakes to Practice:\nNo mistakes in stack for this week.';

        const missedSessionsBlock =
            context.missedSessions && context.missedSessions.length > 0
                ? `### Missed Sessions to Catch Up (${context.missedSessions.length} sessions):
${context.missedSessions
    .map(
        (session, idx) => `
  [${idx}] Missed Focus: "${session.focus}"
      Skills: ${session.targetSkills.join(', ')}
      Domains: ${session.suggestedDomains.join(', ')}`
    )
    .join('\n')}

**IMPORTANT**: User missed these sessions. You MUST integrate review content from these missed sessions into today's plan.
Create additional review activities that cover the missed skills and topics, but keep total time within budget.`
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
            preferredStudyTime:
                context.userPreferences?.preferredStudyTime || 'N/A',
            contentInterests:
                context.userPreferences?.contentInterests?.join(', ') || 'N/A',
            competencyProfileBlock,
            mistakesToReviewBlock,
            missedSessionsBlock,
            availableResourcesList: availableResourcesList || 'None available',
        };

        return await promptManagerService.loadTemplate(
            'studyplan/daily_plan_generation',
            variables
        );
    }
}

export const dailyPlanAIService = new DailyPlanAIService();
