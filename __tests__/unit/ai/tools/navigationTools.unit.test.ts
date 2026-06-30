/* eslint-disable @typescript-eslint/no-explicit-any */
import testService from '~/services/testService.js';

const findRandomQuestionIdsSpy = jest
    .spyOn(testService, 'findRandomQuestionIds')
    .mockImplementation();

import { navigationTools } from '~/ai/tools/navigationTools.js';

describe('navigationTools', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    const [navigateUserTool, startPracticeDrillTool] = navigationTools as any[];

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

    describe('navigateUserTool', () => {
        it('should throw schema error for unknown destination', async () => {
            await expect(
                navigateUserTool.invoke({ destination: 'invalid_dest' })
            ).rejects.toThrow(/schema/);
        });

        it('should return unknown destination message by bypassing schema', async () => {
            const func = (navigateUserTool as any).func;
            if (func) {
                const result = await func({ destination: 'invalid_dest' });
                const parsed = JSON.parse(result);
                expect(parsed.success).toBe(false);
                expect(parsed.message).toContain(
                    'Unknown destination: invalid_dest'
                );
            }
        });

        it('should return navigation route for valid destination', async () => {
            const result = await navigateUserTool.invoke({
                destination: 'dashboard',
                params: { tab: '1' },
            });
            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(true);
            expect(parsed.route).toBe('/dashboard');
            expect(parsed.args).toEqual({ tab: '1' });
            expect(parsed.title).toBe('Dashboard');
        });

        it('should handle missing params', async () => {
            const result = await navigateUserTool.invoke({
                destination: 'tests',
            });
            const parsed = JSON.parse(result);
            expect(parsed.args).toEqual({});
        });
    });

    describe('startPracticeDrillTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(startPracticeDrillTool.invoke({}, {})).rejects.toThrow(
                'userId required'
            );
        });

        it('should start practice drill with specific skills', async () => {
            findRandomQuestionIdsSpy.mockResolvedValue(['q1', 'q2'] as any);
            const result = await startPracticeDrillTool.invoke(
                {
                    skills: ['mainTopic', 'wordForm'],
                    domains: ['business'],
                    questionCount: 5,
                },
                { configurable: { userId: 'user-1' } }
            );

            expect(findRandomQuestionIdsSpy).toHaveBeenCalledWith(
                { skills: ['mainTopic', 'wordForm'], domains: ['business'] },
                5
            );
            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(true);
            expect(parsed.practiceType).toBe('Mixed Practice');
        });

        it('should start practice drill with only reading skills', async () => {
            findRandomQuestionIdsSpy.mockResolvedValue(['q1'] as any);
            const result = await startPracticeDrillTool.invoke(
                { skills: ['wordForm'] },
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.practiceType).toBe('Reading Practice');
        });

        it('should start practice drill with only listening skills', async () => {
            findRandomQuestionIdsSpy.mockResolvedValue(['q1'] as any);
            const result = await startPracticeDrillTool.invoke(
                { skills: ['mainTopic'] },
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.practiceType).toBe('Listening Practice');
        });

        it('should handle no questions found', async () => {
            findRandomQuestionIdsSpy.mockResolvedValue([]);

            const result = await startPracticeDrillTool.invoke(
                { skills: ['mainTopic'] },
                { configurable: { userId: 'user-1' } }
            );

            expect(findRandomQuestionIdsSpy).toHaveBeenCalledWith(
                { skills: ['mainTopic'] },
                10
            );

            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(false);
            expect(parsed.message).toContain('No questions found');
            expect(parsed.suggestedSkills).toBeDefined();
        });

        it('should create practice drill with default skills if none provided', async () => {
            findRandomQuestionIdsSpy.mockResolvedValue(['q1']);

            const result = await startPracticeDrillTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );

            expect(findRandomQuestionIdsSpy).toHaveBeenCalledWith(
                { skills: ['wordForm', 'verbTenseMood', 'mainTopic'] },
                10
            );

            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(true);
            expect(parsed.practiceUrl).toBe('/practice-drill?questionIds=q1');
            expect(parsed.practiceType).toBe('Mixed Practice');
        });

        it('should detect Listening Practice type', async () => {
            findRandomQuestionIdsSpy.mockResolvedValue(['q1', 'q2']);

            const result = await startPracticeDrillTool.invoke(
                { skills: ['identifyActionInProgress'] },
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.practiceType).toBe('Listening Practice');
        });

        it('should detect Reading Practice type', async () => {
            findRandomQuestionIdsSpy.mockResolvedValue(['q1', 'q2']);

            const result = await startPracticeDrillTool.invoke(
                { skills: ['wordForm'] },
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.practiceType).toBe('Reading Practice');
        });

        it('should use domains filter', async () => {
            findRandomQuestionIdsSpy.mockResolvedValue(['q1', 'q2']);

            await startPracticeDrillTool.invoke(
                { domains: ['business'] },
                { configurable: { userId: 'user-1' } }
            );

            expect(findRandomQuestionIdsSpy).toHaveBeenCalledWith(
                { domains: ['business'] },
                10
            );
        });

        it('should handle error', async () => {
            findRandomQuestionIdsSpy.mockRejectedValue(new Error('DB error'));

            const result = await startPracticeDrillTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );

            expect(consoleErrorSpy).toHaveBeenCalled();
            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(false);
            expect(parsed.error).toBe('DB error');
        });

        it('should handle non-Error instance in catch block', async () => {
            findRandomQuestionIdsSpy.mockRejectedValue('String Error');

            const result = await startPracticeDrillTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.error).toBe('Unknown error');
        });
    });
});
