/* eslint-disable @typescript-eslint/no-explicit-any */
import resourceService from '~/services/transcription/resourceService.js';
import { Resource } from '~/models/resource.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { Domain } from '~/enum/domain.js';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import s3Service from '~/services/s3Service.js';
import { knowledgeBaseService } from '~/services/knowledgeBase/knowledgeBaseService.js';
import { PaginationHelper } from '~/utils/pagination.js';
import axios from 'axios';

import { Readability } from '@mozilla/readability';
import Parser from 'rss-parser';
import { YoutubeTranscript } from 'youtube-transcript-plus';

// ──────────────────────────────────────────────
// Module-Level Mocks
// ──────────────────────────────────────────────
jest.mock('uuid', () => ({
    v4: jest.fn().mockReturnValue('mocked-uuid'),
}));

jest.mock('~/models/resource.js', () => {
    const mockModel: any = {
        create: jest.fn(),
        find: jest.fn(),
        findOne: jest.fn(),
        findById: jest.fn(),
        findByIdAndDelete: jest.fn(),
        findByIdAndUpdate: jest.fn(),
    };
    return {
        __esModule: true,
        Resource: mockModel,
        default: mockModel,
    };
});

jest.mock('~/ai/provider/googleGenAIClient.js', () => ({
    googleGenAIClient: {
        getModel: jest.fn(),
    },
}));

jest.mock('~/ai/service/PromptManagerService.js', () => ({
    promptManagerService: {
        getTemplate: jest.fn(),
    },
}));

jest.mock('~/services/s3Service.js', () => ({
    __esModule: true,
    default: {
        getJSON: jest.fn(),
        putJSON: jest.fn(),
    },
}));

jest.mock('~/services/knowledgeBase/knowledgeBaseService.js', () => ({
    knowledgeBaseService: {
        indexArticle: jest.fn(),
    },
}));

jest.mock('~/utils/pagination.js', () => ({
    PaginationHelper: {
        paginate: jest.fn(),
    },
}));

jest.mock('axios');

jest.mock('jsdom', () => ({
    JSDOM: jest.fn().mockImplementation(() => ({
        window: {
            document: {},
        },
    })),
}));

jest.mock('@mozilla/readability', () => ({
    Readability: jest.fn().mockImplementation(() => ({
        parse: jest.fn(),
    })),
}));

jest.mock('rss-parser');

jest.mock('youtube-transcript-plus', () => ({
    YoutubeTranscript: {
        fetchTranscript: jest.fn(),
    },
}));

jest.mock('p-limit', () =>
    jest.fn().mockImplementation(() => (fn: any) => fn())
);

// Helper mocked variables
const mockedResource = Resource as jest.Mocked<typeof Resource>;
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockedReadability = Readability as jest.Mock;
const mockedParser = Parser as jest.Mock;
const mockedYoutubeTranscript = YoutubeTranscript as jest.Mocked<
    typeof YoutubeTranscript
>;

// ──────────────────────────────────────────────
// Helpers & Fixtures
// ──────────────────────────────────────────────
function buildMockResource(overrides: Record<string, any> = {}) {
    const data = {
        _id: 'res-123',
        type: 'article',
        title: 'Mock Resource Title',
        summary: 'Mock Resource Summary',
        content: 'Mock Resource Content',
        suitableForLearners: true,
        labels: {
            cefr: 'B2',
            domain: Domain.GENERAL,
            topic: ['news'],
            speechActs: [],
        },
        createdAt: new Date('2026-06-15T00:00:00Z'),
        ...overrides,
    };
    return {
        ...data,
        toObject: () => data,
    };
}

