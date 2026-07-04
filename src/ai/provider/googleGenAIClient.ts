import dotenv from 'dotenv';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

dotenv.config();

// Monkey-patch ChatGoogleGenerativeAI to support Gemini 3.x models for multimodal inputs.
// The older version of @langchain/google-genai checks model names with a hardcoded startsWith/includes.
// Since gemini-3.1-flash-lite doesn't match gemini-1.5 or gemini-2, it fails client-side validation.
Object.defineProperty(ChatGoogleGenerativeAI.prototype, '_isMultimodalModel', {
    get() {
        return (
            this.model.includes('vision') ||
            this.model.startsWith('gemini-1.5') ||
            this.model.startsWith('gemini-2') ||
            this.model.startsWith('gemini-3') || // Support gemini-3/3.1
            (this.model.startsWith('gemma-3-') &&
                !this.model.startsWith('gemma-3-1b'))
        );
    },
    configurable: true,
});

const apiKey =
    process.env.GENAI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    process.env.GOOGLE_GENAI_API_KEY;

if (!apiKey) {
    // Do not throw at import time in case server doesn't use AI features.
    console.warn(
        '[ai] No Gemini API key found in GENAI_API_KEY / GOOGLE_API_KEY / GOOGLE_GENAI_API_KEY'
    );
}

export type GenerateOptions = {
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
};

export type InlineImage = {
    data: string;
    mimeType: string;
};

export class GoogleGenAIClient {
    private model: ChatGoogleGenerativeAI;
    private readonly modelName: string;

    constructor(opts?: GenerateOptions) {
        const defaultModel =
            process.env.GEMINI_DEFAULT_MODEL ?? 'gemini-3.1-flash-lite';
        this.modelName = opts?.model ?? defaultModel;
        this.model = new ChatGoogleGenerativeAI({
            model: this.modelName,
            temperature: opts?.temperature ?? 0.2,
            apiKey,
            maxRetries: 4,
        });
    }

    public getModel(model?: string): ChatGoogleGenerativeAI {
        return new ChatGoogleGenerativeAI({
            model: model ?? this.modelName,
            temperature: 0.2,
            apiKey,
            maxRetries: 4,
            json: true,
        });
    }

    async generate(text: string, images?: InlineImage[]) {
        // Invoke with a simple user message; LangChain typings vary between versions,
        // using a plain object array is broadly compatible. When images are
        // provided we send a multimodal message (text + image_url blocks) so the
        // model can "see" the photo (used e.g. to author Part 1 questions).
        type ContentBlock =
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string } };
        const content: string | ContentBlock[] =
            images && images.length
                ? [
                      { type: 'text', text },
                      ...images.map(
                          (img): ContentBlock => ({
                              type: 'image_url',
                              image_url: {
                                  url: `data:${img.mimeType};base64,${img.data}`,
                              },
                          })
                      ),
                  ]
                : text;

        const res = await this.model.invoke([{ role: 'user', content }]);

        // The response shape can vary between langchain versions/providers.
        // Try common paths for the returned content.
        try {
            // If response has an `output` array with content blocks
            // @ts-expect-error - LangChain response structure varies between versions
            if (res?.output && Array.isArray(res.output) && res.output.length) {
                // @ts-expect-error - Dynamic property access on LangChain response
                return res.output[0].content ?? String(res);
            }

            // If response is a plain string or has `text`/`content` fields
            return res?.text ?? res?.content ?? String(res);
        } catch {
            return String(res);
        }
    }
}

export const googleGenAIClient = new GoogleGenAIClient();
