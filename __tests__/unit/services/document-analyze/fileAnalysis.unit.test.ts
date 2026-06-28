/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types } from 'mongoose';
import { fileIntelligenceService } from '~/services/document-analyze/fileAnalysis.js';
import { textExtractionService } from '~/services/document-analyze/textExtractionService.js';
jest.mock('dotenv', () => {
    const actual = jest.requireActual('dotenv');
    return {
        ...actual,
        config: (...args: any[]) => {
            const originalLog = console.log;
            console.log = jest.fn();
            const result = actual.config(...args);
            console.log = originalLog;
            return result;
        },
    };
});

jest.mock('mongoose', () => {
    const actual = jest.requireActual('mongoose');
    const originalEmitWarning = process.emitWarning;
    process.emitWarning = (warning: any, ...args: any[]) => {
        if (
            typeof warning === 'string' &&
            warning.includes('suppressReservedKeysWarning')
        ) {
            return;
        }
        if (args[0] === 'MongooseWarning') {
            return;
        }
        return originalEmitWarning(warning, ...args);
    };
    return actual;
});
import { contentModerationService } from '~/services/document-analyze/moderationService.js';
import { documentAnalysisService } from '~/services/document-analyze/analysisService.js';
import { chromaVectorService } from '~/services/document-analyze/chromaService.js';
import { FileMetadata } from '~/models/fileContentModel.js';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { extractTextFromMessage, composeUsage } from '~/utils/aiUtils.js';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { v4 as uuidv4 } from 'uuid';

jest.mock('~/services/document-analyze/textExtractionService.js');
jest.mock('~/services/document-analyze/moderationService.js');
jest.mock('~/services/document-analyze/analysisService.js');
jest.mock('~/services/document-analyze/chromaService.js');
jest.mock('~/models/fileContentModel.js');
jest.mock('~/ai/provider/googleGenAIClient.js');
jest.mock('~/utils/aiUtils.js');
jest.mock('uuid');
jest.mock('@langchain/textsplitters', () => ({
    RecursiveCharacterTextSplitter: jest.fn().mockImplementation(() => ({
        createDocuments: jest.fn(),
    })),
}));

