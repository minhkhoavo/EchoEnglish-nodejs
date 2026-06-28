/* eslint-disable @typescript-eslint/no-explicit-any */
import { knowledgeBaseService } from '~/services/knowledgeBase/knowledgeBaseService.js';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { v4 as uuidv4 } from 'uuid';
import { chromaVectorService } from '~/services/document-analyze/chromaService.js';
import { textExtractionService } from '~/services/document-analyze/textExtractionService.js';
import { Resource } from '~/models/resource.js';
import S3Service from '~/services/s3Service.js';

jest.mock('@langchain/textsplitters');
jest.mock('uuid');
jest.mock('~/services/document-analyze/embeddingService.js', () => ({
    embeddingService: {},
}));
jest.mock('~/services/document-analyze/chromaService.js', () => ({
    chromaVectorService: {
        upsertChunks: jest.fn(),
        query: jest.fn(),
    },
}));
jest.mock('~/services/document-analyze/textExtractionService.js');
jest.mock('~/models/resource.js');
jest.mock('~/services/s3Service.js');

const mockRecursiveCharacterTextSplitter =
    RecursiveCharacterTextSplitter as jest.MockedClass<
        typeof RecursiveCharacterTextSplitter
    >;
const mockUuidv4 = uuidv4 as jest.Mock;
const mockChromaVectorService = chromaVectorService as jest.Mocked<
    typeof chromaVectorService
>;
const mockTextExtractionService = textExtractionService as jest.Mocked<
    typeof textExtractionService
>;
const mockResource = Resource as jest.Mocked<typeof Resource>;
const mockS3Service = S3Service as jest.Mocked<typeof S3Service>;

