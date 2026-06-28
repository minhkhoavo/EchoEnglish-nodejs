import { GoogleGenAIClient } from '../provider/googleGenAIClient.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { promptManagerService } from './PromptManagerService.js';

export interface MemoMaterialInput {
    title: string;
    type: string; // resource type
    cefr?: string;
    domains?: string[];
    summary?: string;
}

export interface MemoAnalysisContext {
    note: string;
    studyTimePerDay: number;
    targetScope: string; // 'date' | 'week'
    preferredDays: number; // 0 = let LLM decide
    maxDays: number; // hard cap on the number of study days
    materials: MemoMaterialInput[];
    learnerProfile: {
        currentLevel: string;
        weakSkills?: Array<{ skill: string; accuracy: number }>;
        weakDomains?: Array<{ domain: string; accuracy: number }>;
        abilityNotes?: string[]; // from competencyProfile.aiInsights
    };
}

export interface MemoAnalysisResult {
    isSuitable: boolean;
    suitabilityReason: string;
    cefrFit: string;
    warnings: string[];
    suggestedTotalDays: number;
    dayPlan: Array<{ order: number; focus: string }>;
    supplementedWeaknesses: Array<{
        skillKey: string;
        skillName: string;
        severity: 'critical' | 'high' | 'medium' | 'low';
        reason: string;
    }>;
}

export class MemoAnalysisAIService {
    private llmClient: GoogleGenAIClient;

    constructor() {
        this.llmClient = new GoogleGenAIClient();
    }

    async analyzeMemo(
        context: MemoAnalysisContext
    ): Promise<MemoAnalysisResult> {
        const prompt = await this.buildPrompt(context);
        const parser = new JsonOutputParser<MemoAnalysisResult>();
        const chain = this.llmClient.getModel().pipe(parser);

        try {
            const result = await chain.invoke(prompt);
            return result as MemoAnalysisResult;
        } catch (error) {
            console.error('Error analyzing study memo:', error);
            throw new Error('Failed to analyze study memo');
        }
    }

    private async buildPrompt(context: MemoAnalysisContext): Promise<string> {
        const materialsBlock = context.materials
            .map(
                (m, idx) => `  [${idx}] ${m.type.toUpperCase()}: "${m.title}"
      CEFR/Difficulty: ${m.cefr || 'N/A'}
      Domain(s): ${m.domains?.join(', ') || 'N/A'}
      Summary: ${m.summary || 'N/A'}`
            )
            .join('\n');

        const profile = context.learnerProfile;
        const learnerProfileBlock = `- Current Level: ${profile.currentLevel}
- Weak Skills: ${
            profile.weakSkills && profile.weakSkills.length > 0
                ? profile.weakSkills
                      .map((s) => `${s.skill} (${s.accuracy}%)`)
                      .join(', ')
                : 'N/A'
        }
- Weak Domains: ${
            profile.weakDomains && profile.weakDomains.length > 0
                ? profile.weakDomains
                      .map((d) => `${d.domain} (${d.accuracy}%)`)
                      .join(', ')
                : 'N/A'
        }
- Ability Notes (AI insights about this learner): ${
            profile.abilityNotes && profile.abilityNotes.length > 0
                ? profile.abilityNotes.map((n) => `"${n}"`).join('; ')
                : 'N/A'
        }`;

        const variables: Record<string, string> = {
            learnerProfileBlock,
            studyTimePerDay: context.studyTimePerDay.toString(),
            targetScope: context.targetScope,
            preferredDays: context.preferredDays.toString(),
            maxDays: context.maxDays.toString(),
            userNote: context.note || 'No specific note provided.',
            materialsBlock: materialsBlock || 'None',
        };

        return await promptManagerService.loadTemplate(
            'studyplan/memo_suitability_analysis',
            variables
        );
    }
}

export const memoAnalysisAIService = new MemoAnalysisAIService();