describe('FileIntelligenceService', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;
    let mockSave: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        mockSave = jest.fn().mockResolvedValue(true);
        (FileMetadata as unknown as jest.Mock).mockImplementation((data) => ({
            ...data,
            save: mockSave,
        }));
    });

    afterEach(() => {
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (consoleWarnSpy) consoleWarnSpy.mockRestore();
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
    });

    const mockUserId = new Types.ObjectId().toString();
    const mockFile = {
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        size: 1000,
        encoding: '7bit',
    } as any;
    const mockUpload = {
        originalName: 'test.pdf',
        mimeType: 'application/pdf',
        url: 'http://s3/url',
        key: 's3/key',
    } as any;
    const mockParams = {
        file: mockFile,
        userId: mockUserId,
        upload: mockUpload,
    };

    describe('processUpload', () => {
        it('should throw if userId is invalid', async () => {
            (textExtractionService.extractText as jest.Mock).mockResolvedValue({
                text: 'sample text',
            });
            (contentModerationService.moderate as jest.Mock).mockResolvedValue({
                status: 'approved',
                categories: [],
            });
            await expect(
                fileIntelligenceService.processUpload({
                    ...mockParams,
                    userId: 'invalid',
                })
            ).rejects.toThrow('Invalid user id for file upload');
        });

        it('should process upload successfully (Happy Path)', async () => {
            (textExtractionService.extractText as jest.Mock).mockResolvedValue({
                text: 'sample text',
            });
            (contentModerationService.moderate as jest.Mock).mockResolvedValue({
                status: 'approved',
                categories: [],
            });

            const mockAnalysis = {
                language: 'en',
                toeicParts: { part2: true },
                tokenLength: 100,
                difficulty: 'CEFR_A1',
                domain: ['business'],
                additionalMetadata: { custom: 'data' },
            };
            (documentAnalysisService.analyze as jest.Mock).mockResolvedValue({
                analysis: mockAnalysis,
                response: 'raw_response',
            });

            (uuidv4 as jest.Mock).mockReturnValue('uuid-1');
            const mockCreateDocuments = jest
                .fn()
                .mockResolvedValue([{ pageContent: 'sample text' }]);
            (
                RecursiveCharacterTextSplitter as unknown as jest.Mock
            ).mockImplementation(() => ({
                createDocuments: mockCreateDocuments,
            }));

            (chromaVectorService.upsertChunks as jest.Mock).mockResolvedValue({
                docIds: ['doc-1'],
                chunkCount: 1,
                chunkSize: 10,
                vectorDimension: 1536,
            });

            (composeUsage as jest.Mock).mockReturnValue({ totalTokens: 50 });

            const result =
                await fileIntelligenceService.processUpload(mockParams);

            expect(result.metadata.status).toBe('processed');
            expect(result.metadata.language).toBe('en');
            expect(result.metadata.tagsPart).toEqual(['toeic_part2']);
            expect(result.metadata.metadata).toEqual({ custom: 'data' });
            expect(result.metadata.embedding!.docIds).toEqual(['doc-1']);
            expect(result.metadata.aiCost).toEqual({ totalTokens: 50 });
            expect(mockSave).toHaveBeenCalledTimes(1);
        });

        it('should handle flagged moderation but continue processing', async () => {
            (textExtractionService.extractText as jest.Mock).mockResolvedValue({
                text: 'text',
            });
            (contentModerationService.moderate as jest.Mock).mockResolvedValue({
                status: 'flagged',
                categories: [],
            });
            (documentAnalysisService.analyze as jest.Mock).mockResolvedValue({
                analysis: { toeicParts: {} },
            });
            (chromaVectorService.upsertChunks as jest.Mock).mockResolvedValue({
                docIds: [],
            });

            const result =
                await fileIntelligenceService.processUpload(mockParams);
            expect(result.metadata.status).toBe('flagged');
            expect(documentAnalysisService.analyze).toHaveBeenCalled();
            expect(chromaVectorService.upsertChunks).toHaveBeenCalled();
            expect(result.metadata.docId).toBeUndefined(); // Tests docIds[0] ?? undefined fallback
        });

        it('should handle rejected moderation and skip analysis/embedding', async () => {
            (textExtractionService.extractText as jest.Mock).mockResolvedValue({
                text: 'bad text',
            });
            (contentModerationService.moderate as jest.Mock).mockResolvedValue({
                status: 'rejected',
                categories: ['violence'],
            });

            const result =
                await fileIntelligenceService.processUpload(mockParams);
            expect(result.metadata.status).toBe('failed');
            expect(documentAnalysisService.analyze).not.toHaveBeenCalled();
            expect(chromaVectorService.upsertChunks).not.toHaveBeenCalled();
            expect(result.metadata.metadata).toEqual({});
        });

        it('should handle analysis failure and mark as failed', async () => {
            (textExtractionService.extractText as jest.Mock).mockResolvedValue({
                text: 'text',
            });
            (contentModerationService.moderate as jest.Mock).mockResolvedValue({
                status: 'approved',
                categories: [],
            });
            (documentAnalysisService.analyze as jest.Mock).mockRejectedValue(
                new Error('Analysis Error')
            );

            const result =
                await fileIntelligenceService.processUpload(mockParams);
            expect(result.metadata.status).toBe('failed');
            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(chromaVectorService.upsertChunks).not.toHaveBeenCalled();
        });

        it('should catch embedding error but continue', async () => {
            (textExtractionService.extractText as jest.Mock).mockResolvedValue({
                text: 'text',
            });
            (contentModerationService.moderate as jest.Mock).mockResolvedValue({
                status: 'approved',
                categories: [],
            });
            (documentAnalysisService.analyze as jest.Mock).mockResolvedValue({
                analysis: { toeicParts: {}, additionalMetadata: null },
            }); // null additionalMetadata to test default {}

            (
                RecursiveCharacterTextSplitter as unknown as jest.Mock
            ).mockImplementation(() => ({
                createDocuments: jest
                    .fn()
                    .mockResolvedValue([{ pageContent: 'chunk' }]),
            }));
            (chromaVectorService.upsertChunks as jest.Mock).mockRejectedValue(
                new Error('Chroma Error')
            );

            const result =
                await fileIntelligenceService.processUpload(mockParams);
            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(result.metadata.embedding).toBeUndefined();
            expect(mockSave).toHaveBeenCalled();
        });

        it('should handle when composeUsage returns undefined', async () => {
            (textExtractionService.extractText as jest.Mock).mockResolvedValue({
                text: 'text',
            });
            (contentModerationService.moderate as jest.Mock).mockResolvedValue({
                status: 'approved',
                categories: [],
            });
            (documentAnalysisService.analyze as jest.Mock).mockResolvedValue({
                analysis: { toeicParts: {} },
                response: 'rsp',
            });
            (chromaVectorService.upsertChunks as jest.Mock).mockResolvedValue({
                docIds: [],
            });
            (composeUsage as jest.Mock).mockReturnValue(undefined);

            const result =
                await fileIntelligenceService.processUpload(mockParams);
            expect(result.metadata.aiCost).toBeUndefined();
        });

        it('should use file defaults if upload metadata is missing', async () => {
            (textExtractionService.extractText as jest.Mock).mockResolvedValue({
                text: 'text',
            });
            (contentModerationService.moderate as jest.Mock).mockResolvedValue({
                status: 'approved',
                categories: [],
            });
            (documentAnalysisService.analyze as jest.Mock).mockResolvedValue({
                analysis: { toeicParts: {} },
            });
            (chromaVectorService.upsertChunks as jest.Mock).mockResolvedValue({
                docIds: [],
            });

            const partialUpload = { url: 'u', key: 'k' };
            const result = await fileIntelligenceService.processUpload({
                file: mockFile,
                userId: mockUserId,
                upload: partialUpload as any,
            });

            expect(result.metadata.fileName).toBe(mockFile.originalname);
            expect(result.metadata.fileType).toBe(mockFile.mimetype);
        });
    });

    describe('chat', () => {
        const mockModelInvoke = jest.fn();

        beforeEach(() => {
            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });
        });

        it('should return default message if no documents are found', async () => {
            (chromaVectorService.query as jest.Mock).mockResolvedValue({
                documents: [],
            });

            const result = await fileIntelligenceService.chat({
                userId: mockUserId,
                question: 'hello',
            });

            expect(result.answer).toContain('No matching content found');
            expect(result.references).toEqual([]);
            expect(mockModelInvoke).not.toHaveBeenCalled();
        });

        it('should return chat response with valid chunks and specific language', async () => {
            (chromaVectorService.query as jest.Mock).mockResolvedValue({
                documents: ['doc1 content'],
                metadatas: [
                    {
                        fileId: 'f1',
                        fileName: 'f1.pdf',
                        chunkIndex: 0,
                        difficulty: 'A1',
                        domain: ['business'],
                        language: 'vi',
                    },
                ],
                distances: [0.1],
                ids: ['id1'],
            });

            mockModelInvoke.mockResolvedValue('raw AI response');
            (extractTextFromMessage as jest.Mock).mockReturnValue('AI Answer');
            (composeUsage as jest.Mock).mockReturnValue({ totalTokens: 10 });

            const result = await fileIntelligenceService.chat({
                userId: mockUserId,
                question: 'hello',
                language: 'fr',
                topK: 5,
            });

            expect(chromaVectorService.query).toHaveBeenCalledWith({
                userId: mockUserId,
                question: 'hello',
                fileIds: undefined,
                topK: 5,
            });

            expect(mockModelInvoke).toHaveBeenCalledTimes(1);
            const promptArgs = mockModelInvoke.mock.calls[0][0];
            expect(promptArgs[0].content).toContain('doc1 content');
            expect(promptArgs[0].content).toContain('Answer (fr)'); // requested language

            expect(result.answer).toBe('AI Answer');
            expect(result.usage).toEqual({ totalTokens: 10 });
            expect(result.references).toHaveLength(1);
            expect(result.references[0].distance).toBe(0.1);
        });

        it('should fallback to detected language or en if options.language is missing', async () => {
            // First: detected language
            (chromaVectorService.query as jest.Mock).mockResolvedValue({
                documents: ['doc1'],
                metadatas: [{ language: 'de' }],
                distances: [],
            });
            mockModelInvoke.mockResolvedValue('rsp');
            await fileIntelligenceService.chat({
                userId: mockUserId,
                question: 'hi',
            });
            expect(mockModelInvoke.mock.calls[0][0][0].content).toContain(
                'Answer (de)'
            );

            mockModelInvoke.mockClear();

            // Second: fallback to en
            (chromaVectorService.query as jest.Mock).mockResolvedValue({
                documents: ['doc1'],
                metadatas: [{}], // no language
                distances: [null], // to test default distance 0
            });
            await fileIntelligenceService.chat({
                userId: mockUserId,
                question: 'hi',
            });
            expect(mockModelInvoke.mock.calls[0][0][0].content).toContain(
                'Answer (en)'
            );
        });
    });
});
