import { GoogleGenAIClient } from '../provider/googleGenAIClient.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { promptManagerService } from './PromptManagerService.js';

export interface MaterialExtractionInput {
    title: string;
    content: string;
    focus: string;
    targetSkills: string[];
    level: string;
    studyTimePerDay: number;
}

export interface MaterialExtractionResult {
    grammarGuide: {
        title: string;
        sections: Array<{ title: string; content: string }>;
        quickTips: string[];
    };
    vocabulary: {
        title: string;
        description: string;
        words: Array<{
            word: string;
            partOfSpeech: string;
            definition: string;
            example: string;
            usageNote: string;
        }>;
    };
}

const MAX_CONTENT_CHARS = 6000;

export class MaterialContentAIService {
    private llmClient: GoogleGenAIClient;

    constructor() {
        this.llmClient = new GoogleGenAIClient();
    }

    async extractFromMaterial(
        input: MaterialExtractionInput
    ): Promise<MaterialExtractionResult> {
        const variables: Record<string, string> = {
            title: input.title,
            level: input.level,
            focus: input.focus,
            targetSkills: input.targetSkills.join(', ') || 'general',
            studyTimePerDay: input.studyTimePerDay.toString(),
            content: (input.content || '').slice(0, MAX_CONTENT_CHARS),
        };

        const prompt = await promptManagerService.loadTemplate(
            'studyplan/material_content_extraction',
            variables
        );

        const parser = new JsonOutputParser<MaterialExtractionResult>();
        const chain = this.llmClient.getModel().pipe(parser);

        try {
            const result = await chain.invoke(prompt);
            return {
                grammarGuide: {
                    title:
                        result.grammarGuide?.title ||
                        `Grammar from: ${input.title}`,
                    sections: result.grammarGuide?.sections || [],
                    quickTips: result.grammarGuide?.quickTips || [],
                },
                vocabulary: {
                    title:
                        result.vocabulary?.title ||
                        `Vocabulary from: ${input.title}`,
                    description:
                        result.vocabulary?.description ||
                        'Key words pulled from this material',
                    words: result.vocabulary?.words || [],
                },
            };
        } catch (error) {
            console.error('Error extracting material content:', error);
            return {
                grammarGuide: {
                    title: `Grammar from: ${input.title}`,
                    sections: [],
                    quickTips: [],
                },
                vocabulary: {
                    title: `Vocabulary from: ${input.title}`,
                    description: 'Key words pulled from this material',
                    words: [],
                },
            };
        }
    }
}

export const materialContentAIService = new MaterialContentAIService();
