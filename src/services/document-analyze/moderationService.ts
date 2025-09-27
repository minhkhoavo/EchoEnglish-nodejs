import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { ModerationResult } from './types.js';

const parser = new JsonOutputParser<{
    status: 'approved' | 'flagged' | 'rejected';
    categories: string[];
    reason?: string;
}>();

const prompt = new PromptTemplate({
    template: [
        'You are a strict content safety reviewer for TOEIC document ingestion.',
        'Review the provided text for any unsafe, copyrighted, or policy-violating content.',
        'Return ONLY valid JSON matching this schema:',
        '{{"status": "approved|flagged|rejected", "categories": ["..."], "reason": "..."}}',
        '- Use status "rejected" when the text must be fully blocked.',
        '- Use status "flagged" when human review is recommended.',
        '- Include relevant categories such as "violence", "hate", "adult", "copyright", "privacy", "spam".',
        '- confidence must be a number between 0 and 1.',
        '',
        'Text:',
        '{text}',
    ].join('\n'),
    inputVariables: ['text'],
});

class ContentModerationService {
    async moderate(text: string): Promise<ModerationResult> {
        const snippet = text.slice(0, 10_000);
        try {
            const formattedPrompt = await prompt.format({ text: snippet });
            const model = googleGenAIClient.getModel();
            const chain = model.pipe(parser);
            const result = await chain.invoke(formattedPrompt);
            return {
                status: result.status,
                categories: result.categories || [],
                reason: result.reason,
            };
        } catch (error) {
            console.error(
                '[ContentModerationService] moderation failed',
                error
            );
            return {
                status: 'flagged',
                categories: ['moderation_error'],
                reason: 'Moderation service unavailable',
            };
        }
    }
}

export const contentModerationService = new ContentModerationService();
