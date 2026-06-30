/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.CHROMA_API_KEY = 'test';
process.env.CHROMA_TENANT = 'test';
process.env.CHROMA_DATABASE = 'test';
import { knowledgeBaseService } from '~/services/knowledgeBase/knowledgeBaseService.js';
import { Resource } from '~/models/resource.js';

// Setup prototype mocks and mock implementations
const queryKnowledgeSpy = jest
    .spyOn(knowledgeBaseService, 'queryKnowledge')
    .mockImplementation();
const resourceFindByIdSpy = jest
    .spyOn(Resource, 'findById')
    .mockImplementation();

import { knowledgeBaseTools } from '~/ai/tools/knowledgeBaseTools.js';

describe('knowledgeBaseTools', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    const [searchKnowledgeBaseTool, getKnowledgeArticleTool] =
        knowledgeBaseTools as any[];

    beforeEach(() => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
    });

    describe('searchKnowledgeBaseTool', () => {
        it('should return empty results message if no results found', async () => {
            queryKnowledgeSpy.mockResolvedValue([]);

            const result = await searchKnowledgeBaseTool.invoke(
                { query: 'test' },
                { configurable: { userId: 'user-1' } }
            );

            expect(queryKnowledgeSpy).toHaveBeenCalledWith({
                query: 'test',
                topK: 5,
            });
            expect(result).toBe(
                JSON.stringify({
                    found: false,
                    context: '',
                    citations: [],
                    message: 'No relevant information found in knowledge base',
                })
            );
        });

        it('should search knowledge base and return results with citations', async () => {
            queryKnowledgeSpy.mockResolvedValue([
                {
                    resourceId: 'res-1',
                    title: 't1',
                    content: 'content 1',
                    score: 0.9,
                },
                {
                    resourceId: 'res-2',
                    title: 't2',
                    content: 'A'.repeat(250),
                    score: 0.8,
                },
            ] as any);

            const result = await searchKnowledgeBaseTool.invoke(
                { query: 'test', topK: 3 },
                { configurable: { userId: 'user-1' } }
            );

            expect(queryKnowledgeSpy).toHaveBeenCalledWith({
                query: 'test',
                topK: 3,
            });

            const parsed = JSON.parse(result);
            expect(parsed.found).toBe(true);
            expect(parsed.message).toBe('Found 2 relevant knowledge chunks');
            expect(parsed.citations).toHaveLength(2);
            expect(parsed.citations[0]).toMatchObject({
                id: 1,
                resourceId: 'res-1',
                title: 't1',
                score: 0.9,
            });
            expect(parsed.citations[1].excerpt.endsWith('...')).toBe(true);
            expect(parsed.context).toContain('[1] content 1');
            expect(parsed.context).toContain('[2] ' + 'A'.repeat(250));
        });

        it('should handle search error and return error message', async () => {
            queryKnowledgeSpy.mockRejectedValue(new Error('Search failed'));

            const result = await searchKnowledgeBaseTool.invoke(
                { query: 'test' },
                { configurable: { userId: 'user-1' } }
            );

            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(result).toBe(
                JSON.stringify({
                    found: false,
                    context: '',
                    citations: [],
                    message: 'Error searching knowledge base',
                })
            );
        });
    });

    describe('getKnowledgeArticleTool', () => {
        it('should return not found if resource is missing', async () => {
            resourceFindByIdSpy.mockReturnValue({
                lean: jest.fn().mockResolvedValue(null),
            } as any);

            const result = await getKnowledgeArticleTool.invoke(
                { resourceId: 'res-1' },
                { configurable: { userId: 'user-1' } }
            );

            expect(resourceFindByIdSpy).toHaveBeenCalledWith('res-1');
            expect(result).toBe(
                JSON.stringify({
                    found: false,
                    message: 'Article not found',
                })
            );
        });

        it('should get article and convert content to plain text', async () => {
            resourceFindByIdSpy.mockReturnValue({
                lean: jest.fn().mockResolvedValue({
                    _id: 'res-1',
                    title: 'Title',
                    content: '<p>Hello <b>World</b></p>',
                    summary: 'Sum',
                    labels: { domain: 'IT', cefr: 'B1', topic: ['Tech'] },
                    attachmentUrl: 'http://link',
                }),
            } as any);

            const result = await getKnowledgeArticleTool.invoke(
                { resourceId: 'res-1' },
                { configurable: { userId: 'user-1' } }
            );

            const parsed = JSON.parse(result);
            expect(parsed.found).toBe(true);
            expect(parsed.article.id).toBe('res-1');
            expect(parsed.article.title).toBe('Title');
            expect(parsed.article.content).toBe('Hello World');
            expect(parsed.article.hasAttachment).toBe(true);
            expect(parsed.article.domain).toBe('IT');
            expect(parsed.article.cefr).toBe('B1');
            expect(parsed.article.topics).toEqual(['Tech']);
        });

        it('should handle article with no labels, content, or attachment', async () => {
            resourceFindByIdSpy.mockReturnValue({
                lean: jest.fn().mockResolvedValue({
                    _id: 'res-1',
                    title: 'Title',
                    summary: 'Sum',
                }),
            } as any);

            const result = await getKnowledgeArticleTool.invoke(
                { resourceId: 'res-1' },
                { configurable: { userId: 'user-1' } }
            );

            const parsed = JSON.parse(result);
            expect(parsed.found).toBe(true);
            expect(parsed.article.content).toBeUndefined();
            expect(parsed.article.hasAttachment).toBe(false);
            expect(parsed.article.topics).toEqual([]);
        });

        it('should handle error and return error message', async () => {
            resourceFindByIdSpy.mockImplementation(() => {
                throw new Error('DB Error');
            });

            const result = await getKnowledgeArticleTool.invoke(
                { resourceId: 'res-1' },
                { configurable: { userId: 'user-1' } }
            );

            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(result).toBe(
                JSON.stringify({
                    found: false,
                    message: 'Error retrieving article',
                })
            );
        });
    });
});
