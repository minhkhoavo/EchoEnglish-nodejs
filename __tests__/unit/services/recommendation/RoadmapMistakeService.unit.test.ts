/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types } from 'mongoose';
import { roadmapMistakeService } from '~/services/recommendation/RoadmapMistakeService.js';
import { Roadmap } from '~/models/roadmapModel.js';

jest.mock('~/models/roadmapModel.js', () => ({
    Roadmap: {
        findOne: jest.fn(),
    },
}));

const mockedRoadmap = Roadmap as jest.Mocked<typeof Roadmap>;

describe('RoadmapMistakeService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function buildMockRoadmap(overrides: any = {}) {
        return {
            _id: new Types.ObjectId(),
            userId: 'user1',
            status: 'active',
            currentWeek: 1,
            weeklyFocuses: [
                {
                    weekNumber: 1,
                    mistakes: [],
                },
            ],
            save: jest.fn().mockResolvedValue(true),
            ...overrides,
        };
    }

    describe('addMultipleMistakes', () => {
        it('should throw if no active roadmap found', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(null);
            await expect(
                roadmapMistakeService.addMultipleMistakes('user1', [])
            ).rejects.toThrow('No active roadmap found');
        });

        it('should handle adding mistakes to a missing week gracefully (skips)', async () => {
            const roadmap = buildMockRoadmap({ weeklyFocuses: [] }); // empty weeks
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const result = await roadmapMistakeService.addMultipleMistakes(
                'user1',
                [{ questionId: new Types.ObjectId(), questionText: 'Q1' }]
            );

            expect(result.success).toBe(true);
            expect(result.addedCount).toBe(1);
            expect(roadmap.save).toHaveBeenCalled();
            // Since week was not found, nothing was added, but the process didn't throw
        });

        it('should create mistakes array if it does not exist in the week', async () => {
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [{ weekNumber: 1 }], // missing mistakes array
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const qId = new Types.ObjectId();
            await roadmapMistakeService.addMultipleMistakes('user1', [
                { questionId: qId.toString(), questionText: 'Q1' },
            ]);

            expect(roadmap.weeklyFocuses[0].mistakes).toBeDefined();
            expect(
                roadmap.weeklyFocuses[0].mistakes[0].questionId.toString()
            ).toBe(qId.toString());
            expect(roadmap.weeklyFocuses[0].mistakes[0].mistakeCount).toBe(1);
        });

        it('should add new mistake and increment existing mistake count', async () => {
            const qId1 = new Types.ObjectId();
            const qId2 = new Types.ObjectId();

            const roadmap = buildMockRoadmap({
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        mistakes: [
                            {
                                questionId: qId1,
                                questionText: 'Q1',
                                mistakeCount: 1,
                                addedDate: new Date(),
                            },
                        ],
                    },
                ],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            await roadmapMistakeService.addMultipleMistakes('user1', [
                { questionId: qId1.toString(), questionText: 'Q1 updated' },
                { questionId: qId2.toString(), questionText: 'Q2 new' },
            ]);

            const mistakes = roadmap.weeklyFocuses[0].mistakes;
            expect(mistakes).toHaveLength(2);

            // Q2 new should be at index 0 because it's unshifted
            expect(mistakes[0].questionId.toString()).toBe(qId2.toString());
            expect(mistakes[0].mistakeCount).toBe(1);

            // Q1 updated should be at index 0 after being unshifted?
            // Wait, Q1 was added first, then Q2.
            // Loop: Q1 -> unshift to 0. Then Q2 -> unshift to 0.
            // So Q2 is at 0, Q1 is at 1.
            expect(mistakes[1].questionId.toString()).toBe(qId1.toString());
            expect(mistakes[1].mistakeCount).toBe(2);
        });

        it('should fallback to week 1 if roadmap.currentWeek is missing', async () => {
            const qId = new Types.ObjectId();
            const roadmap = buildMockRoadmap({
                currentWeek: undefined,
                weeklyFocuses: [{ weekNumber: 1, mistakes: [] }],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            await roadmapMistakeService.addMultipleMistakes('user1', [
                { questionId: qId, questionText: 'Q1' },
            ]);

            expect(roadmap.weeklyFocuses[0].mistakes).toHaveLength(1);
        });
    });

    describe('removeMistake', () => {
        it('should throw if no active roadmap found', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(null);
            await expect(
                roadmapMistakeService.removeMistake(
                    'user1',
                    new Types.ObjectId()
                )
            ).rejects.toThrow('No active roadmap found');
        });

        it('should remove mistake from the week', async () => {
            const qId1 = new Types.ObjectId();
            const qId2 = new Types.ObjectId();

            const roadmap = buildMockRoadmap({
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        mistakes: [
                            { questionId: qId1, questionText: 'Q1' },
                            { questionId: qId2, questionText: 'Q2' },
                        ],
                    },
                ],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const result = await roadmapMistakeService.removeMistake(
                'user1',
                qId1.toString()
            );

            expect(result.success).toBe(true);
            const mistakes = roadmap.weeklyFocuses[0].mistakes;
            expect(mistakes).toHaveLength(1);
            expect(mistakes[0].questionId.toString()).toBe(qId2.toString());
            expect(roadmap.save).toHaveBeenCalled();
        });

        it('should handle week not found gracefully', async () => {
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const result = await roadmapMistakeService.removeMistake(
                'user1',
                new Types.ObjectId(),
                99
            );

            expect(result.success).toBe(true);
            expect(roadmap.save).toHaveBeenCalled();
        });

        it('should fallback to roadmap.currentWeek or 1 if weekNumber is missing', async () => {
            const qId1 = new Types.ObjectId();
            const roadmap = buildMockRoadmap({
                currentWeek: undefined,
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        mistakes: [{ questionId: qId1, questionText: 'Q1' }],
                    },
                ],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            await roadmapMistakeService.removeMistake('user1', qId1); // no weekNumber
            expect(roadmap.weeklyFocuses[0].mistakes).toHaveLength(0);
        });

        it('should handle week existing but without mistakes array', async () => {
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [{ weekNumber: 1 }], // no mistakes array
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const result = await roadmapMistakeService.removeMistake(
                'user1',
                new Types.ObjectId()
            );
            expect(result.success).toBe(true);
        });
    });

    describe('getMistakesForPractice', () => {
        it('should return empty if roadmap not found', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(null);
            const result =
                await roadmapMistakeService.getMistakesForPractice('user1');
            expect(result.success).toBe(false);
            expect(result.mistakes).toEqual([]);
        });

        it('should return mistakes mapped correctly up to limit', async () => {
            const qId1 = new Types.ObjectId();
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        mistakes: [
                            {
                                questionId: qId1,
                                questionText: 'Q1',
                                contentTags: ['A'],
                                skillTag: 'S1',
                                partNumber: 1,
                                difficulty: 'easy',
                                mistakeCount: 2,
                            },
                            {
                                questionId: new Types.ObjectId(),
                                questionText: 'Q2',
                                mistakeCount: 1,
                            }, // missing optional fields
                        ],
                    },
                ],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const result = await roadmapMistakeService.getMistakesForPractice(
                'user1',
                undefined,
                1
            );

            expect(result.success).toBe(true);
            expect(result.weekNumber).toBe(1);
            expect(result.mistakes).toHaveLength(1);
            expect(result.mistakes[0].questionId).toBe(qId1.toString());
            expect(result.mistakes[0].skillTag).toBe('S1');
            expect(result.mistakes[0].mistakeCount).toBe(2);
        });

        it('should fallback to 1 if roadmap.currentWeek is undefined and weekNumber is undefined', async () => {
            const roadmapWithoutCurrentWeek = {
                roadmapId: 'road1',
                // currentWeek is undefined
                weeklyFocuses: [{ weekNumber: 1, mistakes: [] }],
            };
            (mockedRoadmap.findOne as jest.Mock).mockResolvedValue(
                roadmapWithoutCurrentWeek
            );
            const result =
                await roadmapMistakeService.getMistakesForPractice('user1');
            expect(result.success).toBe(true);
            expect(result.weekNumber).toBe(1);
        });

        it('should fallback missing fields to undefined', async () => {
            const qId2 = new Types.ObjectId();
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        mistakes: [
                            {
                                questionId: qId2,
                                questionText: 'Q2',
                                mistakeCount: 1,
                            },
                        ],
                    },
                ],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const result =
                await roadmapMistakeService.getMistakesForPractice('user1');

            expect(result.mistakes[0].skillTag).toBeUndefined();
            expect(result.mistakes[0].partNumber).toBeUndefined();
            expect(result.mistakes[0].difficulty).toBeUndefined();
        });

        it('should return empty mistakes if week not found', async () => {
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const result =
                await roadmapMistakeService.getMistakesForPractice('user1');

            expect(result.success).toBe(true);
            expect(result.mistakes).toEqual([]);
        });

        it('should return empty mistakes if week found but mistakes array is missing', async () => {
            const roadmap = buildMockRoadmap({
                weeklyFocuses: [{ weekNumber: 1 }],
            });
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const result =
                await roadmapMistakeService.getMistakesForPractice('user1');

            expect(result.success).toBe(true);
            expect(result.mistakes).toEqual([]);
        });
    });
});
