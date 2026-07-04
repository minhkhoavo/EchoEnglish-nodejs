import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { imageUrlToDataUrl } from '~/utils/imageUtils.js';
import { promptManagerService } from './PromptManagerService.js';
import { googleGenAIClient } from '../provider/googleGenAIClient.js';

interface WritingContext {
    partType: 1 | 2 | 3;
    questionPrompt: string;
    imageUrl?: string | null;
    keywords?: string;
    directions?: string[];
    suggestions?: Array<{
        code: string;
        name: string;
        components: Array<{
            code: string;
            name: string;
            sample: string;
            outline: string;
        }>;
    }>;
    userAnswer: string;
}

class ToeicWritingScoringService {
    private getTemplateNameForPart(partType: number): string {
        const mapping: Record<number, string> = {
            1: 'part_1_describe_picture',
            2: 'part_2_email_response',
            3: 'part_3_opinion_essay',
        };
        return mapping[partType] || '';
    }

    private async getTemplate(templateName: string): Promise<string> {
        try {
            const template =
                await promptManagerService.getTemplate(templateName);
            return template;
        } catch (error) {
            console.error(
                `[ToeicWritingScoringService] Error loading template ${templateName}:`,
                error
            );
            // Return a fallback template if file not found
            return this.getFallbackTemplate(templateName);
        }
    }

    private getFallbackTemplate(templateName: string): string {
        // Simple fallback templates for each part
        if (templateName.includes('part_1')) {
            return `You are evaluating a TOEIC Writing Part 1 response.
Question: {questionPrompt}
Keywords: {keywords}
Candidate's Sentence: {candidateSentence}

Evaluate and return JSON with:
- original_text
- overall_assessment (criteria_scores, overallScore, summary, strengths, areasForImprovement)
- detailed_breakdown (array of sentence analysis)`;
        } else if (templateName.includes('part_2')) {
            return `You are evaluating a TOEIC Writing Part 2 response.
Email Prompt: {emailPrompt}
Candidate's Response: {candidateResponse}

Evaluate and return JSON with:
- original_text
- overall_assessment
- detailed_breakdown`;
        } else {
            return `You are evaluating a TOEIC Writing Part 3 essay.
Essay Prompt: {essayPrompt}
Candidate's Essay: {candidateEssay}

Evaluate and return JSON with:
- original_text
- overall_assessment
- detailed_breakdown`;
        }
    }

    async scoreWriting(
        context: WritingContext
    ): Promise<Record<string, unknown>> {
        const templateName = this.getTemplateNameForPart(context.partType);
        const templateString = await this.getTemplate(templateName);

        // Prepare input data
        const inputData: Record<string, string> = {
            questionPrompt: context.questionPrompt || '',
        };

        // Part-specific fields
        if (context.partType === 1) {
            inputData.keywords = context.keywords || '';
            inputData.candidateSentence = context.userAnswer;
        } else if (context.partType === 2) {
            inputData.emailPrompt = context.questionPrompt || '';
            inputData.candidateResponse = context.userAnswer;
        } else if (context.partType === 3) {
            inputData.essayPrompt = context.questionPrompt || '';
            inputData.candidateEssay = context.userAnswer;
        }

        // Format prompt
        const formattedText =
            await PromptTemplate.fromTemplate(templateString).format(inputData);

        const model = googleGenAIClient.getModel();
        const parser = new JsonOutputParser();

        // Handle image if exists (Part 1) - use proper multimodal format
        if (context.imageUrl) {
            try {
                const dataUrl = await imageUrlToDataUrl(context.imageUrl);
                console.log(
                    `[ToeicWritingScoringService] Image converted, length: ${dataUrl.length} chars`
                );

                // Create multimodal message with image
                const input = [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: formattedText,
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: dataUrl,
                                },
                            },
                        ],
                    },
                ];
                return await this.invokeWithRetry(model, parser, input);
            } catch (imageError) {
                console.error(
                    '[ToeicWritingScoringService] Image processing failed:',
                    imageError
                );
                // Fallback to text-only if image fails
            }
        }

        // Text-only path (no image or image failed)
        try {
            return await this.invokeWithRetry(model, parser, formattedText);
        } catch (error) {
            console.error('[ToeicWritingScoringService] Scoring error:', error);
            throw new Error('AI scoring failed');
        }
    }

    private async invokeWithRetry(
        model: ChatGoogleGenerativeAI,
        parser: JsonOutputParser,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: any,
        maxRetries = 3
    ): Promise<Record<string, unknown>> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const chain = model.pipe(parser);
                return (await chain.invoke(input)) as Record<string, unknown>;
            } catch (error) {
                console.error(
                    `[ToeicWritingScoringService] Attempt ${attempt} failed. Error:`,
                    error
                );
                if (attempt === maxRetries) {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
        throw new Error('AI scoring failed after multiple attempts');
    }
}

export const toeicWritingScoringService = new ToeicWritingScoringService();
