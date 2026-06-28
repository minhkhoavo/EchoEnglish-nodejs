/* eslint-disable @typescript-eslint/no-explicit-any */
import { DocumentChunk } from '~/services/document-analyze/types.js';

const mockEmbedDocuments = jest.fn();
const mockEmbedQuery = jest.fn();

jest.mock('@langchain/google-genai', () => ({
    GoogleGenerativeAIEmbeddings: jest.fn().mockImplementation(() => ({
        embedDocuments: mockEmbedDocuments,
        embedQuery: mockEmbedQuery,
    })),
}));

describe('EmbeddingService', () => {
    let originalEnv: NodeJS.ProcessEnv;
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        originalEnv = { ...process.env };
        process.env.GENAI_API_KEY = 'test-api-key';
        process.env.GENAI_EMBEDDING_MODEL = 'test-model';

        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        process.env = originalEnv;
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (consoleWarnSpy) consoleWarnSpy.mockRestore();
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
    });

    describe('Initialization', () => {
        it('should warn if Gemini API key is missing', async () => {
            delete process.env.GENAI_API_KEY;
            delete process.env.GOOGLE_API_KEY;
            delete process.env.GOOGLE_GENAI_API_KEY;

            await jest.isolateModulesAsync(async () => {
                await import('~/services/document-analyze/embeddingService.js');
            });

            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[EmbeddingService] Missing Gemini API key. Embeddings will fail.'
            );
        });

        it('should return correct modelName', async () => {
            await jest.isolateModulesAsync(async () => {
                const { embeddingService } = await import(
                    '~/services/document-analyze/embeddingService.js'
                );
                expect(embeddingService.modelName).toBe('test-model');
            });
        });

        it('should fallback to default modelName if env is missing', async () => {
            delete process.env.GENAI_EMBEDDING_MODEL;
            await jest.isolateModulesAsync(async () => {
                const { embeddingService } = await import(
                    '~/services/document-analyze/embeddingService.js'
                );
                expect(embeddingService.modelName).toBe('gemini-embedding-001');
            });
        });
    });

    describe('embedChunks', () => {
        let embeddingService: any;

        beforeEach(async () => {
            await jest.isolateModulesAsync(async () => {
                embeddingService = (
                    await import(
                        '~/services/document-analyze/embeddingService.js'
                    )
                ).embeddingService;
            });
        });

        const mockChunks: DocumentChunk[] = [
            {
                id: '1',
                content: 'text 1',
                metadata: {
                    userId: 'u1',
                    fileId: 'f1',
                    fileName: 'f',
                    chunkIndex: 0,
                },
            },
            {
                id: '2',
                content: 'text 2',
                metadata: {
                    userId: 'u1',
                    fileId: 'f1',
                    fileName: 'f',
                    chunkIndex: 1,
                },
            },
        ];

        it('should embed chunks successfully', async () => {
            mockEmbedDocuments.mockResolvedValue([
                [0.1, 0.2],
                [0.3, 0.4],
            ]);
            const result = await embeddingService.embedChunks(mockChunks);
            expect(result).toEqual([
                [0.1, 0.2],
                [0.3, 0.4],
            ]);
            expect(mockEmbedDocuments).toHaveBeenCalledWith([
                'text 1',
                'text 2',
            ]);
        });

        it('should throw if api returns undefined or null embeddings', async () => {
            mockEmbedDocuments.mockResolvedValue(null);
            await expect(
                embeddingService.embedChunks(mockChunks)
            ).rejects.toThrow(
                'Gemini API returned empty or invalid embeddings'
            );
        });

        it('should throw if api returns empty embeddings array', async () => {
            mockEmbedDocuments.mockResolvedValue([]);
            await expect(
                embeddingService.embedChunks(mockChunks)
            ).rejects.toThrow(
                'Gemini API returned empty or invalid embeddings'
            );
        });

        it('should throw if any single embedding is empty or undefined', async () => {
            mockEmbedDocuments.mockResolvedValue([[0.1], [], [0.2]]);
            await expect(
                embeddingService.embedChunks(mockChunks)
            ).rejects.toThrow(
                'Gemini API returned empty or invalid embeddings'
            );

            mockEmbedDocuments.mockResolvedValue([[0.1], undefined, [0.2]]);
            await expect(
                embeddingService.embedChunks(mockChunks)
            ).rejects.toThrow(
                'Gemini API returned empty or invalid embeddings'
            );
        });

        it('should catch and wrap API errors', async () => {
            mockEmbedDocuments.mockRejectedValue(
                new Error('API quota exceeded')
            );
            await expect(
                embeddingService.embedChunks(mockChunks)
            ).rejects.toThrow(
                'Embedding failed for 2 chunks: API quota exceeded'
            );
            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        it('should catch and wrap non-Error exceptions', async () => {
            mockEmbedDocuments.mockRejectedValue('String error');
            await expect(
                embeddingService.embedChunks(mockChunks)
            ).rejects.toThrow('Embedding failed for 2 chunks: Unknown error');
        });
    });

    describe('embedQuery', () => {
        let embeddingService: any;

        beforeEach(async () => {
            await jest.isolateModulesAsync(async () => {
                embeddingService = (
                    await import(
                        '~/services/document-analyze/embeddingService.js'
                    )
                ).embeddingService;
            });
        });

        it('should embed query successfully', async () => {
            mockEmbedQuery.mockResolvedValue([0.5, 0.6]);
            const result = await embeddingService.embedQuery('search this');
            expect(result).toEqual([0.5, 0.6]);
            expect(mockEmbedQuery).toHaveBeenCalledWith('search this');
        });

        it('should throw if api returns empty or undefined embedding', async () => {
            mockEmbedQuery.mockResolvedValue([]);
            await expect(embeddingService.embedQuery('q')).rejects.toThrow(
                'Gemini API returned empty embedding for query'
            );

            mockEmbedQuery.mockResolvedValue(null);
            await expect(embeddingService.embedQuery('q')).rejects.toThrow(
                'Gemini API returned empty embedding for query'
            );
        });

        it('should catch and wrap API errors', async () => {
            mockEmbedQuery.mockRejectedValue(new Error('Network error'));
            await expect(embeddingService.embedQuery('q')).rejects.toThrow(
                'Embedding failed for query: Network error'
            );
            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        it('should catch and wrap non-Error exceptions', async () => {
            mockEmbedQuery.mockRejectedValue({ code: 500 });
            await expect(embeddingService.embedQuery('q')).rejects.toThrow(
                'Embedding failed for query: Unknown error'
            );
        });
    });
});
