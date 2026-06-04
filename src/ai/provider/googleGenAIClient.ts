import dotenv from 'dotenv';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { resolve } from 'path';
import { existsSync } from 'fs';

dotenv.config();

let authConfig: { apiKey?: string } = {};
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (serviceAccountPath && existsSync(serviceAccountPath)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(serviceAccountPath);
    console.log(
        '[ai] Using service account authentication from:',
        serviceAccountPath
    );
} else {
    const apiKey =
        process.env.GENAI_API_KEY ??
        process.env.GOOGLE_API_KEY ??
        process.env.GOOGLE_GENAI_API_KEY;

    if (apiKey) {
        authConfig.apiKey = apiKey;
        console.log('[ai] Using API key authentication');
    } else {
        console.warn(
            '[ai] No Gemini authentication found. Set either GOOGLE_APPLICATION_CREDENTIALS (service account) or GENAI_API_KEY (API key)'
        );
    }
}

export type GenerateOptions = {
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
};

export class GoogleGenAIClient {
    private model: ChatGoogleGenerativeAI;

    constructor(opts?: GenerateOptions) {
        const defaultModel =
            process.env.GEMINI_DEFAULT_MODEL ?? 'gemini-2.5-flash-lite';
        const modelName = opts?.model ?? defaultModel;
        this.model = new ChatGoogleGenerativeAI({
            model: modelName,
            temperature: opts?.temperature ?? 0.2,
            ...authConfig,
            maxRetries: 4,
        });
    }

    public getModel(): ChatGoogleGenerativeAI {
        return this.model;
    }

    async generate(text: string) {
        // Invoke with a simple user message; LangChain typings vary between versions,
        // using a plain object array is broadly compatible.
        const res = await this.model.invoke([{ role: 'user', content: text }]);

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
