import { CloudClient, IncludeEnum } from 'chromadb';
import type { EmbeddingFunction, Metadata, Where } from 'chromadb';
import { embeddingService } from './embeddingService.js';
import {
    DocumentChunk,
    DocumentChunkMetadata,
    DifficultyLabel,
    DomainLabel,
} from './types.js';

interface QueryOptions {
    userId: string;
    question: string;
    fileIds?: string[];
    topK?: number;
}

interface QueryResult {
    documents: string[];
    metadatas: DocumentChunkMetadata[];
    distances: number[];
    ids: string[];
}

const DEFAULT_COLLECTION =
    process.env.CHROMA_COLLECTION ?? 'echoenglish_user_files';

class ChromaVectorService {
    private client: CloudClient;
    private collectionName: string;
    private collectionPromise: ReturnType<
        CloudClient['getOrCreateCollection']
    > | null;
    private embeddingFn: EmbeddingFunction;

    constructor() {
        const apiKey = process.env.CHROMA_API_KEY;
        const tenant = process.env.CHROMA_TENANT;
        const database = process.env.CHROMA_DATABASE;

        if (!apiKey || !tenant || !database) {
            throw new Error(
                'Missing ChromaDB environment variables: CHROMA_API_KEY, CHROMA_TENANT, CHROMA_DATABASE'
            );
        }

        this.client = new CloudClient({
            apiKey,
            tenant,
            database,
        });
        this.collectionName = DEFAULT_COLLECTION;
        this.collectionPromise = null;
        // Provide a custom embedding function so Chroma doesn't try to use the optional @chroma-core/default-embed
        this.embeddingFn = {
            generate: async (texts: string[]) => {
                // Reuse our existing embeddingService; generate requires 2D embeddings
                const fakeChunks: DocumentChunk[] = texts.map((t, i) => ({
                    id: String(i),
                    content: t,
                    metadata: {
                        userId: 'system',
                        fileId: 'adhoc',
                        fileName: 'adhoc',
                        chunkIndex: i,
                    },
                }));
                return embeddingService.embedChunks(fakeChunks);
            },
        } satisfies EmbeddingFunction;
    }

    private async getCollection() {
        if (!this.collectionPromise) {
            this.collectionPromise = this.client.getOrCreateCollection({
                name: this.collectionName,
                embeddingFunction: this.embeddingFn,
            });
        }
        return this.collectionPromise;
    }

    async upsertChunks(chunks: DocumentChunk[]) {
        if (!chunks.length) {
            return {
                collection: this.collectionName,
                docIds: [],
                chunkCount: 0,
                chunkSize: 0,
            };
        }

        const collection = await this.getCollection();
        const embeddings = await embeddingService.embedChunks(chunks);
        const documents = chunks.map((chunk) => chunk.content);
        const metadatas: Metadata[] = chunks.map((chunk) => {
            // ChromaDB only accepts string, number, boolean, or null values in metadata
            const metadata: Record<string, string | number | boolean | null> = {
                userId: chunk.metadata.userId,
                fileId: chunk.metadata.fileId,
                fileName: chunk.metadata.fileName,
                chunkIndex: chunk.metadata.chunkIndex,
            };

            // Convert complex types to strings for ChromaDB compatibility
            if (chunk.metadata.difficulty) {
                metadata.difficulty = chunk.metadata.difficulty;
            }
            if (chunk.metadata.domain && chunk.metadata.domain.length > 0) {
                metadata.domain = chunk.metadata.domain.join(','); // Convert array to comma-separated string
            }
            if (chunk.metadata.language) {
                metadata.language = chunk.metadata.language;
            }

            return metadata as Metadata;
        });
        const ids = chunks.map((chunk) => chunk.id);

        await collection.upsert({
            ids,
            embeddings,
            documents,
            metadatas,
        });

        return {
            collection: this.collectionName,
            docIds: ids,
            chunkCount: chunks.length,
            chunkSize: documents[0]?.split(' ').length ?? 0,
            vectorDimension: embeddings[0]?.length ?? 0,
        };
    }

    async query(options: QueryOptions): Promise<QueryResult> {
        const collection = await this.getCollection();
        const queryEmbedding = await embeddingService.embedQuery(
            options.question
        );

        const whereClause = {
            userId: options.userId,
        } as unknown as Where;

        if (options.fileIds && options.fileIds.length) {
            // enrich with optional filter
            (whereClause as unknown as Record<string, unknown>).fileId = {
                $in: options.fileIds,
            };
        }

        const results = await collection.query({
            queryEmbeddings: [queryEmbedding],
            where: whereClause,
            nResults: options.topK ?? 4,
            include: [
                IncludeEnum.documents,
                IncludeEnum.metadatas,
                IncludeEnum.distances,
                IncludeEnum.embeddings,
            ],
        });

        return {
            documents: (results.documents?.[0] as string[]) ?? [],
            metadatas: ((results.metadatas?.[0] as (Metadata | null)[]) ?? [])
                .filter((m): m is Metadata => m !== null)
                .map((m) => {
                    // Convert back from ChromaDB metadata format to DocumentChunkMetadata
                    const metadata = m as Record<
                        string,
                        string | number | boolean | null
                    >;
                    const docMetadata: DocumentChunkMetadata = {
                        userId: metadata.userId as string,
                        fileId: metadata.fileId as string,
                        fileName: metadata.fileName as string,
                        chunkIndex: metadata.chunkIndex as number,
                    };

                    if (metadata.difficulty) {
                        docMetadata.difficulty =
                            metadata.difficulty as DifficultyLabel;
                    }
                    if (metadata.domain) {
                        // Convert comma-separated string back to array
                        docMetadata.domain = (metadata.domain as string).split(
                            ','
                        ) as DomainLabel[];
                    }
                    if (metadata.language) {
                        docMetadata.language = metadata.language as string;
                    }

                    return docMetadata;
                }),
            distances: (results.distances?.[0] as number[]) ?? [],
            ids: (results.ids?.[0] as string[]) ?? [],
        };
    }
}

export const chromaVectorService = new ChromaVectorService();
