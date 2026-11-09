import { createHash } from 'node:crypto';
import { recsysConfig } from '../config.js';

export interface EmbeddingProvider {
    /** Stored with each vector; a different name/dims invalidates cached vectors. */
    readonly name: string;
    embed(texts: string[]): Promise<number[][]>;
}

const normalise = (v: number[]): number[] => {
    const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    return n > 0 ? v.map((x) => x / n) : v;
};

/**
 * Lexical feature hashing (word + bigram → signed buckets). Deterministic, free, offline.
 * It is NOT a semantic model: it measures shared vocabulary. Used for tests and as an
 * emergency no-API baseline.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
    readonly name: string;
    constructor(private readonly dims = 256) {
        this.name = `lexical-hash-v1:${dims}`;
    }
    async embed(texts: string[]): Promise<number[][]> {
        return texts.map((t) => {
            const v = new Array<number>(this.dims).fill(0);
            const words = t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
            const grams = [
                ...words,
                ...words.slice(1).map((w, i) => `${words[i]}_${w}`),
            ];
            for (const g of grams) {
                const h = createHash('md5').update(g).digest();
                v[h.readUInt16BE(0) % this.dims] += h[2] & 1 ? 1 : -1;
            }
            return normalise(v);
        });
    }
}

/** Gemini embeddings via the LangChain class the repo already depends on (lazy import). */
export async function createGeminiProvider(): Promise<EmbeddingProvider> {
    const { GoogleGenerativeAIEmbeddings } =
        await import('@langchain/google-genai');
    const apiKey =
        process.env.GENAI_API_KEY ??
        process.env.GOOGLE_API_KEY ??
        process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) throw new Error('No Gemini API key configured for embeddings');
    const model = recsysConfig.embeddings.model();
    const client = new GoogleGenerativeAIEmbeddings({ apiKey, model });
    return {
        name: `gemini:${model}`,
        async embed(texts) {
            const out = await client.embedDocuments(texts);
            if (out.length !== texts.length || out.some((v) => !v?.length))
                throw new Error('Embedding API returned an invalid response');
            return out.map(normalise);
        },
    };
}

/** Provider name WITHOUT constructing a client (the request path only needs it for lookups). */
export function providerNameFromEnv(): string {
    return recsysConfig.embeddings.provider() === 'hash'
        ? new HashingEmbeddingProvider().name
        : `gemini:${recsysConfig.embeddings.model()}`;
}

export async function providerFromEnv(): Promise<EmbeddingProvider> {
    return recsysConfig.embeddings.provider() === 'hash'
        ? new HashingEmbeddingProvider()
        : createGeminiProvider();
}
