/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { memoAnalysisAIService } from '~/ai/service/memoAnalysisAIService.js';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';

jest.mock('~/ai/provider/googleGenAIClient.js');
jest.mock('@langchain/core/output_parsers');

describe('MemoAnalysisAIService', () => {
    let mockInvoke: jest.Mock;
    let consoleErrorSpy: jest.SpyInstance;
    let loadTemplateSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        mockInvoke = jest.fn();
        const mockModel = {
            pipe: jest.fn().mockReturnValue({
                invoke: mockInvoke,
            }),
        };

        jest.spyOn(
            (memoAnalysisAIService as any).llmClient,
            'getModel'
        ).mockReturnValue(mockModel);

        loadTemplateSpy = jest
            .spyOn(promptManagerService, 'loadTemplate')
            .mockResolvedValue('mocked prompt');
    });

    afterEach(() => {
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
        if (loadTemplateSpy) loadTemplateSpy.mockRestore();
    });

    const baseContext = {
        note: 'I want to focus on this material',
        studyTimePerDay: 45,
        targetScope: 'week',
        preferredDays: 3,
        maxDays: 7,
        materials: [
            {
                title: 'Mat 1',
                type: 'video',
                cefr: 'B1',
                domains: ['daily life'],
                summary: 'sum1',
            },
        ],
        learnerProfile: {
            currentLevel: 'B1',
            weakSkills: [{ skill: 'grammar', accuracy: 40 }],
            weakDomains: [{ domain: 'work', accuracy: 50 }],
            abilityNotes: ['Struggles with past tense'],
        },
    };

    const expectedOutput = {
        isSuitable: true,
        suitabilityReason: 'Good fit',
        cefrFit: 'B1',
        warnings: [],
        suggestedTotalDays: 3,
        dayPlan: [{ order: 1, focus: 'part 1' }],
        supplementedWeaknesses: [],
    };

    describe('analyzeMemo', () => {
        it('should successfully analyze memo with full context', async () => {
            mockInvoke.mockResolvedValueOnce(expectedOutput);

            const result = await memoAnalysisAIService.analyzeMemo(baseContext);

            expect(result).toEqual(expectedOutput);
            expect(loadTemplateSpy).toHaveBeenCalledTimes(1);
            expect(mockInvoke).toHaveBeenCalledWith('mocked prompt');

            const callArgs = loadTemplateSpy.mock.calls[0];
            expect(callArgs[0]).toBe('studyplan/memo_suitability_analysis');
            expect(callArgs[1].userNote).toBe(
                'I want to focus on this material'
            );
            expect(callArgs[1].learnerProfileBlock).toContain(
                'Struggles with past tense'
            );
            expect(callArgs[1].materialsBlock).toContain('Mat 1');
        });

        it('should handle minimal context (undefined/empty optionals)', async () => {
            mockInvoke.mockResolvedValueOnce(expectedOutput);

            const minimalContext = {
                note: '',
                studyTimePerDay: 30,
                targetScope: 'date',
                preferredDays: 1,
                maxDays: 1,
                materials: [
                    { title: 'Mat 2', type: 'doc' }, // no cefr, domains, summary
                ],
                learnerProfile: {
                    currentLevel: 'A2', // no weakSkills, weakDomains, abilityNotes
                },
            };

            const result =
                await memoAnalysisAIService.analyzeMemo(minimalContext);

            expect(result).toEqual(expectedOutput);

            const callArgs = loadTemplateSpy.mock.calls[0][1];
            expect(callArgs.userNote).toBe('No specific note provided.');
            expect(callArgs.learnerProfileBlock).toContain('Weak Skills: N/A');
            expect(callArgs.learnerProfileBlock).toContain('Weak Domains: N/A');
            expect(callArgs.learnerProfileBlock).toContain(
                'Ability Notes (AI insights about this learner): N/A'
            );
            expect(callArgs.materialsBlock).toContain('CEFR/Difficulty: N/A');
            expect(callArgs.materialsBlock).toContain('Domain(s): N/A');
            expect(callArgs.materialsBlock).toContain('Summary: N/A');
        });

        it('should handle empty arrays in optional arrays', async () => {
            mockInvoke.mockResolvedValueOnce(expectedOutput);

            const context = {
                ...baseContext,
                materials: [],
                learnerProfile: {
                    ...baseContext.learnerProfile,
                    weakSkills: [],
                    weakDomains: [],
                    abilityNotes: [],
                },
            };

            await memoAnalysisAIService.analyzeMemo(context);

            const callArgs = loadTemplateSpy.mock.calls[0][1];
            expect(callArgs.materialsBlock).toBe('None');
            expect(callArgs.learnerProfileBlock).toContain('Weak Skills: N/A');
            expect(callArgs.learnerProfileBlock).toContain('Weak Domains: N/A');
            expect(callArgs.learnerProfileBlock).toContain(
                'Ability Notes (AI insights about this learner): N/A'
            );
        });

        it('should throw an error and log if LLM invocation fails', async () => {
            mockInvoke.mockRejectedValueOnce(new Error('LLM crash'));

            await expect(
                memoAnalysisAIService.analyzeMemo(baseContext)
            ).rejects.toThrow('Failed to analyze study memo');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error analyzing study memo:',
                expect.any(Error)
            );
        });
    });
});
