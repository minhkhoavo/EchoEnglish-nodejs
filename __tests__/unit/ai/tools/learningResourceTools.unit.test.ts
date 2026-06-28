/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.CHROMA_API_KEY = 'test';
process.env.CHROMA_TENANT = 'test';
process.env.CHROMA_DATABASE = 'test';
import { Resource } from '~/models/resource.js';
import testService from '~/services/testService.js';

const resourceFindSpy = jest.spyOn(Resource, 'find').mockImplementation();
const findRandomQuestionIdsSpy = jest
    .spyOn(testService, 'findRandomQuestionIds')
    .mockImplementation();

import { learningResourceTools } from '~/ai/tools/learningResourceTools.js';

describe('learningResourceTools', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    const [
        findLearningResourcesTool,
        findPracticeQuestionsTool,
        getResourceDetailsTool,
    ] = learningResourceTools as any[];

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

    describe('findLearningResourcesTool', () => {
        it('should find resources with domains', async () => {
            const mockChain = {
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue([
                    {
                        _id: 'res-1',
                        type: 'article',
                        title: 'Title',
                        summary: 'Sum',
                        url: 'http://orig',
                        labels: { domain: 'IT', topic: ['Tech'] },
                    },
                ]),
            };
            resourceFindSpy.mockReturnValue(mockChain as any);

            const result = await findLearningResourcesTool.invoke({
                domains: ['IT'],
                limit: 1,
            });

            expect(resourceFindSpy).toHaveBeenCalledWith({
                suitableForLearners: true,
                $or: [
                    { 'labels.domain': { $in: ['it'] } },
                    { 'labels.topic': { $in: ['it'] } },
                ],
            });
            expect(mockChain.limit).toHaveBeenCalledWith(1);

            const parsed = JSON.parse(result);
            expect(parsed.total).toBe(1);
            expect(parsed.resources[0].id).toBe('res-1');
            expect(parsed.message).toContain(
                'Found 1 suitable learning resources'
            );
        });

        it('should find resources without domains', async () => {
            const mockChain = {
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue([]),
            };
            resourceFindSpy.mockReturnValue(mockChain as any);

            const result = await findLearningResourcesTool.invoke({
                domains: [],
            });

            expect(resourceFindSpy).toHaveBeenCalledWith({
                suitableForLearners: true,
            });
            expect(mockChain.limit).toHaveBeenCalledWith(5);

            const parsed = JSON.parse(result);
            expect(parsed.total).toBe(0);
            expect(parsed.message).toBe(
                'No resources found matching the criteria'
            );
        });

        it('should handle missing summary by using content substring', async () => {
            const mockChain = {
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue([
                    {
                        _id: 'res-1',
                        content: 'A'.repeat(300),
                    },
                ]),
            };
            resourceFindSpy.mockReturnValue(mockChain as any);

            const result = await findLearningResourcesTool.invoke({
                domains: [],
            });
            const parsed = JSON.parse(result);
            expect(parsed.resources[0].description.length).toBe(200);
        });

        it('should use default limit=5 when limit is undefined via _call', async () => {
            // Covers L107: limit || 5 — Zod .default(5) prevents undefined reaching func via invoke()
            const mockChain = {
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue([]),
            };
            resourceFindSpy.mockReturnValue(mockChain as any);
            const mockRunManager = {
                getChild: jest.fn().mockReturnValue(undefined),
            };
            await (findLearningResourcesTool as any)._call(
                { domains: [], limit: undefined },
                mockRunManager,
                {}
            );
            expect(mockChain.limit).toHaveBeenCalledWith(5);
        });
    });

    describe('findPracticeQuestionsTool', () => {
        it('should return error message if both skills and domains are empty', async () => {
            const result = await findPracticeQuestionsTool.invoke({});
            const parsed = JSON.parse(result);
            expect(parsed.total).toBe(0);
            expect(parsed.message).toBe(
                'Please provide at least one skill or domain to search for questions'
            );

            const result2 = await findPracticeQuestionsTool.invoke({
                skills: [],
                domains: [],
            });
            const parsed2 = JSON.parse(result2);
            expect(parsed2.total).toBe(0);
        });

        it('should find practice questions by skills and domains', async () => {
            findRandomQuestionIdsSpy.mockResolvedValue(['q1', 'q2'] as any);

            const result = await findPracticeQuestionsTool.invoke({
                skills: ['s1'],
                domains: ['d1'],
                limit: 5,
            });

            expect(findRandomQuestionIdsSpy).toHaveBeenCalledWith(
                { skills: ['s1'], domains: ['d1'] },
                5
            );

            const parsed = JSON.parse(result);
            expect(parsed.total).toBe(2);
            expect(parsed.questionIds).toEqual(['q1', 'q2']);
            expect(parsed.practiceUrl).toBe(
                '/practice-drill?questionIds=q1,q2'
            );
        });

        it('should find practice questions by skills only', async () => {
            findRandomQuestionIdsSpy.mockResolvedValue(['q1'] as any);
            const result = await findPracticeQuestionsTool.invoke({
                skills: ['s1'],
            });
            expect(findRandomQuestionIdsSpy).toHaveBeenCalledWith(
                { skills: ['s1'] },
                10
            );
            expect(JSON.parse(result).total).toBe(1);
        });

        it('should find practice questions by domains only', async () => {
            findRandomQuestionIdsSpy.mockResolvedValue(['q1'] as any);
            const result = await findPracticeQuestionsTool.invoke({
                domains: ['d1'],
            });
            expect(findRandomQuestionIdsSpy).toHaveBeenCalledWith(
                { domains: ['d1'] },
                10
            );
            expect(JSON.parse(result).total).toBe(1);
        });

        it('should use default limit=10 when limit is undefined via _call', async () => {
            // Covers L190: limit || 10 — unreachable via invoke() without explicit limit
            findRandomQuestionIdsSpy.mockResolvedValue(['q1'] as any);
            const mockRunManager = {
                getChild: jest.fn().mockReturnValue(undefined),
            };
            await (findPracticeQuestionsTool as any)._call(
                { skills: ['s1'], limit: undefined },
                mockRunManager,
                {}
            );
            expect(findRandomQuestionIdsSpy).toHaveBeenCalledWith(
                { skills: ['s1'] },
                10
            );
        });

        it('should return empty if no questions found', async () => {
            findRandomQuestionIdsSpy.mockResolvedValue([] as any);

            const result = await findPracticeQuestionsTool.invoke({
                skills: ['s1'],
            });

            expect(findRandomQuestionIdsSpy).toHaveBeenCalledWith(
                { skills: ['s1'] },
                10
            );

            const parsed = JSON.parse(result);
            expect(parsed.total).toBe(0);
            expect(parsed.message).toBe(
                'No questions found matching the criteria'
            );
        });

        it('should handle error', async () => {
            findRandomQuestionIdsSpy.mockRejectedValue(new Error('Failed'));

            const result = await findPracticeQuestionsTool.invoke({
                skills: ['s1'],
            });

            expect(consoleErrorSpy).toHaveBeenCalled();
            const parsed = JSON.parse(result);
            expect(parsed.total).toBe(0);
            expect(parsed.error).toBe('Failed');
        });

        it('should handle non-Error instance in catch block', async () => {
            findRandomQuestionIdsSpy.mockRejectedValue('String Error');
            const result = await findPracticeQuestionsTool.invoke({
                skills: ['s1'],
            });
            const parsed = JSON.parse(result);
            expect(parsed.error).toBe('Unknown error');
        });
    });

    describe('getResourceDetailsTool', () => {
        it('should throw schema error if resourceIds not provided, and handle empty array', async () => {
            await expect(
                getResourceDetailsTool.invoke({} as any)
            ).rejects.toThrow(/schema/);

            const result2 = await getResourceDetailsTool.invoke({
                resourceIds: [],
            });
            expect(JSON.parse(result2).message).toBe(
                'No resource IDs provided'
            );
        });

        it('should get resource details', async () => {
            const mockChain = {
                lean: jest.fn().mockResolvedValue([
                    {
                        _id: 'res-1',
                        title: 'Title',
                        content: 'content',
                    },
                ]),
            };
            resourceFindSpy.mockReturnValue(mockChain as any);

            const result = await getResourceDetailsTool.invoke({
                resourceIds: ['res-1'],
            });

            expect(resourceFindSpy).toHaveBeenCalledWith({
                _id: { $in: ['res-1'] },
            });

            const parsed = JSON.parse(result);
            expect(parsed.total).toBe(1);
            expect(parsed.resources[0].id).toBe('res-1');
            expect(parsed.resources[0].title).toBe('Title');
        });

        it('should handle error', async () => {
            resourceFindSpy.mockImplementation(() => {
                throw new Error('DB error');
            });

            const result = await getResourceDetailsTool.invoke({
                resourceIds: ['res-1'],
            });

            expect(consoleErrorSpy).toHaveBeenCalled();
            const parsed = JSON.parse(result);
            expect(parsed.error).toBe('DB error');
        });

        it('should handle non-Error instance in catch block', async () => {
            resourceFindSpy.mockImplementation(() => {
                throw 'String Error';
            });

            const result = await getResourceDetailsTool.invoke({
                resourceIds: ['res-1'],
            });
            const parsed = JSON.parse(result);
            expect(parsed.error).toBe('Unknown error');
        });
    });
});
