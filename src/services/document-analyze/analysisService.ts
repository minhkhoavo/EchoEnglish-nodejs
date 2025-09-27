import { PromptTemplate } from '@langchain/core/prompts';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { z } from 'zod';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import {
    FILE_DIFFICULTY_LABELS,
    FILE_DOMAIN_LABELS,
    FILE_GENRE_LABELS,
    FILE_SETTING_LABELS,
    FILE_STYLE_LABELS,
} from '~/models/fileContentModel.js';
import { AnalysisResult } from './types.js';
import { extractTextFromMessage } from '../../utils/aiUtils.js';

const toeicPartsSchema = z.object({
    part2: z.boolean(),
    part3: z.boolean(),
    part4: z.boolean(),
    part5: z.boolean(),
    part6: z.boolean(),
    part7: z.boolean(),
});

const vocabularyHighlightSchema = z.object({
    term: z.string(),
    cefr: z.string().optional(),
    explanation: z.string().optional(),
    example: z.string().optional(),
});

const analysisSchema = z.object({
    difficulty: z.enum(FILE_DIFFICULTY_LABELS),
    style: z.enum(FILE_STYLE_LABELS),
    domain: z.array(z.enum(FILE_DOMAIN_LABELS)).min(1).max(3),
    genre: z.array(z.enum(FILE_GENRE_LABELS)).min(1).max(3),
    setting: z.array(z.enum(FILE_SETTING_LABELS)).min(1).max(3),
    toeic_parts: toeicPartsSchema,
    token_length: z.number().int().nonnegative(),
    text_quality: z.number().min(0).max(1),
    summary: z.string().min(10),
    language: z.string().min(2).max(20),
    language_confidence: z.number().min(0).max(1).optional(),
    teaching_notes: z.string().optional(),
    personalization_ideas: z.array(z.string()).min(1).max(5),
    toeic_question_ideas: z.array(z.string()).min(1).max(5),
    vocabulary_highlights: z.array(vocabularyHighlightSchema).max(10),
    additional_metadata: z.record(z.unknown()).optional().default({}),
});

type AnalysisSchemaOutput = z.infer<typeof analysisSchema>;

const parser = StructuredOutputParser.fromZodSchema(analysisSchema);

const prompt = new PromptTemplate({
    template:
        'You are an assistant that analyzes documents for TOEIC test generation.\n\n' +
        'Analyze the given text and produce STRICT JSON only. Follow these rules: \n' +
        '- Do NOT include markdown, backticks, or extra commentary.\n' +
        '- Use the following label sets when applicable. If none fit, choose the closest reasonable label.\n' +
        `- difficulty: one of ${JSON.stringify(FILE_DIFFICULTY_LABELS)}.\n` +
        `- style: one of ${JSON.stringify(FILE_STYLE_LABELS)}.\n` +
        `- domain (multi): choose 1-3 from ${JSON.stringify(FILE_DOMAIN_LABELS)}.\n` +
        `- genre (multi): choose 1-3 from ${JSON.stringify(FILE_GENRE_LABELS)}.\n` +
        `- setting (multi): choose 1-3 from ${JSON.stringify(FILE_SETTING_LABELS)}.\n` +
        '- toeic_parts booleans indicate suitability for TOEIC Parts 2–7 (skip Part 1).\n' +
        '- token_length is the approximate number of tokens (roughly words).\n' +
        '- text_quality is a score from 0 to 1 for clarity and cleanliness of the text.\n' +
        '- language must be a BCP-47 code (e.g. "en", "vi", "en-US").\n' +
        '- language_confidence should be between 0 and 1 when provided.\n' +
        '- Provide actionable personalization_ideas and toeic_question_ideas grounded in the document content.\n' +
        'Return JSON only in this exact schema (no backticks, no markdown): \n' +
        '{format_instructions}\n\n' +
        'Text to analyze:\n---\n{text}\n---\n',
    inputVariables: ['text'],
    partialVariables: {
        format_instructions: parser.getFormatInstructions(),
    },
});

class DocumentAnalysisService {
    async analyze(text: string): Promise<{
        analysis: AnalysisResult;
        raw: AnalysisSchemaOutput;
        response: unknown; // Gemini response for usage calculation
    }> {
        const truncated = text.slice(0, 25_000);
        const formattedPrompt = await prompt.format({ text: truncated });
        const model = googleGenAIClient.getModel();
        const aiMessage = await model.invoke([
            { role: 'user', content: formattedPrompt },
        ]);
        const textResponse = extractTextFromMessage(aiMessage);
        const parsed = await parser.parse(textResponse);

        const analysis: AnalysisResult = {
            difficulty: parsed.difficulty,
            style: parsed.style,
            domain: parsed.domain,
            genre: parsed.genre,
            setting: parsed.setting,
            toeicParts: parsed.toeic_parts,
            tokenLength: parsed.token_length,
            summary: parsed.summary,
            language: parsed.language,
            teachingNotes: parsed.teaching_notes,
            personalizationIdeas: parsed.personalization_ideas,
            toeicQuestionIdeas: parsed.toeic_question_ideas,
            additionalMetadata: parsed.additional_metadata,
        };

        return { analysis, raw: parsed, response: aiMessage };
    }
}

export const documentAnalysisService = new DocumentAnalysisService();
