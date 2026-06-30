/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { dailyPlanAIService } from '~/ai/service/dailyPlanAIService.js';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';

jest.mock('~/ai/provider/googleGenAIClient.js');
jest.mock('@langchain/core/output_parsers');

describe('DailyPlanAIService', () => {
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

        // Spy on the singleton's llmClient
        jest.spyOn(
            (dailyPlanAIService as any).llmClient,
            'getModel'
        ).mockReturnValue(mockModel);

        // Have to create a new instance to pick up the mocked GoogleGenAIClient
        // but dailyPlanAIService is already instantiated.
        // We can just overwrite its llmClient if necessary, or just rely on the fact that GoogleGenAIClient is mocked at the top.
        // Since GoogleGenAIClient was mocked before the module was imported, dailyPlanAIService's instance already uses the mock!

        // Mock promptManagerService.loadTemplate
        loadTemplateSpy = jest
            .spyOn(promptManagerService, 'loadTemplate')
            .mockResolvedValue('mocked prompt string');
    });

    afterEach(() => {
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
        if (loadTemplateSpy) loadTemplateSpy.mockRestore();
    });

    const baseContext = {
        dailyFocus: {
            focus: 'grammar',
            targetSkills: ['grammar'],
            suggestedDomains: ['daily life'],
            estimatedMinutes: 30,
        },
        weekFocus: {
            weekNumber: 1,
            title: 'Week 1',
            summary: 'Intro',
            focusSkills: ['grammar'],
            targetWeaknesses: [
                {
                    skillKey: 's1',
                    skillName: 'Grammar',
                    severity: 'High',
                    category: 'gram',
                    userAccuracy: 50,
                },
            ],
            recommendedDomains: ['daily life'],
        },
    };

    describe('generateDailyPlan', () => {
        it('should successfully generate daily plan with full context', async () => {
            const mockOutput = { activities: [], reasoning: 'Because' };
            mockInvoke.mockResolvedValueOnce(mockOutput);

            const fullContext = {
                ...baseContext,
                competencyProfile: {
                    currentLevel: 'Beginner',
                    lowestSkills: [
                        {
                            skill: 'grammar',
                            currentAccuracy: 50,
                            proficiency: 'low',
                        },
                    ],
                },
                userPreferences: {
                    preferredStudyTime: 'morning',
                    contentInterests: ['sports'],
                },
                mistakesToReview: [
                    {
                        questionId: 'q1',
                        questionText: 'is this correct?',
                        mistakeCount: 3,
                        contentTags: ['tag1'],
                    },
                ],
                availableResources: [
                    { type: 'video', title: 'Video 1', description: 'desc' },
                ],
                missedSessions: [
                    {
                        focus: 'vocab',
                        targetSkills: ['vocab'],
                        suggestedDomains: ['work'],
                    },
                ],
                userDirectives: {
                    focus: 'test prep',
                    note: 'important',
                    materials: [{ title: 'mat1', type: 'doc', domain: 'work' }],
                },
            };

            const result =
                await dailyPlanAIService.generateDailyPlan(fullContext);

            expect(result).toEqual(mockOutput);
            expect(loadTemplateSpy).toHaveBeenCalledTimes(1);
            expect(mockInvoke).toHaveBeenCalledWith('mocked prompt string');

            // Check if user directives block was rendered properly
            const loadTemplateCallArgs = loadTemplateSpy.mock.calls[0];
            expect(loadTemplateCallArgs[0]).toBe(
                'studyplan/daily_plan_generation'
            );
            expect(loadTemplateCallArgs[1].userDirectivesBlock).toContain(
                'USER-PROVIDED STUDY MATERIAL'
            );
        });

        it('should successfully generate daily plan with minimal context (undefined optional fields)', async () => {
            const mockOutput = { activities: [], reasoning: 'Because' };
            mockInvoke.mockResolvedValueOnce(mockOutput);

            const minimalContext = {
                ...baseContext,
                // omit all optionals
            };

            const result =
                await dailyPlanAIService.generateDailyPlan(minimalContext);

            expect(result).toEqual(mockOutput);
            expect(loadTemplateSpy).toHaveBeenCalledTimes(1);

            const loadTemplateCallArgs = loadTemplateSpy.mock.calls[0];
            expect(loadTemplateCallArgs[1].userDirectivesBlock).toBe('');
            expect(loadTemplateCallArgs[1].competencyProfileBlock).toBe('');
            expect(loadTemplateCallArgs[1].mistakesToReviewBlock).toContain(
                'No mistakes in stack for this week.'
            );
            expect(loadTemplateCallArgs[1].missedSessionsBlock).toBe('');
            expect(loadTemplateCallArgs[1].availableResourcesList).toBe(
                'None available'
            );
        });

        it('should handle targetWeaknesses with missing optional fields (userAccuracy)', async () => {
            const mockOutput = { activities: [], reasoning: 'Because' };
            mockInvoke.mockResolvedValueOnce(mockOutput);

            const context = {
                ...baseContext,
                weekFocus: {
                    ...baseContext.weekFocus,
                    targetWeaknesses: [
                        {
                            skillKey: 's1',
                            skillName: 'Grammar',
                            severity: 'High',
                            category: 'gram',
                        }, // no userAccuracy
                    ],
                },
            };

            await dailyPlanAIService.generateDailyPlan(context);

            const loadTemplateCallArgs = loadTemplateSpy.mock.calls[0];
            expect(loadTemplateCallArgs[1].targetWeaknesses).toContain(
                'accuracy: N/A%'
            );
        });

        it('should handle optional fields in availableResources and mistakesToReview', async () => {
            const mockOutput = { activities: [], reasoning: 'Because' };
            mockInvoke.mockResolvedValueOnce(mockOutput);

            const context = {
                ...baseContext,
                mistakesToReview: [
                    { questionId: 'q1', questionText: 'q', mistakeCount: 3 }, // no skillTag, partNumber, difficulty, contentTags
                ],
                availableResources: [
                    {
                        type: 'video',
                        title: 'Video 1',
                        description: 'desc',
                        url: 'http',
                    }, // no domain, topics
                ],
            };

            await dailyPlanAIService.generateDailyPlan(context);

            const loadTemplateCallArgs = loadTemplateSpy.mock.calls[0];
            expect(loadTemplateCallArgs[1].mistakesToReviewBlock).toContain(
                'Skill: N/A'
            );
            expect(loadTemplateCallArgs[1].availableResourcesList).toContain(
                'URL: http'
            );
            expect(loadTemplateCallArgs[1].availableResourcesList).toContain(
                'Domain: N/A'
            );
        });

        it('should handle userDirectives without note or domain', async () => {
            const mockOutput = { activities: [], reasoning: 'Because' };
            mockInvoke.mockResolvedValueOnce(mockOutput);

            const context = {
                ...baseContext,
                userDirectives: {
                    focus: 'test prep',
                    materials: [{ title: 'mat1', type: 'doc' }], // no note, no domain
                },
            };

            await dailyPlanAIService.generateDailyPlan(context);

            const loadTemplateCallArgs = loadTemplateSpy.mock.calls[0];
            expect(loadTemplateCallArgs[1].userDirectivesBlock).not.toContain(
                'Learner note:'
            );
            expect(loadTemplateCallArgs[1].userDirectivesBlock).not.toContain(
                '['
            );
        });

        it('should handle competencyProfile without lowestSkills', async () => {
            const mockOutput = { activities: [], reasoning: 'Because' };
            mockInvoke.mockResolvedValueOnce(mockOutput);

            const context = {
                ...baseContext,
                competencyProfile: { currentLevel: 'Beginner' },
            };

            await dailyPlanAIService.generateDailyPlan(context);

            const loadTemplateCallArgs = loadTemplateSpy.mock.calls[0];
            expect(loadTemplateCallArgs[1].competencyProfileBlock).toContain(
                'Lowest Skills: N/A'
            );
        });

        it('should throw an error and log if LLM invocation fails', async () => {
            mockInvoke.mockRejectedValueOnce(new Error('LLM crash'));

            await expect(
                dailyPlanAIService.generateDailyPlan(baseContext)
            ).rejects.toThrow('Failed to generate daily plan');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error generating daily plan:',
                expect.any(Error)
            );
        });
    });
});
