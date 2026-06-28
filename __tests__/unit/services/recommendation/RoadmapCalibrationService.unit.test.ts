/* eslint-disable @typescript-eslint/no-explicit-any */
import { roadmapCalibrationService } from '~/services/recommendation/RoadmapCalibrationService.js';
import { Roadmap } from '~/models/roadmapModel.js';
import { User } from '~/models/userModel.js';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

jest.mock('~/models/roadmapModel.js', () => ({
    Roadmap: {
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
    },
}));
jest.mock('~/models/userModel.js', () => ({
    User: {
        findById: jest.fn(),
    },
}));
jest.mock('~/ai/provider/googleGenAIClient.js', () => ({
    GoogleGenAIClient: jest.fn().mockImplementation(() => ({
        getModel: jest.fn(),
    })),
}));
jest.mock('@langchain/core/output_parsers', () => ({
    JsonOutputParser: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('~/ai/service/PromptManagerService.js', () => ({
    promptManagerService: {
        loadTemplate: jest.fn(),
    },
}));

const mockedRoadmap = Roadmap as jest.Mocked<typeof Roadmap>;
const mockedUser = User as jest.Mocked<typeof User>;
const mockedGoogleGenAIClient = GoogleGenAIClient as jest.MockedClass<
    typeof GoogleGenAIClient
>;
const mockedPromptManagerService = promptManagerService as jest.Mocked<
    typeof promptManagerService
>;

describe('RoadmapCalibrationService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // We'll mock Date to a fixed day. Let's say today is Wednesday (3).
    // So days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    beforeAll(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2023-11-01T12:00:00Z')); // 2023-11-01 is Wednesday
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    function buildMockRoadmap(overrides: any = {}) {
        return {
            _id: 'roadmap1',
            userId: 'user1',
            activeWeekNumber: 1,
            weeklyFocuses: [
                {
                    weekNumber: 1,
                    title: 'Week 1',
                    dailyFocuses: [
                        {
                            dayNumber: 1,
                            dayOfWeek: 1,
                            focus: 'Mon',
                            status: 'pending',
                        },
                        {
                            dayNumber: 2,
                            dayOfWeek: 2,
                            focus: 'Tue',
                            status: 'pending',
                        },
                        {
                            dayNumber: 3,
                            dayOfWeek: 3,
                            focus: 'Wed',
                            status: 'pending',
                        },
                        {
                            dayNumber: 4,
                            dayOfWeek: 4,
                            focus: 'Thu',
                            status: 'pending',
                        },
                        {
                            dayNumber: 5,
                            dayOfWeek: 5,
                            focus: 'Fri',
                            status: 'pending',
                        },
                    ],
                },
            ],
            save: jest.fn().mockResolvedValue(true),
            checkAndUpdateActiveWeek: jest.fn().mockReturnValue(false),
            markModified: jest.fn(),
            ...overrides,
        };
    }

    describe('checkMissedSessions', () => {
        it('should throw ApiError if roadmap not found', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(null);
            await expect(
                roadmapCalibrationService.checkMissedSessions('user1')
            ).rejects.toThrow(ApiError);
            await expect(
                roadmapCalibrationService.checkMissedSessions('user1')
            ).rejects.toThrow(ErrorMessage.ROADMAP_NOT_FOUND.message);
        });

        it('should return up to date if user not found or no preferences', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(
                buildMockRoadmap()
            );
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({
                    select: jest.fn().mockReturnThis(),
                    lean: jest.fn().mockResolvedValue(null),
                });

            const result =
                await roadmapCalibrationService.checkMissedSessions('user1');
            expect(result.action).toBe('none');
            expect(result.hasMissedSessions).toBe(false);
        });

        it('should return up to date if activeWeek or dailyFocuses missing', async () => {
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [{ weekNumber: 1 }],
            }); // no dailyFocuses
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);
            const user = { preferences: { studyDaysOfWeek: [1, 2, 3, 4, 5] } };
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({
                    select: jest.fn().mockReturnThis(),
                    lean: jest.fn().mockResolvedValue(user),
                });

            const result =
                await roadmapCalibrationService.checkMissedSessions('user1');
            expect(result.action).toBe('none');
        });

        it('should return up to date if week completed and progressing', async () => {
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        dailyFocuses: [
                            {
                                dayNumber: 1,
                                dayOfWeek: 1,
                                focus: 'Mon',
                                status: 'completed',
                            },
                            {
                                dayNumber: 2,
                                dayOfWeek: 4,
                                focus: 'Thu',
                                status: 'pending',
                            }, // 4 is > today(3)
                        ],
                    },
                ],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);
            const user = { preferences: { studyDaysOfWeek: [1, 2, 3, 4, 5] } };
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({
                    select: jest.fn().mockReturnThis(),
                    lean: jest.fn().mockResolvedValue(user),
                });

            const result =
                await roadmapCalibrationService.checkMissedSessions('user1');
            expect(result.action).toBe('none');
            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('checking if should progress')
            );
        });

        it('should mark as skipped if missed sessions <= 2', async () => {
            // Today is Wednesday(3). Days 1 and 2 are missed.
            const roadmap = buildMockRoadmap();
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);
            const user = { preferences: { studyDaysOfWeek: [1, 2, 3, 4, 5] } };
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({
                    select: jest.fn().mockReturnThis(),
                    lean: jest.fn().mockResolvedValue(user),
                });
            (mockedRoadmap.findOneAndUpdate as any).mockResolvedValue(roadmap);

            const result =
                await roadmapCalibrationService.checkMissedSessions('user1');

            expect(result.action).toBe('mark_skipped');
            expect(result.missedCount).toBe(2);
            expect(roadmap.weeklyFocuses[0].dailyFocuses[0].status).toBe(
                'skipped'
            ); // day 1
            expect(roadmap.weeklyFocuses[0].dailyFocuses[1].status).toBe(
                'skipped'
            ); // day 2
            expect(roadmap.weeklyFocuses[0].dailyFocuses[2].status).toBe(
                'pending'
            ); // day 3 (today)
            expect(mockedRoadmap.findOneAndUpdate).toHaveBeenCalled();
        });

        it('should handle uncompleted sessions in regenerateWeekContent', async () => {
            const user = {
                _id: 'userId',
                preferences: { studyDaysOfWeek: [1, 2, 3] },
                competencyProfile: {
                    skillMatrix: [
                        {
                            skill: 'GRAMMAR',
                            currentAccuracy: 50,
                            proficiency: 'weak',
                        },
                    ],
                },
            };
            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(user),
            });

            const roadmap = {
                roadmapId: 'test-roadmap',
                activeWeekNumber: 1,
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        title: 'Week 1',
                        summary: 'Summary',
                        focusSkills: ['A'],
                        targetWeaknesses: [
                            { skillName: 'A', severity: 'HIGH' },
                        ], // Missing userAccuracy
                        recommendedDomains: ['D1'],
                        dailyFocuses: [
                            { dayOfWeek: 1, status: 'skipped', focus: 'f1' }, // Not completed
                            {
                                dayOfWeek: 2,
                                status: 'completed',
                                focus: 'f2',
                                targetSkills: ['S1'],
                            }, // Completed
                        ],
                    },
                ],
                save: jest.fn(),
                markModified: jest.fn(),
            };

            const mockParsedResponse = {
                dailyFocuses: [
                    {
                        dayNumber: 2,
                        dayOfWeek: 2,
                        focus: 'New Focus',
                        targetSkills: ['A'],
                        suggestedDomains: ['D1'],
                    },
                ],
            };

            const mockLlmClient = {
                getModel: jest.fn().mockReturnValue({
                    pipe: jest.fn().mockReturnValue({
                        invoke: jest.fn().mockResolvedValue(mockParsedResponse),
                    }),
                }),
            };
            mockedGoogleGenAIClient.mockImplementation(
                () => mockLlmClient as any
            );
            mockedPromptManagerService.loadTemplate.mockResolvedValue('prompt');

            await (roadmapCalibrationService as any).regenerateWeekContent(
                roadmap,
                1,
                'userId'
            );
            expect(roadmap.weeklyFocuses[0].dailyFocuses[0].focus).toBe(
                'New Focus'
            );
        });

        it('should fallback to defaults in regenerateWeekContent when properties missing', async () => {
            const user = {
                _id: 'userId',
                preferences: {}, // Missing studyDaysOfWeek
            };
            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(user),
            });

            const roadmap = {
                roadmapId: 'test-roadmap',
                activeWeekNumber: 1,
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        title: 'Week 1',
                        summary: 'Summary',
                        focusSkills: [],
                        targetWeaknesses: [],
                        recommendedDomains: [],
                        // Missing dailyFocuses entirely
                    },
                ],
                save: jest.fn(),
                markModified: jest.fn(),
            };

            const mockParsedResponse = {
                dailyFocuses: [
                    {
                        dayNumber: 2,
                        dayOfWeek: 2,
                        focus: 'F',
                        targetSkills: [],
                        suggestedDomains: [],
                    },
                ],
            };

            const mockLlmClient = {
                getModel: jest.fn().mockReturnValue({
                    pipe: jest.fn().mockReturnValue({
                        invoke: jest.fn().mockResolvedValue(mockParsedResponse),
                    }),
                }),
            };
            mockedGoogleGenAIClient.mockImplementation(
                () => mockLlmClient as any
            );
            mockedPromptManagerService.loadTemplate.mockResolvedValue('prompt');

            await (roadmapCalibrationService as any).regenerateWeekContent(
                roadmap,
                1,
                'userId'
            );
            expect(
                (roadmap.weeklyFocuses[0] as any).dailyFocuses[0].focus
            ).toBe('F');
        });

        it('should hit N/A for targetSkills in completedSessions block', async () => {
            const user = { _id: 'u' };
            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(user),
            });

            const roadmap = {
                roadmapId: 'test-roadmap',
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        title: 'W1',
                        summary: 'S',
                        focusSkills: [],
                        targetWeaknesses: [],
                        recommendedDomains: [],
                        dailyFocuses: [
                            { dayOfWeek: 1, status: 'completed', focus: 'f1' }, // Missing targetSkills
                        ],
                    },
                ],
                save: jest.fn(),
                markModified: jest.fn(),
            };

            mockedGoogleGenAIClient.mockImplementation(
                () =>
                    ({
                        getModel: jest.fn().mockReturnValue({
                            pipe: jest.fn().mockReturnValue({
                                invoke: jest
                                    .fn()
                                    .mockResolvedValue({ dailyFocuses: [] }),
                            }),
                        }),
                    }) as any
            );

            await (roadmapCalibrationService as any).regenerateWeekContent(
                roadmap,
                1,
                'userId'
            );
            expect(roadmap.save).toHaveBeenCalled();
        });

        it('should throw ApiError if activeWeek not found in regenerateWeekContent', async () => {
            const roadmap = {
                roadmapId: 'test-roadmap',
                weeklyFocuses: [],
            };
            await expect(
                (roadmapCalibrationService as any).regenerateWeekContent(
                    roadmap,
                    1,
                    'userId'
                )
            ).rejects.toThrow();
        });

        it('should throw ApiError if user not found in regenerateWeekContent', async () => {
            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });
            const roadmap = {
                roadmapId: 'test-roadmap',
                weeklyFocuses: [{ weekNumber: 1 }],
            };
            await expect(
                (roadmapCalibrationService as any).regenerateWeekContent(
                    roadmap,
                    1,
                    'userId'
                )
            ).rejects.toThrow();
        });

        it('should regenerate week if missed sessions > 2', async () => {
            // Change today to Friday(5)
            jest.setSystemTime(new Date('2023-11-03T12:00:00Z'));

            const roadmap = buildMockRoadmap({
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        title: 'Week 1',
                        summary: 'Sum',
                        focusSkills: ['G'],
                        targetWeaknesses: [],
                        recommendedDomains: ['D'],
                        dailyFocuses: [
                            {
                                dayNumber: 1,
                                dayOfWeek: 1,
                                focus: 'Mon',
                                status: 'pending',
                            },
                            {
                                dayNumber: 2,
                                dayOfWeek: 2,
                                focus: 'Tue',
                                status: 'pending',
                            },
                            {
                                dayNumber: 3,
                                dayOfWeek: 3,
                                focus: 'Wed',
                                status: 'pending',
                            },
                            {
                                dayNumber: 4,
                                dayOfWeek: 4,
                                focus: 'Thu',
                                status: 'pending',
                            },
                            {
                                dayNumber: 5,
                                dayOfWeek: 5,
                                focus: 'Fri',
                                status: 'pending',
                            },
                        ],
                    },
                ],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);
            const user = {
                preferences: { studyDaysOfWeek: [1, 2, 3, 4, 5] },
                competencyProfile: { skillMatrix: [] },
            };
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({
                    select: jest.fn().mockReturnThis(),
                    lean: jest.fn().mockResolvedValue(user),
                });

            const mockLlmClient = {
                getModel: jest.fn().mockReturnValue({
                    pipe: jest.fn().mockReturnValue({
                        invoke: jest.fn().mockResolvedValue({
                            dailyFocuses: [
                                {
                                    dayOfWeek: 5,
                                    focus: 'New Fri',
                                    targetSkills: [],
                                    suggestedDomains: [],
                                    estimatedMinutes: 30,
                                    foundationWeight: 50,
                                },
                            ],
                            reasoning: 'regen',
                        }),
                    }),
                }),
            };
            mockedGoogleGenAIClient.mockImplementation(
                () => mockLlmClient as any
            );
            mockedPromptManagerService.loadTemplate.mockResolvedValue('prompt');

            const result =
                await roadmapCalibrationService.checkMissedSessions('user1');

            expect(result.action).toBe('regenerate_week');
            expect(result.missedCount).toBe(4); // Mon, Tue, Wed, Thu
            expect(roadmap.save).toHaveBeenCalled();
            expect(roadmap.weeklyFocuses[0].dailyFocuses[0].focus).toBe(
                'New Fri'
            );

            jest.setSystemTime(new Date('2023-11-01T12:00:00Z')); // reset to Wed
        });

        it('should throw ApiError if generateDailyFocusesForWeek fails to find week', async () => {
            const roadmap = buildMockRoadmap();
            await expect(
                roadmapCalibrationService.generateDailyFocusesForWeek(
                    roadmap as any,
                    99
                )
            ).rejects.toThrow(ApiError);
        });

        it('should throw error if regenerate content LLM fails', async () => {
            jest.setSystemTime(new Date('2023-11-03T12:00:00Z'));
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        title: 'W1',
                        summary: 'S',
                        focusSkills: [],
                        targetWeaknesses: [],
                        recommendedDomains: [],
                        dailyFocuses: [
                            { dayNumber: 1, dayOfWeek: 1, status: 'pending' },
                            { dayNumber: 2, dayOfWeek: 2, status: 'pending' },
                            { dayNumber: 3, dayOfWeek: 3, status: 'pending' },
                            { dayNumber: 4, dayOfWeek: 4, status: 'pending' },
                            { dayNumber: 5, dayOfWeek: 5, status: 'pending' },
                        ],
                    },
                ],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);
            const user = { preferences: { studyDaysOfWeek: [1, 2, 3, 4, 5] } };
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({
                    select: jest.fn().mockReturnThis(),
                    lean: jest.fn().mockResolvedValue(user),
                });

            const mockLlmClient = {
                getModel: jest.fn().mockReturnValue({
                    pipe: jest.fn().mockReturnValue({
                        invoke: jest
                            .fn()
                            .mockRejectedValue(new Error('LLM fail')),
                    }),
                }),
            };
            mockedGoogleGenAIClient.mockImplementation(
                () => mockLlmClient as any
            );

            await expect(
                roadmapCalibrationService.checkMissedSessions('user1')
            ).rejects.toThrow('Failed to regenerate week content');
        });

        it('should return early from markMissedSessions if no activeWeek or dailyFocuses', async () => {
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [{ weekNumber: 2 }],
            }); // activeWeek is 1
            await (roadmapCalibrationService as any).markMissedSessions(
                roadmap,
                []
            );
            expect(roadmap.save).not.toHaveBeenCalled();
        });

        it('should do nothing in markMissedSessions if daily focus not found', async () => {
            const roadmap = buildMockRoadmap();
            await (roadmapCalibrationService as any).markMissedSessions(
                roadmap,
                [{ dayNumber: 99 }]
            );
            expect(roadmap.weeklyFocuses[0].dailyFocuses[0].status).toBe(
                'pending'
            );
        });
    });

    describe('getSkippedSessionsContent', () => {
        it('should return empty if roadmap not found', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(null);
            const result =
                await roadmapCalibrationService.getSkippedSessionsContent(
                    'user1'
                );
            expect(result.hasSkippedSessions).toBe(false);
        });

        it('should return empty if no active week or dailyFocuses', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(
                buildMockRoadmap({ weeklyFocuses: [] })
            );
            const result =
                await roadmapCalibrationService.getSkippedSessionsContent(
                    'user1'
                );
            expect(result.hasSkippedSessions).toBe(false);
        });

        it('should return empty if no skipped sessions', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(
                buildMockRoadmap()
            );
            const result =
                await roadmapCalibrationService.getSkippedSessionsContent(
                    'user1'
                );
            expect(result.hasSkippedSessions).toBe(false);
        });

        it('should skip missed sessions detection if status is completed or not a study day', async () => {
            const roadmap = {
                activeWeekNumber: 1,
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        dailyFocuses: [
                            { dayOfWeek: 1, status: 'completed' }, // Completed
                            { dayOfWeek: 6, status: 'pending' }, // Not a study day (studyDays = [1,2,3,4,5])
                            { dayOfWeek: 1, status: 'pending' }, // Will be caught as missed if currentDayOfWeek > 1
                        ],
                    },
                ],
            } as any;

            jest.setSystemTime(new Date('2023-11-01T12:00:00Z')); // Wednesday (3)
            const missed = await (
                roadmapCalibrationService as any
            ).identifyMissedSessions(roadmap, [1, 2, 3, 4, 5]);
            expect(missed.length).toBe(1);
            expect(missed[0].dayOfWeek).toBeUndefined(); // as we didn't mock dayNumber, but length is 1
        });

        it('should return skipped content mapped', async () => {
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        dailyFocuses: [
                            {
                                status: 'skipped',
                                focus: 'S1',
                                targetSkills: ['G'],
                                suggestedDomains: [],
                            },
                            { status: 'skipped', focus: 'S2' }, // defaults
                        ],
                    },
                ],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const result =
                await roadmapCalibrationService.getSkippedSessionsContent(
                    'user1'
                );
            expect(result.hasSkippedSessions).toBe(true);
            expect(result.skippedContent).toHaveLength(2);
            expect(result.skippedContent[0].focus).toBe('S1');
            expect(result.skippedContent[1].targetSkills).toEqual([]);
        });
    });

    describe('checkAndProgressWeek', () => {
        it('should throw ApiError if roadmap not found', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(null);
            await expect(
                roadmapCalibrationService.checkAndProgressWeek('r1')
            ).rejects.toThrow(ApiError);
        });

        it('should return not progressed if no active week', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(
                buildMockRoadmap({ weeklyFocuses: [] })
            );
            const result =
                await roadmapCalibrationService.checkAndProgressWeek('r1');
            expect(result.progressed).toBe(false);
        });

        it('should return not progressed if not all completed', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(
                buildMockRoadmap()
            );
            const result =
                await roadmapCalibrationService.checkAndProgressWeek('r1');
            expect(result.progressed).toBe(false);
            expect(result.message).toContain('You still have');
        });

        it('should progress and check next week if all completed', async () => {
            const roadmap: any = buildMockRoadmap({
                activeWeekNumber: 1,
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        dailyFocuses: [
                            { status: 'completed' },
                            { status: 'skipped' },
                        ],
                    },
                ],
            });
            roadmap.checkAndUpdateActiveWeek = jest
                .fn()
                .mockImplementation(() => {
                    roadmap.activeWeekNumber = 2;
                    return true;
                });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const result =
                await roadmapCalibrationService.checkAndProgressWeek('r1');
            expect(result.progressed).toBe(true);
            expect(result.newWeekNumber).toBe(2);
            expect(roadmap.save).toHaveBeenCalled();
        });

        it('should progress and generate next week if missing dailyFocuses', async () => {
            const roadmap: any = buildMockRoadmap({
                activeWeekNumber: 1,
                studyDaysPerWeek: 5,
                studyTimePerDay: 45,
                weeklyFocuses: [
                    { weekNumber: 1, dailyFocuses: [{ status: 'completed' }] },
                    { weekNumber: 2, dailyFocuses: [] }, // next week empty
                ],
            });
            roadmap.checkAndUpdateActiveWeek = jest
                .fn()
                .mockImplementation(() => {
                    roadmap.activeWeekNumber = 2;
                    return true;
                });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const user = { preferences: { studyDaysOfWeek: [1, 2, 3] } };
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({
                    select: jest.fn().mockReturnThis(),
                    lean: jest.fn().mockResolvedValue(user),
                });

            const result =
                await roadmapCalibrationService.checkAndProgressWeek('r1');
            expect(result.progressed).toBe(true);
            expect(roadmap.weeklyFocuses[1].dailyFocuses.length).toBe(5); // studyDaysCount
            expect(roadmap.save).toHaveBeenCalled();
        });

        it('should progress and generate next week if nextWeek.dailyFocuses is undefined', async () => {
            const roadmap: any = buildMockRoadmap({
                activeWeekNumber: 1,
                studyDaysPerWeek: 5,
                studyTimePerDay: 45,
                weeklyFocuses: [
                    { weekNumber: 1, dailyFocuses: [{ status: 'completed' }] },
                    {
                        weekNumber: 2,
                        focusSkills: ['S'],
                        recommendedDomains: ['D'],
                    }, // no dailyFocuses
                ],
            });
            roadmap.checkAndUpdateActiveWeek = jest
                .fn()
                .mockImplementation(() => {
                    roadmap.activeWeekNumber = 2;
                    return true;
                });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const user = { preferences: { studyDaysOfWeek: [1, 2, 3] } };
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({
                    select: jest.fn().mockReturnThis(),
                    lean: jest.fn().mockResolvedValue(user),
                });

            const result =
                await roadmapCalibrationService.checkAndProgressWeek('r1');
            expect(result.progressed).toBe(true);
            expect(roadmap.weeklyFocuses[1].dailyFocuses.length).toBe(5);
        });

        it('should use default user preferences if missing when generating daily focuses', async () => {
            const roadmap: any = buildMockRoadmap({
                activeWeekNumber: 1,
                studyDaysPerWeek: 5,
                weeklyFocuses: [
                    { weekNumber: 1, dailyFocuses: [{ status: 'completed' }] },
                    { weekNumber: 2, dailyFocuses: [] },
                ],
            });
            roadmap.checkAndUpdateActiveWeek = jest
                .fn()
                .mockImplementation(() => {
                    roadmap.activeWeekNumber = 2;
                    return true;
                });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const user = { preferences: { primaryGoal: 'TOEIC 800' } }; // missing studyDaysOfWeek
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({
                    select: jest.fn().mockReturnThis(),
                    lean: jest.fn().mockResolvedValue(user),
                });

            const result =
                await roadmapCalibrationService.checkAndProgressWeek('r1');
            expect(result.progressed).toBe(true);
        });

        it('should fallback when user.preferences is completely missing', async () => {
            const roadmap: any = buildMockRoadmap({
                activeWeekNumber: 1,
                studyDaysPerWeek: 5,
                weeklyFocuses: [
                    { weekNumber: 1, dailyFocuses: [{ status: 'completed' }] },
                    { weekNumber: 2, dailyFocuses: [] },
                ],
            });
            roadmap.checkAndUpdateActiveWeek = jest
                .fn()
                .mockImplementation(() => {
                    roadmap.activeWeekNumber = 2;
                    return true;
                });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const user = {}; // missing preferences entirely
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({
                    select: jest.fn().mockReturnThis(),
                    lean: jest.fn().mockResolvedValue(user),
                });

            const result =
                await roadmapCalibrationService.checkAndProgressWeek('r1');
            expect(result.progressed).toBe(true);
        });

        it('should handle generateDailyFocusesForWeek throwing ApiError if user not found', async () => {
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [
                    { weekNumber: 1, dailyFocuses: [{ status: 'completed' }] },
                    { weekNumber: 2, dailyFocuses: [] },
                ],
                checkAndUpdateActiveWeek: jest.fn().mockReturnValue(true),
                activeWeekNumber: 2,
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({
                    select: jest.fn().mockReturnThis(),
                    lean: jest.fn().mockResolvedValue(null),
                });

            await expect(
                roadmapCalibrationService.checkAndProgressWeek('r1')
            ).rejects.toThrow(ErrorMessage.USER_NOT_FOUND.message);
        });

        it('should not progress if checkAndUpdateActiveWeek returns false', async () => {
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [
                    { weekNumber: 1, dailyFocuses: [{ status: 'completed' }] },
                ],
                checkAndUpdateActiveWeek: jest.fn().mockReturnValue(false),
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);
            const result =
                await roadmapCalibrationService.checkAndProgressWeek('r1');
            expect(result.progressed).toBe(false);
        });
    });

    describe('generateDailyFocusesForWeek', () => {
        it('should fallback to 5 for studyDaysCount if studyDaysPerWeek is missing', async () => {
            const roadmap: any = buildMockRoadmap({
                activeWeekNumber: 1,
                studyDaysPerWeek: undefined, // line 375 fallback
                studyTimePerDay: 45,
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        dailyFocuses: [],
                        focusSkills: [],
                        recommendedDomains: [],
                    },
                ],
            });
            const user = { preferences: { studyDaysOfWeek: [1, 2, 3] } };
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({
                    select: jest.fn().mockReturnThis(),
                    lean: jest.fn().mockResolvedValue(user),
                });

            await roadmapCalibrationService.generateDailyFocusesForWeek(
                roadmap,
                1
            );
            expect(roadmap.weeklyFocuses[0].dailyFocuses.length).toBe(5);
        });
    });

    describe('updateLastActiveDate', () => {
        it('should update', async () => {
            (mockedRoadmap.findOneAndUpdate as any).mockResolvedValue({});
            await roadmapCalibrationService.updateLastActiveDate('r1');
            expect(mockedRoadmap.findOneAndUpdate).toHaveBeenCalledWith(
                { roadmapId: 'r1' },
                { lastActiveDate: expect.any(Date) }
            );
        });
    });
});
