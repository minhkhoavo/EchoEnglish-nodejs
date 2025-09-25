import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { DocumentChunk } from './types.js';

const apiKey =
    process.env.GENAI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    process.env.GOOGLE_GENAI_API_KEY;

const DEFAULT_EMBEDDING_MODEL =
    process.env.GENAI_EMBEDDING_MODEL ?? 'gemini-embedding-001';

class EmbeddingService {
    private embeddingModel: GoogleGenerativeAIEmbeddings;

    constructor() {
        if (!apiKey) {
            console.warn(
                '[EmbeddingService] Missing Gemini API key. Embeddings will fail.'
            );
        }

        this.embeddingModel = new GoogleGenerativeAIEmbeddings({
            apiKey,
            model: DEFAULT_EMBEDDING_MODEL,
        });
    }

    get modelName(): string {
        return DEFAULT_EMBEDDING_MODEL;
    }

    async embedChunks(chunks: DocumentChunk[]): Promise<number[][]> {
        const texts = chunks.map((chunk) => chunk.content);

        try {
            const embeddings = await this.embeddingModel.embedDocuments(texts);

            // Validate embeddings
            if (
                !embeddings ||
                embeddings.length === 0 ||
                embeddings.some((e) => !e || e.length === 0)
            ) {
                throw new Error(
                    'Gemini API returned empty or invalid embeddings'
                );
            }

            return embeddings;
        } catch (error) {
            console.error('[EmbeddingService] Failed to embed chunks:', error);
            throw new Error(
                `Embedding failed for ${texts.length} chunks: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    async embedQuery(query: string): Promise<number[]> {
        try {
            const embedding = await this.embeddingModel.embedQuery(query);

            if (!embedding || embedding.length === 0) {
                throw new Error(
                    'Gemini API returned empty embedding for query'
                );
            }

            return embedding;
        } catch (error) {
            console.error('[EmbeddingService] Failed to embed query:', error);
            throw new Error(
                `Embedding failed for query: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }
}

export const embeddingService = new EmbeddingService();