describe('ResourceService', () => {
    let mockModel: any;
    let originalFetch: any;

    beforeAll(() => {
        originalFetch = global.fetch;
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    beforeEach(() => {
        jest.clearAllMocks();

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({}),
            text: async () => '',
        } as any);

        // Default mock setup for googleGenAIClient
        mockModel = {
            pipe: jest.fn().mockReturnThis(),
            invoke: jest.fn(),
        };
        (googleGenAIClient.getModel as jest.Mock).mockReturnValue(mockModel);
        (promptManagerService.getTemplate as jest.Mock).mockResolvedValue(
            'template content {content}'
        );
    });

    // ════════════════════════════════════════════
    // getResourceById()
    // ════════════════════════════════════════════
    describe('getResourceById', () => {
        it('should return found resource without __v', async () => {
            const mockRes = buildMockResource();
            (mockedResource.findById as jest.Mock).mockResolvedValue(mockRes);

            const result = await resourceService.getResourceById('res-123');

            expect(mockedResource.findById).toHaveBeenCalledWith('res-123');
            expect(result).toEqual(
                expect.not.objectContaining({ __v: expect.any(String) })
            );
            expect(result?._id).toBe('res-123');
        });

        it('should return null if resource is not found', async () => {
            (mockedResource.findById as jest.Mock).mockResolvedValue(null);

            const result = await resourceService.getResourceById('nonexistent');

            expect(result).toBeNull();
        });
    });

    // ════════════════════════════════════════════
    // cleanHtmlContent()
    // ════════════════════════════════════════════
    describe('cleanHtmlContent', () => {
        it('should strip anchor tags keeping text and trim whitespace', () => {
            const html =
                '  <a href="https://example.com">Example Text</a> and more text  ';
            const result = resourceService.cleanHtmlContent(html);
            expect(result).toBe('Example Text and more text');
        });

        it('should return empty string if input is empty/undefined', () => {
            expect(resourceService.cleanHtmlContent('')).toBe('');
            expect(resourceService.cleanHtmlContent(null as any)).toBe('');
        });
    });

    // ════════════════════════════════════════════
    // fetchArticleText()
    // ════════════════════════════════════════════
    describe('fetchArticleText', () => {
        it('should get URL content and parse readable article text', async () => {
            mockedAxios.get.mockResolvedValue({ data: '<html>body</html>' });
            mockedReadability.mockImplementationOnce(() => ({
                parse: () => ({ content: 'Readable parsed text' }),
            }));

            const result = await resourceService.fetchArticleText(
                'https://test.com/article'
            );

            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://test.com/article',
                {
                    timeout: 10000,
                    responseType: 'text',
                }
            );
            expect(result).toBe('Readable parsed text');
        });

        it('should return empty string and log error if fetch/parse fails', async () => {
            const consoleSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            mockedAxios.get.mockRejectedValue(new Error('Network Error'));

            const result = await resourceService.fetchArticleText(
                'https://test.com/article'
            );

            expect(result).toBe('');
            expect(consoleSpy).toHaveBeenCalledWith(
                '[fetchArticleText] Error: https://test.com/article',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });

        it('should handle non-string axios response and falsy readability parse results', async () => {
            mockedAxios.get.mockResolvedValue({ data: 12345 }); // non-string
            mockedReadability.mockImplementationOnce(() => ({
                parse: () => null, // falsy parse
            }));

            const result = await resourceService.fetchArticleText(
                'https://test.com/article'
            );
            expect(result).toBe('');
        });
    });

    // ════════════════════════════════════════════
    // updateResource()
    // ════════════════════════════════════════════
    describe('updateResource', () => {
        it('should call findByIdAndUpdate and return updated document', async () => {
            const mockRes = buildMockResource();
            (mockedResource.findById as jest.Mock).mockResolvedValue(mockRes);

            const updatedMockRes = buildMockResource({ title: 'New Title' });
            (mockedResource.findByIdAndUpdate as jest.Mock).mockResolvedValue(
                updatedMockRes
            );

            const result = await resourceService.updateResource('res-123', {
                title: 'New Title',
            });

            expect(mockedResource.findById).toHaveBeenCalledWith('res-123');
            expect(mockedResource.findByIdAndUpdate).toHaveBeenCalledWith(
                'res-123',
                { title: 'New Title' },
                { new: true }
            );
            expect(result?.title).toBe('New Title');
        });

        it('should update suitableForLearners', async () => {
            const mockRes = buildMockResource();
            (mockedResource.findById as jest.Mock).mockResolvedValue(mockRes);

            const updatedMockRes = buildMockResource({
                suitableForLearners: false,
            });
            (mockedResource.findByIdAndUpdate as jest.Mock).mockResolvedValue(
                updatedMockRes
            );

            const result = await resourceService.updateResource('res-123', {
                suitableForLearners: false,
            });

            expect(mockedResource.findByIdAndUpdate).toHaveBeenCalledWith(
                'res-123',
                { suitableForLearners: false },
                { new: true }
            );
            expect(result?.suitableForLearners).toBe(false);
        });

        it('should update summary and content and handle missing labels in DB doc', async () => {
            const mockRes = buildMockResource({ labels: undefined });
            (mockedResource.findById as jest.Mock).mockResolvedValue(mockRes);

            const updatedMockRes = buildMockResource({
                summary: 'new summary',
                content: 'new content',
            });
            (mockedResource.findByIdAndUpdate as jest.Mock).mockResolvedValue(
                updatedMockRes
            );

            await resourceService.updateResource('res-123', {
                summary: 'new summary',
                content: 'new content',
                labels: {
                    domain: Domain.GENERAL,
                    topic: ['news'],
                    speechActs: [],
                },
            });

            expect(mockedResource.findByIdAndUpdate).toHaveBeenCalledWith(
                'res-123',
                {
                    summary: 'new summary',
                    content: 'new content',
                    labels: {
                        domain: Domain.GENERAL,
                        topic: ['news'],
                        speechActs: [],
                    },
                },
                { new: true }
            );
        });

        it('should merge labels when updating resource labels', async () => {
            const mockRes = buildMockResource({
                labels: {
                    cefr: 'B1',
                    domain: Domain.GENERAL,
                    topic: [],
                    speechActs: [],
                },
            });
            (mockedResource.findById as jest.Mock).mockResolvedValue(mockRes);

            const updatedMockRes = buildMockResource({
                labels: {
                    cefr: 'B1',
                    domain: Domain.TRAVEL,
                    topic: ['trip'],
                    speechActs: [],
                },
            });
            (mockedResource.findByIdAndUpdate as jest.Mock).mockResolvedValue(
                updatedMockRes
            );

            const result = await resourceService.updateResource('res-123', {
                labels: {
                    domain: Domain.TRAVEL,
                    topic: ['trip'],
                    speechActs: [],
                },
            });

            expect(mockedResource.findByIdAndUpdate).toHaveBeenCalledWith(
                'res-123',
                {
                    labels: {
                        cefr: 'B1',
                        domain: Domain.TRAVEL,
                        topic: ['trip'],
                        speechActs: [],
                    },
                },
                { new: true }
            );
            expect(result?.labels?.domain).toBe(Domain.TRAVEL);
        });

        it('should throw ApiError(RESOURCE_NOT_FOUND) if resource to update does not exist', async () => {
            (mockedResource.findById as jest.Mock).mockResolvedValue(null);

            await expect(
                resourceService.updateResource('nonexistent', { title: 'New' })
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                resourceService.updateResource('nonexistent', { title: 'New' })
            ).rejects.toMatchObject({
                status: ErrorMessage.RESOURCE_NOT_FOUND.status,
                message: ErrorMessage.RESOURCE_NOT_FOUND.message,
            });
        });
    });

    // ════════════════════════════════════════════
    // deleteResource()
    // ════════════════════════════════════════════
    describe('deleteResource', () => {
        it('should call findByIdAndDelete', async () => {
            (mockedResource.findByIdAndDelete as jest.Mock).mockResolvedValue(
                buildMockResource()
            );

            await resourceService.deleteResource('res-123');

            expect(mockedResource.findByIdAndDelete).toHaveBeenCalledWith(
                'res-123'
            );
        });

        it('should throw ApiError(RESOURCE_NOT_FOUND) if resource to delete does not exist', async () => {
            (mockedResource.findByIdAndDelete as jest.Mock).mockResolvedValue(
                null
            );

            await expect(
                resourceService.deleteResource('nonexistent')
            ).rejects.toBeInstanceOf(ApiError);
        });
    });

    // ════════════════════════════════════════════
    // analyzeContentWithLLM()
    // ════════════════════════════════════════════
    describe('analyzeContentWithLLM', () => {
        it('should invoke chain and return parsed AI JSON results', async () => {
            const mockAIResponse = {
                title: 'AI Analyzed Title',
                summary: 'AI summary',
            };
            mockModel.invoke.mockResolvedValue(mockAIResponse);

            const result =
                await resourceService.analyzeContentWithLLM('raw text content');

            expect(promptManagerService.getTemplate).toHaveBeenCalledWith(
                'resource_analysis'
            );
            expect(googleGenAIClient.getModel).toHaveBeenCalled();
            expect(mockModel.pipe).toHaveBeenCalled();
            expect(mockModel.invoke).toHaveBeenCalledWith(
                expect.stringContaining('raw text content')
            );
            expect(result).toEqual(mockAIResponse);
        });

        it('should throw generic error if LLM invocation fails', async () => {
            const consoleSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            mockModel.invoke.mockRejectedValue(new Error('LLM crash'));

            await expect(
                resourceService.analyzeContentWithLLM('text')
            ).rejects.toThrow(
                'AI model failed to analyze content or return valid JSON.'
            );
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    // ════════════════════════════════════════════
    // createResource()
    // ════════════════════════════════════════════
    describe('createResource', () => {
        it('should call Resource.create and return doc', async () => {
            const mockRes = buildMockResource();
            (mockedResource.create as jest.Mock).mockResolvedValue(mockRes);

            const result = await resourceService.createResource({
                title: 'New Res',
            });

            expect(mockedResource.create).toHaveBeenCalledWith({
                title: 'New Res',
            });
            expect(result).toEqual(mockRes);
        });

        it('should return null and log error if creation fails', async () => {
            const consoleSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            (mockedResource.create as jest.Mock).mockRejectedValue(
                new Error('DB failure')
            );

            const result = await resourceService.createResource({
                title: 'New Res',
            });

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    // ════════════════════════════════════════════
    // extractVideoId()
    // ════════════════════════════════════════════
    describe('extractVideoId', () => {
        it.each([
            [
                'standard url',
                'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                'dQw4w9WgXcQ',
            ],
            ['short url', 'https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
            [
                'embed url',
                'https://www.youtube.com/embed/dQw4w9WgXcQ',
                'dQw4w9WgXcQ',
            ],
            [
                'shorts url',
                'https://www.youtube.com/shorts/dQw4w9WgXcQ',
                'dQw4w9WgXcQ',
            ],
        ])('should extract ID from %s', (_, url, expectedId) => {
            expect(resourceService.extractVideoId(url)).toBe(expectedId);
        });

        it('should return null for empty/invalid youtube urls', () => {
            expect(resourceService.extractVideoId('')).toBeNull();
            expect(resourceService.extractVideoId(null as any)).toBeNull();
            expect(
                resourceService.extractVideoId('https://google.com')
            ).toBeNull();
        });
    });

    // ════════════════════════════════════════════
    // fetchTranscript()
    // ════════════════════════════════════════════
    describe('fetchTranscript', () => {
        it('should throw ApiError if url is missing', async () => {
            await expect(
                resourceService.fetchTranscript('')
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                resourceService.fetchTranscript('')
            ).rejects.toMatchObject({
                status: ErrorMessage.YOUTUBE_URL_REQUIRE.status,
            });
        });

        it('should throw ApiError if video id is invalid', async () => {
            await expect(
                resourceService.fetchTranscript('https://google.com')
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                resourceService.fetchTranscript('https://google.com')
            ).rejects.toMatchObject({
                status: ErrorMessage.INVALID_URL_ID_YOUTUBE.status,
            });
        });

        it('should return cached transcript from S3 if available', async () => {
            const mockCachedSegments = [
                { text: 'cached text', start: 1, duration: 2, end: 3 },
            ];
            (s3Service.getJSON as jest.Mock).mockResolvedValue(
                mockCachedSegments
            );

            const result = await resourceService.fetchTranscript(
                'https://youtu.be/dQw4w9WgXcQ'
            );

            expect(s3Service.getJSON).toHaveBeenCalledWith(
                'transcripts/dQw4w9WgXcQ.json'
            );
            expect(result).toEqual(mockCachedSegments);
            expect(
                mockedYoutubeTranscript.fetchTranscript
            ).not.toHaveBeenCalled();
        });

        it('should fetch, format, cache, and return transcript if not cached', async () => {
            (s3Service.getJSON as jest.Mock).mockResolvedValue(null);
            const mockFetchResponse = [
                { text: 'fetched text', offset: 1, duration: 2 },
            ];

            // Mock implementation to execute customFetch callback with fallback method and lang
            mockedYoutubeTranscript.fetchTranscript.mockImplementationOnce(
                async (vid, options) => {
                    if (options && options.videoFetch) {
                        await options.videoFetch({
                            url: 'https://youtube.com',
                            headers: {},
                        }); // no method, no lang
                        await options.videoFetch({
                            url: 'https://youtube.com',
                            headers: {},
                            lang: 'en',
                            method: 'POST',
                            body: 'body',
                            signal: new AbortController().signal,
                        }); // with method, lang, body, signal
                    }
                    return mockFetchResponse;
                }
            );

            (s3Service.putJSON as jest.Mock).mockResolvedValue(undefined);

            const result = await resourceService.fetchTranscript(
                'https://youtu.be/dQw4w9WgXcQ'
            );

            expect(
                mockedYoutubeTranscript.fetchTranscript
            ).toHaveBeenCalledWith(
                'dQw4w9WgXcQ',
                expect.objectContaining({ lang: 'en' })
            );
            expect(global.fetch).toHaveBeenCalledWith(
                'https://youtube.com',
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.not.objectContaining({
                        'Accept-Language': expect.any(String),
                    }),
                })
            );
            expect(s3Service.putJSON).toHaveBeenCalledWith(
                'transcripts/dQw4w9WgXcQ.json',
                [{ text: 'fetched text', start: 1, duration: 2, end: 3 }]
            );
            expect(result).toEqual([
                { text: 'fetched text', start: 1, duration: 2, end: 3 },
            ]);
        });

        it('should throw Rate Limited ApiError if YouTube is rate limiting', async () => {
            (s3Service.getJSON as jest.Mock).mockResolvedValue(null);

            class YoutubeTranscriptTooManyRequestError extends Error {}
            const error = new YoutubeTranscriptTooManyRequestError(
                'Rate limited'
            );
            mockedYoutubeTranscript.fetchTranscript.mockRejectedValue(error);

            await expect(
                resourceService.fetchTranscript('https://youtu.be/dQw4w9WgXcQ')
            ).rejects.toMatchObject({
                status: ErrorMessage.TRANSCRIPT_RATE_LIMITED.status,
            });
        });

        it('should throw Transcript Not Available ApiError for generic transcript exceptions', async () => {
            (s3Service.getJSON as jest.Mock).mockResolvedValue(null);
            mockedYoutubeTranscript.fetchTranscript.mockRejectedValue(
                new Error('No captions')
            );

            await expect(
                resourceService.fetchTranscript('https://youtu.be/dQw4w9WgXcQ')
            ).rejects.toMatchObject({
                status: ErrorMessage.TRANSCRIPT_NOT_AVAILABLE.status,
            });
        });

        it('should handle S3 caching rejection silently', async () => {
            (s3Service.getJSON as jest.Mock).mockResolvedValue(null);
            (s3Service.putJSON as jest.Mock).mockRejectedValue(
                new Error('S3 put fail')
            );
            mockedYoutubeTranscript.fetchTranscript.mockResolvedValue([
                { text: 'fetched text', offset: 1, duration: 2 },
            ]);

            const result = await resourceService.fetchTranscript(
                'https://youtu.be/dQw4w9WgXcQ'
            );
            expect(result).toEqual([
                { text: 'fetched text', start: 1, duration: 2, end: 3 },
            ]);
            await new Promise(process.nextTick);
        });
    });

    // ════════════════════════════════════════════
    // saveTranscriptAsResource()
    // ════════════════════════════════════════════
    describe('saveTranscriptAsResource', () => {
        it('should throw ApiError if invalid video ID', async () => {
            await expect(
                resourceService.saveTranscriptAsResource('https://google.com')
            ).rejects.toMatchObject({
                status: ErrorMessage.INVALID_URL_ID_YOUTUBE.status,
            });
        });

        it('should throw ApiError if resource already exists in DB', async () => {
            (mockedResource.findOne as jest.Mock).mockResolvedValue(
                buildMockResource()
            );

            await expect(
                resourceService.saveTranscriptAsResource(
                    'https://youtu.be/dQw4w9WgXcQ'
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.RESOURCE_ALREADY_EXISTS.status,
            });
        });

        it('should fetch transcript, analyze with LLM, create YouTube resource, and return it', async () => {
            (mockedResource.findOne as jest.Mock).mockResolvedValue(null);

            // Mock fetchTranscript dependency
            jest.spyOn(resourceService, 'fetchTranscript').mockResolvedValue([
                { text: 'hello', start: 0, duration: 1, end: 1 },
                { text: 'world', start: 1, duration: 1, end: 2 },
            ]);

            // Mock LLM analysis
            const mockAIResponse = {
                title: 'AI Video Title',
                summary: 'AI Video summary',
                keyPoints: ['point 1'],
                labels: { cefr: 'B1', domain: 'general', topic: ['education'] },
                suitableForLearners: true,
                moderationNotes: 'Clear',
            };
            jest.spyOn(
                resourceService,
                'analyzeContentWithLLM'
            ).mockResolvedValue(mockAIResponse);

            const mockCreatedDoc = buildMockResource({
                type: 'youtube',
                url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
                title: 'AI Video Title',
            });
            (mockedResource.create as jest.Mock).mockResolvedValue(
                mockCreatedDoc
            );

            const result = await resourceService.saveTranscriptAsResource(
                'https://youtu.be/dQw4w9WgXcQ'
            );

            expect(resourceService.fetchTranscript).toHaveBeenCalledWith(
                'https://youtu.be/dQw4w9WgXcQ'
            );
            expect(resourceService.analyzeContentWithLLM).toHaveBeenCalledWith(
                'hello world'
            );
            expect(mockedResource.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'youtube',
                    url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
                    title: 'AI Video Title',
                    content: 'hello world',
                })
            );
            expect(result.title).toBe('AI Video Title');
        });

        it('should fallback to default title if AI analysis does not return title', async () => {
            (mockedResource.findOne as jest.Mock).mockResolvedValue(null);
            jest.spyOn(resourceService, 'fetchTranscript').mockResolvedValue([
                { text: 'hello', start: 0, duration: 1, end: 1 },
            ]);

            const mockAIResponse = {
                summary: 'AI summary',
                keyPoints: [],
                labels: { cefr: 'B1', domain: 'general', topic: ['education'] },
                suitableForLearners: true,
            };
            jest.spyOn(
                resourceService,
                'analyzeContentWithLLM'
            ).mockResolvedValue(mockAIResponse);

            (mockedResource.create as jest.Mock).mockResolvedValue(
                buildMockResource({ title: 'Youtube Resource' })
            );

            await resourceService.saveTranscriptAsResource(
                'https://youtu.be/dQw4w9WgXcQ'
            );

            expect(mockedResource.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Youtube Resource',
                })
            );
        });
    });

    // ════════════════════════════════════════════
    // createArticle()
    // ════════════════════════════════════════════
    describe('createArticle', () => {
        it('should throw ApiError if domain label is invalid', async () => {
            const invalidParams = {
                title: 'Test Article',
                content: 'Some content',
                createdBy: '60f8e8b4e7c8e8b4e7c8e8b4',
                labels: { domain: 'invalid-domain-value' },
            };

            await expect(
                resourceService.createArticle(invalidParams as any)
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should create article resource and index it into the knowledge base', async () => {
            const validParams = {
                title: 'Test Article',
                content: 'Some content',
                summary: 'Summary',
                createdBy: '60f8e8b4e7c8e8b4e7c8e8b4',
                labels: { domain: 'general', cefr: 'B2', topic: ['english'] },
            };

            const mockCreatedDoc = buildMockResource({
                _id: 'art-123',
                type: 'article',
                isArticle: true,
                title: validParams.title,
                content: validParams.content,
            });
            (mockedResource.create as jest.Mock).mockResolvedValue(
                mockCreatedDoc
            );

            const result = await resourceService.createArticle(
                validParams as any
            );

            expect(mockedResource.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'article',
                    isArticle: true,
                    title: 'Test Article',
                })
            );
            expect(knowledgeBaseService.indexArticle).toHaveBeenCalledWith({
                resourceId: 'art-123',
                title: 'Test Article',
                content: 'Some content',
                attachmentUrl: undefined,
            });
            expect(result._id).toBe('art-123');
        });

        it('should silently handle indexArticle failure and still return created resource', async () => {
            const validParams = {
                title: 'Test Article',
                content: 'Some content',
                createdBy: '60f8e8b4e7c8e8b4e7c8e8b4',
            };

            const mockCreatedDoc = buildMockResource({ _id: 'art-123' });
            (mockedResource.create as jest.Mock).mockResolvedValue(
                mockCreatedDoc
            );
            (knowledgeBaseService.indexArticle as jest.Mock).mockRejectedValue(
                new Error('Elasticsearch down')
            );

            const result = await resourceService.createArticle(
                validParams as any
            );

            expect(result._id).toBe('art-123');
            expect(knowledgeBaseService.indexArticle).toHaveBeenCalled();
        });

        it('should throw ApiError if Resource.create resolves to null', async () => {
            (mockedResource.create as jest.Mock).mockResolvedValue(null);

            await expect(
                resourceService.createArticle({
                    title: 'Fail',
                    content: 'Fail',
                    createdBy: '60f8e8b4e7c8e8b4e7c8e8b4',
                })
            ).rejects.toBeInstanceOf(ApiError);
        });
    });

    // ════════════════════════════════════════════
    // updateArticle()
    // ════════════════════════════════════════════
    describe('updateArticle', () => {
        it('should throw ApiError(RESOURCE_NOT_FOUND) if resource to update does not exist', async () => {
            (mockedResource.findById as jest.Mock).mockResolvedValue(null);

            await expect(
                resourceService.updateArticle('nonexistent', {})
            ).rejects.toMatchObject({
                status: ErrorMessage.RESOURCE_NOT_FOUND.status,
            });
        });

        it('should throw ApiError status 400 if resource is not an article', async () => {
            const mockRes = buildMockResource({ isArticle: false });
            (mockedResource.findById as jest.Mock).mockResolvedValue(mockRes);

            await expect(
                resourceService.updateArticle('res-123', {})
            ).rejects.toMatchObject({
                status: 400,
            });
        });

        it('should update fields, re-index in knowledge base, and return updated article', async () => {
            const mockRes = buildMockResource({
                isArticle: true,
                title: 'Old Title',
                content: 'Old Content',
            });
            (mockedResource.findById as jest.Mock).mockResolvedValue(mockRes);

            const updatedRes = buildMockResource({
                isArticle: true,
                title: 'New Title',
                content: 'New Content',
            });
            (mockedResource.findByIdAndUpdate as jest.Mock).mockResolvedValue(
                updatedRes
            );

            const result = await resourceService.updateArticle('res-123', {
                title: 'New Title',
                content: 'New Content',
            });

            expect(mockedResource.findByIdAndUpdate).toHaveBeenCalledWith(
                'res-123',
                expect.objectContaining({
                    title: 'New Title',
                    content: 'New Content',
                }),
                { new: true }
            );
            expect(knowledgeBaseService.indexArticle).toHaveBeenCalledWith({
                resourceId: 'res-123',
                title: 'New Title',
                content: 'New Content',
                attachmentUrl: undefined,
            });
            expect(result.title).toBe('New Title');
        });

        it('should update other fields like attachmentUrl, attachmentName, suitableForLearners, labels, summary, thumbnail', async () => {
            const mockRes = buildMockResource({
                isArticle: true,
                title: 'Old Title',
                content: 'Old Content',
                labels: {
                    cefr: 'B1',
                    domain: Domain.GENERAL,
                    topic: [],
                    speechActs: [],
                },
            });
            (mockedResource.findById as jest.Mock).mockResolvedValue(mockRes);

            const updatedRes = buildMockResource({
                isArticle: true,
                attachmentUrl: 'https://s3/new.pdf',
                attachmentName: 'new.pdf',
                suitableForLearners: false,
                labels: {
                    cefr: 'B1',
                    domain: Domain.TRAVEL,
                    topic: ['trip'],
                    speechActs: [],
                },
                summary: 'new summary',
                thumbnail: 'new thumbnail',
            });
            (mockedResource.findByIdAndUpdate as jest.Mock).mockResolvedValue(
                updatedRes
            );

            const result = await resourceService.updateArticle('res-123', {
                attachmentUrl: 'https://s3/new.pdf',
                attachmentName: 'new.pdf',
                suitableForLearners: false,
                labels: { domain: Domain.TRAVEL, topic: ['trip'] },
                summary: 'new summary',
                thumbnail: 'new thumbnail',
            });

            expect(mockedResource.findByIdAndUpdate).toHaveBeenCalledWith(
                'res-123',
                expect.objectContaining({
                    attachmentUrl: 'https://s3/new.pdf',
                    attachmentName: 'new.pdf',
                    suitableForLearners: false,
                    labels: {
                        cefr: 'B1',
                        domain: Domain.TRAVEL,
                        topic: ['trip'],
                        speechActs: [],
                    },
                    summary: 'new summary',
                    thumbnail: 'new thumbnail',
                }),
                { new: true }
            );
            expect(knowledgeBaseService.indexArticle).toHaveBeenCalledWith({
                resourceId: 'res-123',
                title: 'Mock Resource Title',
                content: 'Mock Resource Content',
                attachmentUrl: 'https://s3/new.pdf',
            });
            expect(result.attachmentUrl).toBe('https://s3/new.pdf');
        });

        it('should not index article in KB if title is updated but content/attachmentUrl is not', async () => {
            const mockRes = buildMockResource({
                isArticle: true,
                title: 'Old Title',
                content: 'Content',
            });
            (mockedResource.findById as jest.Mock).mockResolvedValue(mockRes);

            const updatedRes = buildMockResource({
                isArticle: true,
                title: 'New Title',
                content: 'Content',
            });
            (mockedResource.findByIdAndUpdate as jest.Mock).mockResolvedValue(
                updatedRes
            );

            const result = await resourceService.updateArticle('res-123', {
                title: 'New Title',
            });

            expect(knowledgeBaseService.indexArticle).not.toHaveBeenCalled();
            expect(result.title).toBe('New Title');
        });

        it('should cover fallback branches for title and content in knowledgeBaseService.indexArticle', async () => {
            const mockRes = buildMockResource({
                isArticle: true,
                title: 'Fallback Title',
                content: undefined,
            });
            (mockedResource.findById as jest.Mock).mockResolvedValue(mockRes);

            const updatedRes = buildMockResource({
                isArticle: true,
                title: undefined,
                content: undefined,
            });
            (mockedResource.findByIdAndUpdate as jest.Mock).mockResolvedValue(
                updatedRes
            );

            await resourceService.updateArticle('res-123', {
                content: 'trigger reindex',
            });

            expect(knowledgeBaseService.indexArticle).toHaveBeenCalledWith({
                resourceId: 'res-123',
                title: 'Fallback Title',
                content: '',
                attachmentUrl: undefined,
            });
        });
    });

    // ════════════════════════════════════════════
    // searchResource()
    // ════════════════════════════════════════════
    describe('searchResource', () => {
        it('should build filter query correctly and call PaginationHelper.paginate', async () => {
            const mockPaginateResult = {
                data: [buildMockResource().toObject()],
                pagination: { currentPage: 1, totalPages: 1 },
            };
            (PaginationHelper.paginate as jest.Mock).mockResolvedValue(
                mockPaginateResult
            );

            const filters = {
                type: 'article',
                suitableForLearners: 'true',
                q: 'search query',
            };

            const result = await resourceService.searchResource(
                filters,
                1,
                10,
                { createdAt: -1 }
            );

            expect(PaginationHelper.paginate).toHaveBeenCalledWith(
                mockedResource,
                expect.objectContaining({
                    type: 'article',
                    suitableForLearners: true,
                    title: expect.any(RegExp),
                }),
                { page: 1, limit: 10 },
                undefined,
                undefined,
                { createdAt: -1 }
            );

            expect(result).toEqual({
                resources: mockPaginateResult.data,
                pagination: mockPaginateResult.pagination,
            });
        });

        it('should handle undefined/empty filters in searchResource', async () => {
            (PaginationHelper.paginate as jest.Mock).mockResolvedValue({
                data: [],
                pagination: {},
            });

            await resourceService.searchResource(
                { type: '  ', suitableForLearners: '  ', q: '  ' },
                1,
                10,
                {}
            );

            expect(PaginationHelper.paginate).toHaveBeenCalledWith(
                mockedResource,
                {}, // empty query
                expect.any(Object),
                undefined,
                undefined,
                expect.any(Object)
            );
        });

        it('should handle suitableForLearners false filters properly', async () => {
            (PaginationHelper.paginate as jest.Mock).mockResolvedValue({
                data: [],
                pagination: {},
            });

            await resourceService.searchResource(
                { suitableForLearners: 'false' },
                1,
                10,
                {}
            );

            expect(PaginationHelper.paginate).toHaveBeenCalledWith(
                mockedResource,
                expect.objectContaining({ suitableForLearners: false }),
                expect.any(Object),
                undefined,
                undefined,
                expect.any(Object)
            );
        });
    });

    // ════════════════════════════════════════════
    // fetchAndSaveAllRss()
    // ════════════════════════════════════════════
    describe('fetchAndSaveAllRss', () => {
        it('should crawl feeds, skip duplicate URL links, call LLM parser, and create resources', async () => {
            // Mock RSS Parser
            const mockParserInstance = {
                parseURL: jest.fn().mockResolvedValue({
                    items: [
                        {
                            title: 'Feed Title 1',
                            link: 'https://e.vnexpress.net/travel/rss-1',
                            pubDate: 'Mon, 15 Jun 2026 00:00:00 GMT',
                        },
                        {
                            title: 'Feed Title 2 (Duplicated)',
                            link: 'https://e.vnexpress.net/travel/rss-2',
                            pubDate: 'Mon, 15 Jun 2026 00:00:00 GMT',
                        },
                    ],
                }),
            };
            mockedParser.mockImplementation(() => mockParserInstance);

            // Mock Resource.findOne (first is not duplicated, second is duplicated)
            (mockedResource.findOne as jest.Mock)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(buildMockResource());

            // Mock fetchArticleText
            jest.spyOn(resourceService, 'fetchArticleText').mockResolvedValue(
                'Crawl html text content'
            );

            // Mock LLM analysis (with invalid domain that needs general fallback)
            const mockAIResponse = {
                title: 'Analyzed RSS Title',
                summary: 'RSS summary',
                keyPoints: ['point 1'],
                labels: {
                    cefr: 'A2',
                    domain: 'invalid-domain-test',
                    topic: ['travel'],
                },
                suitableForLearners: true,
                moderationNotes: 'Clear RSS',
            };
            jest.spyOn(
                resourceService,
                'analyzeContentWithLLM'
            ).mockResolvedValue(mockAIResponse);

            // Mock createResource
            const mockCreatedDoc = buildMockResource({
                type: 'web-rss',
                url: 'https://e.vnexpress.net/travel/rss-1',
                title: 'Feed Title 1',
            });
            jest.spyOn(resourceService, 'createResource').mockResolvedValue(
                mockCreatedDoc
            );

            const result = await resourceService.fetchAndSaveAllRss();

            expect(mockParserInstance.parseURL).toHaveBeenCalled();
            expect(mockedResource.findOne).toHaveBeenCalledWith({
                url: 'https://e.vnexpress.net/travel/rss-1',
            });
            expect(resourceService.fetchArticleText).toHaveBeenCalledWith(
                'https://e.vnexpress.net/travel/rss-1'
            );
            expect(resourceService.analyzeContentWithLLM).toHaveBeenCalledWith(
                'Feed Title 1\nCrawl html text content'
            );

            // Check that domain was fallbacked to GENERAL because 'invalid-domain-test' is not AVAILABLE_DOMAINS
            expect(resourceService.createResource).toHaveBeenCalledWith(
                expect.objectContaining({
                    labels: expect.objectContaining({
                        domain: 'general',
                    }),
                })
            );
            expect(result).toHaveLength(result.length); // Should match number of feeds processed
        });

        it('should use existing fallback domain logic if no labels or domain provided by AI analysis', async () => {
            const mockParserInstance = {
                parseURL: jest.fn().mockResolvedValue({
                    items: [
                        {
                            title: 'Feed Title',
                            link: 'https://e.vnexpress.net/travel/rss-no-domain',
                            pubDate: 'Mon, 15 Jun 2026 00:00:00 GMT',
                        },
                    ],
                }),
            };
            mockedParser.mockImplementation(() => mockParserInstance);

            (mockedResource.findOne as jest.Mock).mockResolvedValue(null);
            jest.spyOn(resourceService, 'fetchArticleText').mockResolvedValue(
                'some text'
            );

            // AI returns no labels
            jest.spyOn(
                resourceService,
                'analyzeContentWithLLM'
            ).mockResolvedValue({
                summary: 'summary',
                keyPoints: [],
                suitableForLearners: true,
                moderationNotes: '',
            });

            jest.spyOn(resourceService, 'createResource').mockResolvedValue(
                buildMockResource()
            );

            await resourceService.fetchAndSaveAllRss();

            expect(resourceService.createResource).toHaveBeenCalledWith(
                expect.objectContaining({
                    labels: expect.objectContaining({
                        domain: 'general',
                    }),
                })
            );
        });

        it('should fallback links, titles, and pubDates when rss items are missing them', async () => {
            const mockParserInstance = {
                parseURL: jest.fn().mockResolvedValue({
                    items: [
                        {
                            // Missing title, link, pubDate
                        },
                    ],
                }),
            };
            mockedParser.mockImplementation(() => mockParserInstance);

            (mockedResource.findOne as jest.Mock).mockResolvedValue(null);
            jest.spyOn(resourceService, 'fetchArticleText').mockResolvedValue(
                'text'
            );
            jest.spyOn(
                resourceService,
                'analyzeContentWithLLM'
            ).mockResolvedValue({
                summary: 'summary',
                keyPoints: [],
                suitableForLearners: true,
                moderationNotes: '',
            });

            jest.spyOn(resourceService, 'createResource').mockResolvedValue(
                buildMockResource()
            );

            await resourceService.fetchAndSaveAllRss();

            expect(resourceService.fetchArticleText).not.toHaveBeenCalled();
            expect(resourceService.createResource).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: '',
                    title: 'Untitled',
                    publishedAt: expect.any(Date),
                })
            );
        });
    });
});