describe('KnowledgeBaseService', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (consoleWarnSpy) consoleWarnSpy.mockRestore();
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
    });

    describe('htmlToPlainText', () => {
        it('should strip HTML tags and scripts correctly', () => {
            const html =
                '<style>.css{}</style><script>alert("x")</script><div>Hello &amp; <b>World</b>&nbsp;!&lt;&gt;&quot;</div>';
            const result = (knowledgeBaseService as any).htmlToPlainText(html);
            expect(result).toBe('Hello & World !<>"');
        });

        it('should return empty string if falsy', () => {
            expect((knowledgeBaseService as any).htmlToPlainText('')).toBe('');
            expect(
                (knowledgeBaseService as any).htmlToPlainText(undefined)
            ).toBe('');
        });
    });

    describe('extractTextFromAttachment', () => {
        it('should return empty string if no file buffer', async () => {
            mockS3Service.downloadFile.mockResolvedValueOnce(undefined as any);
            const result = await (
                knowledgeBaseService as any
            ).extractTextFromAttachment('http://example.com/file.pdf');
            expect(result).toBe('');
        });

        it('should extract text from pdf correctly', async () => {
            mockS3Service.downloadFile.mockResolvedValueOnce(
                Buffer.from('dummy')
            );
            mockTextExtractionService.extractText.mockResolvedValueOnce({
                text: 'Extracted PDF text',
            } as any);
            const result = await (
                knowledgeBaseService as any
            ).extractTextFromAttachment('http://example.com/file.pdf');
            expect(result).toBe('Extracted PDF text');
            expect(mockTextExtractionService.extractText).toHaveBeenCalledWith(
                expect.objectContaining({ mimetype: 'application/pdf' })
            );
        });

        it('should extract text from docx correctly', async () => {
            mockS3Service.downloadFile.mockResolvedValueOnce(
                Buffer.from('dummy')
            );
            mockTextExtractionService.extractText.mockResolvedValueOnce({
                text: 'Extracted DOCX text',
            } as any);
            const result = await (
                knowledgeBaseService as any
            ).extractTextFromAttachment('http://example.com/file.docx');
            expect(result).toBe('Extracted DOCX text');
            expect(mockTextExtractionService.extractText).toHaveBeenCalledWith(
                expect.objectContaining({
                    mimetype:
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                })
            );
        });

        it('should extract text from txt correctly', async () => {
            mockS3Service.downloadFile.mockResolvedValueOnce(
                Buffer.from('dummy')
            );
            mockTextExtractionService.extractText.mockResolvedValueOnce({
                text: 'Extracted TXT text',
            } as any);
            const result = await (
                knowledgeBaseService as any
            ).extractTextFromAttachment('http://example.com/file.txt');
            expect(result).toBe('Extracted TXT text');
            expect(mockTextExtractionService.extractText).toHaveBeenCalledWith(
                expect.objectContaining({ mimetype: 'text/plain' })
            );
        });

        it('should fallback to default mimetype', async () => {
            mockS3Service.downloadFile.mockResolvedValueOnce(
                Buffer.from('dummy')
            );
            mockTextExtractionService.extractText.mockResolvedValueOnce({
                text: 'Extracted OTHER text',
            } as any);
            const result = await (
                knowledgeBaseService as any
            ).extractTextFromAttachment('http://example.com/file.xyz');
            expect(result).toBe('Extracted OTHER text');
            expect(mockTextExtractionService.extractText).toHaveBeenCalledWith(
                expect.objectContaining({
                    mimetype: 'application/octet-stream',
                })
            );
        });

        it('should handle extensionless file', async () => {
            (S3Service.downloadFile as jest.Mock).mockResolvedValue(
                Buffer.from('test')
            );
            (textExtractionService.extractText as jest.Mock).mockResolvedValue({
                text: 'content',
            });

            const result = await (
                knowledgeBaseService as any
            ).extractTextFromAttachment('http://bucket/file_no_ext');
            expect(result).toBe('content');
            expect(textExtractionService.extractText).toHaveBeenCalledWith(
                expect.objectContaining({
                    mimetype: 'application/octet-stream',
                })
            );
        });

        it('should handle empty extension file', async () => {
            (S3Service.downloadFile as jest.Mock).mockResolvedValue(
                Buffer.from('test')
            );
            (textExtractionService.extractText as jest.Mock).mockResolvedValue({
                text: 'content',
            });

            const result = await (
                knowledgeBaseService as any
            ).extractTextFromAttachment('http://bucket/file.');
            expect(result).toBe('content');
            expect(textExtractionService.extractText).toHaveBeenCalledWith(
                expect.objectContaining({
                    mimetype: 'application/octet-stream',
                })
            );
        });
        it('should catch error and return empty string', async () => {
            mockS3Service.downloadFile.mockRejectedValueOnce(
                new Error('S3 error')
            );
            const result = await (
                knowledgeBaseService as any
            ).extractTextFromAttachment('http://example.com/file.pdf');
            expect(result).toBe('');
            expect(consoleErrorSpy).toHaveBeenCalled();
        });
    });

    describe('indexArticle', () => {
        beforeEach(() => {
            mockUuidv4.mockReturnValue('uuid-123');
            (mockResource.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue({});
            mockRecursiveCharacterTextSplitter.mockImplementation(() => {
                return {
                    createDocuments: jest
                        .fn()
                        .mockResolvedValue([
                            { pageContent: 'chunk 1' },
                            { pageContent: 'chunk 2' },
                        ]),
                } as any;
            });
        });

        it('should return no content if title and body are empty', async () => {
            const result = await knowledgeBaseService.indexArticle({
                resourceId: 'r1',
                title: ' ',
                content: ' ',
            });
            expect(result).toEqual({
                success: false,
                chunksCount: 0,
                message: 'No content to index',
            });
        });

        it('should index correctly without attachment', async () => {
            const result = await knowledgeBaseService.indexArticle({
                resourceId: 'r1',
                title: 'Title',
                content: 'Body content',
            });
            expect(result.success).toBe(true);
            expect(result.chunksCount).toBe(2);
            expect(mockChromaVectorService.upsertChunks).toHaveBeenCalledWith([
                expect.objectContaining({
                    id: 'r1_chunk_0_uuid-123',
                    content: 'chunk 1',
                }),
                expect.objectContaining({
                    id: 'r1_chunk_1_uuid-123',
                    content: 'chunk 2',
                }),
            ]);
            expect(mockResource.findByIdAndUpdate).toHaveBeenCalledWith('r1', {
                isIndexed: true,
            });
        });

        it('should index correctly with attachment', async () => {
            jest.spyOn(
                knowledgeBaseService as any,
                'extractTextFromAttachment'
            ).mockResolvedValue('file content');

            const result = await knowledgeBaseService.indexArticle({
                resourceId: '123',
                title: 'title',
                content: 'body',
                attachmentUrl: 'http://file.pdf',
            });

            expect(result.success).toBe(true);
            expect(chromaVectorService.upsertChunks).toHaveBeenCalled();
        });

        it('should not append attachment text if extractTextFromAttachment returns empty', async () => {
            jest.spyOn(
                knowledgeBaseService as any,
                'extractTextFromAttachment'
            ).mockResolvedValue('');

            const result = await knowledgeBaseService.indexArticle({
                resourceId: '123',
                title: 'title',
                content: 'body',
                attachmentUrl: 'http://file.pdf',
            });

            expect(result.success).toBe(true);
            // It should only index title and body
            expect(chromaVectorService.upsertChunks).toHaveBeenCalled();
        });

        it('should handle attachment extraction failure gracefully', async () => {
            jest.spyOn(
                knowledgeBaseService as any,
                'extractTextFromAttachment'
            ).mockRejectedValue(new Error('Extract error'));
            const result = await knowledgeBaseService.indexArticle({
                resourceId: 'r1',
                title: 'Title',
                content: 'Body content',
                attachmentUrl: 'http://a.com/f.pdf',
            });
            expect(result.success).toBe(true);
            expect(consoleErrorSpy).toHaveBeenCalled();
        });
    });

    describe('queryKnowledge', () => {
        it('should return mapped results', async () => {
            mockChromaVectorService.query.mockResolvedValueOnce({
                documents: ['doc1', 'doc2'],
                metadatas: [
                    { fileId: 'f1', fileName: 'file 1' },
                    { fileId: 'f2', fileName: 'file 2' },
                ],
                distances: [0.1, 0.2],
            } as any);

            const result = await knowledgeBaseService.queryKnowledge({
                query: 'q',
                topK: 2,
            });
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                content: 'doc1',
                resourceId: 'f1',
                title: 'file 1',
                score: 0.9,
            });
            expect(result[1]).toEqual({
                content: 'doc2',
                resourceId: 'f2',
                title: 'file 2',
                score: 0.8,
            });
        });

        it('should fallback to distance 1 if null', async () => {
            mockChromaVectorService.query.mockResolvedValueOnce({
                documents: ['doc1'],
                metadatas: [{ fileId: 'f1', fileName: 'file 1' }],
                distances: [null],
            } as any);

            const result = await knowledgeBaseService.queryKnowledge({
                query: 'q',
            });
            expect(result[0].score).toBe(0);
        });

        it('should return empty if no documents', async () => {
            mockChromaVectorService.query.mockResolvedValueOnce({
                documents: [],
                metadatas: [],
                distances: [],
            } as any);

            const result = await knowledgeBaseService.queryKnowledge({
                query: 'q',
            });
            expect(result).toEqual([]);
        });
    });

    describe('getKnowledgeContext', () => {
        it('should return null if no results', async () => {
            jest.spyOn(
                knowledgeBaseService,
                'queryKnowledge'
            ).mockResolvedValueOnce([]);
            const result =
                await knowledgeBaseService.getKnowledgeContext('topic');
            expect(result).toBeNull();
        });

        it('should format text appropriately', async () => {
            jest.spyOn(
                knowledgeBaseService,
                'queryKnowledge'
            ).mockResolvedValueOnce([
                { content: 'c1', resourceId: 'r1', title: 't1', score: 1 },
                { content: 'c2', resourceId: 'r2', title: 't2', score: 1 },
            ]);
            const result =
                await knowledgeBaseService.getKnowledgeContext('topic');
            expect(result).toBe(
                '--- From "t1" ---\nc1\n\n--- From "t2" ---\nc2'
            );
        });
    });

    describe('removeFromIndex', () => {
        it('should update resource isIndexed to false', async () => {
            (mockResource.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue({});
            await knowledgeBaseService.removeFromIndex('res1');
            expect(mockResource.findByIdAndUpdate).toHaveBeenCalledWith(
                'res1',
                { isIndexed: false }
            );
        });
    });

    describe('reindexAllArticles', () => {
        it('should correctly process all articles with mixed results', async () => {
            (mockResource.find as any) = jest.fn().mockResolvedValue([
                { _id: '1', title: 't1', content: 'c1' },
                { _id: '2', title: 't2', content: 'c2' },
                { _id: '3' }, // missing fields -> fallback title/content, error in extraction
            ]);

            jest.spyOn(knowledgeBaseService, 'indexArticle')
                .mockResolvedValueOnce({
                    success: true,
                    chunksCount: 2,
                    message: '',
                })
                .mockResolvedValueOnce({
                    success: true,
                    chunksCount: 1,
                    message: '',
                })
                .mockRejectedValueOnce(new Error('fail'));

            const result = await knowledgeBaseService.reindexAllArticles();
            expect(result).toEqual({ total: 3, success: 2, failed: 1 });
            expect(knowledgeBaseService.indexArticle).toHaveBeenCalledWith({
                resourceId: '3',
                title: 'Untitled',
                content: '',
                attachmentUrl: undefined,
            });
        });
    });
});
