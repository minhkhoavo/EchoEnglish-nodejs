/* eslint-disable @typescript-eslint/no-explicit-any */
import { IncludeEnum } from 'chromadb';
import { embeddingService } from '~/services/document-analyze/embeddingService.js';
import { DocumentChunk } from '~/services/document-analyze/types.js';

const mockCollection = {
    upsert: jest.fn(),
    query: jest.fn(),
};

jest.mock('chromadb', () => {
    return {
        CloudClient: jest.fn().mockImplementation(() => ({
            getOrCreateCollection: jest.fn().mockResolvedValue(mockCollection),
        })),
        IncludeEnum: {
            documents: 'documents',
            metadatas: 'metadatas',
            distances: 'distances',
            embeddings: 'embeddings',
        },
    };
});

jest.mock('~/services/document-analyze/embeddingService.js', () => ({
    embeddingService: {
        embedChunks: jest.fn(),
        embedQuery: jest.fn(),
    },
}));

describe('ChromaVectorService', () => {
    let originalEnv: NodeJS.ProcessEnv;
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        consoleWarnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        originalEnv = { ...process.env };
        process.env.CHROMA_API_KEY = 'test-key';
        process.env.CHROMA_TENANT = 'test-tenant';
        process.env.CHROMA_DATABASE = 'test-db';
        delete process.env.CHROMA_COLLECTION; // To cover default collection branch
    });

    afterEach(() => {
        process.env = originalEnv;
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
        if (consoleWarnSpy) consoleWarnSpy.mockRestore();
    });

    it('should throw error if env vars are missing', async () => {
        delete process.env.CHROMA_API_KEY;
        await jest.isolateModulesAsync(async () => {
            await expect(
                import('~/services/document-analyze/chromaService.js')
            ).rejects.toThrow(
                'Missing ChromaDB environment variables: CHROMA_API_KEY, CHROMA_TENANT, CHROMA_DATABASE'
            );
        });
    });

    describe('upsertChunks', () => {
        let chromaVectorService: any;

        beforeEach(async () => {
            await jest.isolateModulesAsync(async () => {
                chromaVectorService = (
                    await import('~/services/document-analyze/chromaService.js')
                ).chromaVectorService;
            });
        });

        it('should return empty result if no chunks provided', async () => {
            const result = await chromaVectorService.upsertChunks([]);
            expect(result.chunkCount).toBe(0);
            expect(result.docIds).toEqual([]);
        });

        it('should upsert chunks and return vector dimension correctly', async () => {
            const chunks: DocumentChunk[] = [
                {
                    id: 'chunk1',
                    content: 'hello world',
                    metadata: {
                        userId: 'u1',
                        fileId: 'f1',
                        fileName: 'test.pdf',
                        chunkIndex: 0,
                        difficulty: 'CEFR_A1',
                        domain: ['business'],
                        language: 'en',
                    },
                },
            ];

            (embeddingService.embedChunks as jest.Mock).mockResolvedValue([
                [0.1, 0.2, 0.3],
            ]);
            mockCollection.upsert.mockResolvedValue(undefined);

            const result = await chromaVectorService.upsertChunks(chunks);

            expect(embeddingService.embedChunks).toHaveBeenCalledWith(chunks);
            expect(mockCollection.upsert).toHaveBeenCalledWith({
                ids: ['chunk1'],
                embeddings: [[0.1, 0.2, 0.3]],
                documents: ['hello world'],
                metadatas: [
                    {
                        userId: 'u1',
                        fileId: 'f1',
                        fileName: 'test.pdf',
                        chunkIndex: 0,
                        difficulty: 'CEFR_A1',
                        domain: 'business',
                        language: 'en',
                    },
                ],
            });
            expect(result.chunkCount).toBe(1);
            expect(result.chunkSize).toBe(2);
            expect(result.vectorDimension).toBe(3);
        });

        it('should handle chunks without optional metadata', async () => {
            const chunks: DocumentChunk[] = [
                {
                    id: 'chunk2',
                    content: 'no optional meta',
                    metadata: {
                        userId: 'u1',
                        fileId: 'f1',
                        fileName: 'test.pdf',
                        chunkIndex: 0,
                        // no difficulty, domain, language
                    },
                },
            ];

            (embeddingService.embedChunks as jest.Mock).mockResolvedValue([[]]);

            const result = await chromaVectorService.upsertChunks(chunks);
            expect(result.vectorDimension).toBe(0);
            expect(mockCollection.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    metadatas: [
                        {
                            userId: 'u1',
                            fileId: 'f1',
                            fileName: 'test.pdf',
                            chunkIndex: 0,
                        },
                    ],
                })
            );
        });

        it('should handle undefined content and embedding (branch coverage)', async () => {
            const chunks: any[] = [
                {
                    id: 'chunk3',
                    content: undefined,
                    metadata: {
                        userId: 'u1',
                        fileId: 'f1',
                        fileName: 'test.pdf',
                        chunkIndex: 0,
                    },
                },
            ];
            (embeddingService.embedChunks as jest.Mock).mockResolvedValue([
                undefined,
            ]);
            mockCollection.upsert.mockResolvedValue(undefined);
            const result = await chromaVectorService.upsertChunks(chunks);
            expect(result.chunkSize).toBe(0);
            expect(result.vectorDimension).toBe(0);
        });

        it('should use cached collection promise on subsequent calls', async () => {
            const chunks: DocumentChunk[] = [
                {
                    id: '1',
                    content: 'test',
                    metadata: {
                        userId: 'u',
                        fileId: 'f',
                        fileName: 'test',
                        chunkIndex: 0,
                    },
                },
            ];
            (embeddingService.embedChunks as jest.Mock).mockResolvedValue([
                [0.1],
            ]);
            mockCollection.upsert.mockResolvedValue(undefined);

            await chromaVectorService.upsertChunks(chunks);
            await chromaVectorService.upsertChunks(chunks);

            // Should only call getOrCreateCollection once
            const CloudClientMock = (await import('chromadb')).CloudClient;
            const instance = (CloudClientMock as jest.Mock).mock.results[0]
                .value;
            expect(instance.getOrCreateCollection).toHaveBeenCalledTimes(1);
        });
    });

    describe('query', () => {
        let chromaVectorService: any;

        beforeEach(async () => {
            await jest.isolateModulesAsync(async () => {
                chromaVectorService = (
                    await import('~/services/document-analyze/chromaService.js')
                ).chromaVectorService;
            });
        });

        it('should query correctly with optional fileIds and topK', async () => {
            (embeddingService.embedQuery as jest.Mock).mockResolvedValue([
                0.1, 0.2,
            ]);
            mockCollection.query.mockResolvedValue({
                documents: [['doc1', 'doc2']],
                metadatas: [
                    [
                        {
                            userId: 'u1',
                            fileId: 'f1',
                            fileName: 'test.pdf',
                            chunkIndex: 0,
                            difficulty: 'CEFR_A1',
                            domain: 'business,finance',
                            language: 'en',
                        },
                        {
                            userId: 'u1',
                            fileId: 'f2',
                            fileName: 'test2.pdf',
                            chunkIndex: 1,
                        },
                        null,
                    ],
                ],
                distances: [[0.5, 0.6]],
                ids: [['id1', 'id2']],
            });

            const result = await chromaVectorService.query({
                userId: 'u1',
                question: 'test question',
                fileIds: ['f1'],
                topK: 5,
            });

            expect(embeddingService.embedQuery).toHaveBeenCalledWith(
                'test question'
            );
            expect(mockCollection.query).toHaveBeenCalledWith({
                queryEmbeddings: [[0.1, 0.2]],
                where: { userId: 'u1', fileId: { $in: ['f1'] } },
                nResults: 5,
                include: [
                    IncludeEnum.documents,
                    IncludeEnum.metadatas,
                    IncludeEnum.distances,
                    IncludeEnum.embeddings,
                ],
            });

            expect(result.documents).toEqual(['doc1', 'doc2']);
            expect(result.distances).toEqual([0.5, 0.6]);
            expect(result.ids).toEqual(['id1', 'id2']);

            // Check metadata parsing (null should be filtered out)
            expect(result.metadatas).toHaveLength(2);
            expect(result.metadatas[0].domain).toEqual(['business', 'finance']);
            expect(result.metadatas[0].difficulty).toBe('CEFR_A1');
            expect(result.metadatas[0].language).toBe('en');

            // Check item without optional metadatas
            expect(result.metadatas[1].domain).toBeUndefined();
            expect(result.metadatas[1].difficulty).toBeUndefined();
            expect(result.metadatas[1].language).toBeUndefined();
        });

        it('should handle missing results and use default topK', async () => {
            (embeddingService.embedQuery as jest.Mock).mockResolvedValue([0.1]);
            mockCollection.query.mockResolvedValue({});

            const result = await chromaVectorService.query({
                userId: 'u1',
                question: 'test question',
            });

            expect(mockCollection.query).toHaveBeenCalledWith(
                expect.objectContaining({
                    nResults: 4,
                    where: { userId: 'u1' },
                })
            );

            expect(result.documents).toEqual([]);
            expect(result.metadatas).toEqual([]);
            expect(result.distances).toEqual([]);
            expect(result.ids).toEqual([]);
        });
    });

    describe('embeddingFn.generate', () => {
        let chromaVectorService: any;

        beforeEach(async () => {
            await jest.isolateModulesAsync(async () => {
                chromaVectorService = (
                    await import('~/services/document-analyze/chromaService.js')
                ).chromaVectorService;
            });
        });

        it('should call embeddingService.embedChunks when embeddingFn.generate is called', async () => {
            (embeddingService.embedChunks as jest.Mock).mockResolvedValue([
                [0.9, 0.9],
            ]);

            // Access private embeddingFn
            const embeddingFn = (chromaVectorService as any).embeddingFn;
            const res = await embeddingFn.generate(['test text']);

            expect(res).toEqual([[0.9, 0.9]]);
            expect(embeddingService.embedChunks).toHaveBeenCalledTimes(1);
            const passedChunks = (embeddingService.embedChunks as jest.Mock)
                .mock.calls[0][0];
            expect(passedChunks[0].content).toBe('test text');
            expect(passedChunks[0].metadata.userId).toBe('system');
        });
    });
});
