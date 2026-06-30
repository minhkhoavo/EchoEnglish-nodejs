/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { learningPlanAIService } from '~/ai/service/learningPlanAIService.js';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';

jest.mock('~/ai/provider/googleGenAIClient.js');
jest.mock('@langchain/core/output_parsers');

describe('LearningPlanAIService', () => {
    let mockInvoke: jest.Mock;
    let consoleErrorSpy: jest.SpyInstance;
    let loadTemplateSpy: jest.SpyInstance;
    let dateSpy: jest.SpyInstance;

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
            (learningPlanAIService as any).llmClient,
            'getModel'
        ).mockReturnValue(mockModel);

        loadTemplateSpy = jest
            .spyOn(promptManagerService, 'loadTemplate')
            .mockResolvedValue('mocked roadmap prompt');

        // Mock Date to ensure deterministic getDay()
        const mockDate = new Date('2023-10-10T00:00:00Z'); // Tuesday -> getDay() returns 2
        dateSpy = jest
            .spyOn(global, 'Date')
            .mockImplementation(() => mockDate as any);
        // Important: preserve Date.now and other statics if they are used elsewhere, though for our service `new Date().getDay()` is what we care about.
    });

    afterEach(() => {
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
        if (loadTemplateSpy) loadTemplateSpy.mockRestore();
        if (dateSpy) dateSpy.mockRestore();
    });

    const baseInput = {
        userId: 'user1',
        userPrompt: 'Help me get 800',
        targetScore: 800,
        studyTimePerDay: 60,
        studyDaysPerWeek: 5,
    };

    const expectedOutput = {
        currentLevel: 'intermediate',
        learningStrategy: { foundationFocus: 50, domainFocus: 50 },
        totalWeeks: 4,
        weeklyFocuses: [],
    };

    describe('generateLearningRoadmap', () => {
        it('should successfully generate roadmap with full context', async () => {
            mockInvoke.mockResolvedValueOnce(expectedOutput);

            const fullInput = {
                ...baseInput,
                userPreferences: {
                    primaryGoal: 'toeic_preparation',
                    currentLevel: 'advanced',
                    preferredStudyTime: 'morning',
                    contentInterests: ['business'],
                    studyDaysOfWeek: [1, 2, 3, 4, 5],
                },
                testAnalysis: {
                    score: 600,
                    weaknesses: [{ skillName: 'Grammar', severity: 'HIGH' }],
                    strengths: ['Vocab'],
                    summary: 'Needs work',
                    domainsPerformance: [{ domain: 'work', score: 50 }],
                },
                providedWeaknesses: [
                    { skillName: 'Listening', severity: 'MEDIUM' },
                ],
                todayDayOfWeek: 1,
            };

            const result =
                await learningPlanAIService.generateLearningRoadmap(fullInput);

            expect(result).toEqual(expectedOutput);
            expect(loadTemplateSpy).toHaveBeenCalledTimes(1);
            expect(mockInvoke).toHaveBeenCalledWith('mocked roadmap prompt');

            const loadTemplateCallArgs = loadTemplateSpy.mock.calls[0];
            expect(loadTemplateCallArgs[0]).toBe(
                'studyplan/roadmap_generation'
            );

            // Check normalization
            expect(loadTemplateCallArgs[1].testAnalysisBlock).toContain(
                '"severity":"high"'
            );
            expect(loadTemplateCallArgs[1].providedWeaknessesBlock).toContain(
                '"severity":"medium"'
            );
            expect(loadTemplateCallArgs[1].todayDayOfWeek).toBe('1');
        });

        it('should successfully generate roadmap with minimal context (undefined optional fields)', async () => {
            mockInvoke.mockResolvedValueOnce(expectedOutput);

            const result =
                await learningPlanAIService.generateLearningRoadmap(baseInput);

            expect(result).toEqual(expectedOutput);
            expect(loadTemplateSpy).toHaveBeenCalledTimes(1);

            const loadTemplateCallArgs = loadTemplateSpy.mock.calls[0];
            // default fallbacks
            expect(loadTemplateCallArgs[1].primaryGoal).toBe(
                'toeic_preparation'
            );
            expect(loadTemplateCallArgs[1].currentLevel).toBe('intermediate');
            expect(loadTemplateCallArgs[1].preferredStudyTime).toBe('N/A');
            expect(loadTemplateCallArgs[1].contentInterests).toBe('N/A');
            expect(loadTemplateCallArgs[1].studyDaysOfWeek).toBe(
                '1, 2, 3, 4, 5'
            );
            expect(loadTemplateCallArgs[1].testAnalysisBlock).toBe('');
            expect(loadTemplateCallArgs[1].providedWeaknessesBlock).toBe('');

            // Default Date fallback (Tuesday -> 2)
            expect(loadTemplateCallArgs[1].todayDayOfWeek).toBe('2');
        });

        it('should handle testAnalysis with empty weaknesses', async () => {
            mockInvoke.mockResolvedValueOnce(expectedOutput);

            const input = {
                ...baseInput,
                testAnalysis: {
                    score: 600,
                    weaknesses: [],
                    strengths: [],
                    summary: 'OK',
                },
            };

            await learningPlanAIService.generateLearningRoadmap(input);
            const loadTemplateCallArgs = loadTemplateSpy.mock.calls[0];
            expect(loadTemplateCallArgs[1].testAnalysisBlock).toContain('[]');
        });

        it('should handle providedWeaknesses with missing severity', async () => {
            mockInvoke.mockResolvedValueOnce(expectedOutput);

            const input = {
                ...baseInput,
                providedWeaknesses: [{ skillName: 'Reading' }], // no severity
            };

            await learningPlanAIService.generateLearningRoadmap(input);
            const loadTemplateCallArgs = loadTemplateSpy.mock.calls[0];
            // Just shouldn't crash
            expect(loadTemplateCallArgs[1].providedWeaknessesBlock).toContain(
                '"skillName":"Reading"'
            );
        });

        it('should handle testAnalysis with weaknesses having missing severity', async () => {
            mockInvoke.mockResolvedValueOnce(expectedOutput);

            const input = {
                ...baseInput,
                testAnalysis: {
                    score: 600,
                    weaknesses: [{ skillName: 'Reading' }], // no severity
                    strengths: [],
                    summary: 'OK',
                },
            };

            await learningPlanAIService.generateLearningRoadmap(input);
            const loadTemplateCallArgs = loadTemplateSpy.mock.calls[0];
            expect(loadTemplateCallArgs[1].testAnalysisBlock).toContain(
                '"skillName":"Reading"'
            );
        });

        it('should handle userPreferences with empty lists', async () => {
            mockInvoke.mockResolvedValueOnce(expectedOutput);

            const input = {
                ...baseInput,
                userPreferences: {
                    contentInterests: [],
                    studyDaysOfWeek: [],
                },
            };

            await learningPlanAIService.generateLearningRoadmap(input);
            const loadTemplateCallArgs = loadTemplateSpy.mock.calls[0];
            expect(loadTemplateCallArgs[1].contentInterests).toBe('N/A'); // empty string is falsy so it falls back to N/A
            expect(loadTemplateCallArgs[1].studyDaysOfWeek).toBe(
                '1, 2, 3, 4, 5'
            );
        });

        it('should throw an error and log if LLM invocation fails', async () => {
            mockInvoke.mockRejectedValueOnce(new Error('LLM crash'));

            await expect(
                learningPlanAIService.generateLearningRoadmap(baseInput)
            ).rejects.toThrow('Failed to generate learning roadmap');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error generating roadmap:',
                expect.any(Error)
            );
        });
    });
});
