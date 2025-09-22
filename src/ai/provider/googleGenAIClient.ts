import dotenv from 'dotenv';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

dotenv.config();

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

export class GoogleGenAIClient {
  private model: ChatGoogleGenerativeAI;

  constructor(opts?: GenerateOptions) {
    const modelName = opts?.model ?? 'gemini-2.0-flash';
    this.model = new ChatGoogleGenerativeAI({
      model: modelName,
      temperature: opts?.temperature ?? 0.2,
      //   maxOutputTokens: opts?.maxOutputTokens ?? 1024,
      apiKey,
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
