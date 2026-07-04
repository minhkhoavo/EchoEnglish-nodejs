/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types } from 'mongoose';
import { roadmapService } from '~/services/recommendation/RoadmapService.js';
import { Roadmap } from '~/models/roadmapModel.js';
import { TestResult } from '~/models/testResultModel.js';
import { User } from '~/models/userModel.js';
import { learningPlanAIService } from '~/ai/service/learningPlanAIService.js';
import { roadmapCalibrationService } from '~/services/recommendation/RoadmapCalibrationService.js';
import { determineToeicLevel } from '~/utils/toeicScore.js';
import { ApiError } from '~/middleware/apiError.js';

jest.mock('~/models/roadmapModel.js', () => ({
    Roadmap: {
        findOne: jest.fn(),
        find: jest.fn(),
        create: jest.fn(),
        findOneAndUpdate: jest.fn(),
    },
}));
jest.mock('~/models/testResultModel.js', () => ({
    TestResult: {
        findById: jest.fn(),
    },
}));
jest.mock('~/models/userModel.js', () => ({
    User: {
        findById: jest.fn(),
    },
}));
jest.mock('~/ai/service/learningPlanAIService.js', () => ({
    learningPlanAIService: {
        generateLearningRoadmap: jest.fn(),
    },
}));
jest.mock('~/services/recommendation/RoadmapCalibrationService.js', () => ({
    roadmapCalibrationService: {
        checkAndProgressWeek: jest.fn(),
    },
}));
jest.mock('~/utils/toeicScore.js', () => ({
    determineToeicLevel: jest.fn(),
}));

const mockedRoadmap = Roadmap as jest.Mocked<typeof Roadmap>;
const mockedUser = User as jest.Mocked<typeof User>;
const mockedTestResult = TestResult as jest.Mocked<typeof TestResult>;
const mockedLearningPlanAIService = learningPlanAIService as jest.Mocked<
    typeof learningPlanAIService
>;
const mockedRoadmapCalibrationService =
    roadmapCalibrationService as jest.Mocked<typeof roadmapCalibrationService>;

describe('RoadmapService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('generateRoadmap', () => {
        const defaultInput = {
            targetScore: 600,
            studyTimePerDay: 60,
            studyDaysPerWeek: 5,
        };

        it('should generate roadmap with no testResult and no user preferences', async () => {
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });

            mockedLearningPlanAIService.generateLearningRoadmap.mockResolvedValue(
                {
                    totalWeeks: 4,
                    currentLevel: 'B1',
                    learningStrategy: 'strategy',
                    phaseSummary: [],
                    weeklyFocuses: [],
                } as any
            );

            (mockedRoadmap.create as any).mockResolvedValue({ _id: 'r1' });

            const result = await roadmapService.generateRoadmap(
                'user1',
                defaultInput
            );

            expect(result).toEqual({ _id: 'r1' });
            expect(
                mockedLearningPlanAIService.generateLearningRoadmap
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    userPreferences: undefined,
                    testAnalysis: undefined,
                })
            );
            const createArgs = (mockedRoadmap.create as jest.Mock).mock
                .calls[0][0];
            expect(createArgs.currentLevel).toBe('B1'); // fallback from LLM
            expect(createArgs.totalSessions).toBe(20); // 4 weeks * 5 days
        });

        it('should generate roadmap using testResult and user preferences', async () => {
            const user = { preferences: { currentLevel: 'A2' } };
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(user),
            });

            const testResult = {
                totalScore: 450,
                analysis: {
                    examAnalysis: {
                        topWeaknesses: ['W1'],
                        strengths: ['S1'],
                        domainPerformance: ['D1'],
                        summary: 'Sum',
                    },
                },
            };
            (mockedTestResult.findById as any).mockResolvedValue(testResult);
            (determineToeicLevel as jest.Mock).mockReturnValue('A2');

            mockedLearningPlanAIService.generateLearningRoadmap.mockResolvedValue(
                {
                    totalWeeks: 8,
                    currentLevel: 'B1', // this should be overridden by detectedLevel A2
                    learningStrategy: 'strategy',
                    phaseSummary: [],
                    weeklyFocuses: [],
                } as any
            );

            (mockedRoadmap.create as any).mockResolvedValue({ _id: 'r2' });

            const testResultId = new Types.ObjectId();
            await roadmapService.generateRoadmap('user1', {
                ...defaultInput,
                testResultId,
            } as any);

            expect(
                mockedLearningPlanAIService.generateLearningRoadmap
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    testAnalysis: expect.objectContaining({ score: 450 }),
                })
            );
            const createArgs = (mockedRoadmap.create as jest.Mock).mock
                .calls[0][0];
            expect(createArgs.currentLevel).toBe('A2');
        });

        it('should handle testResult missing in database gracefully', async () => {
            const testId = new Types.ObjectId();
            (mockedTestResult.findById as jest.Mock).mockResolvedValue(null);
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });
            mockedLearningPlanAIService.generateLearningRoadmap.mockResolvedValue(
                { totalWeeks: 1 } as any
            );
            (mockedRoadmap.create as any).mockResolvedValue({ _id: 'r1' });

            await roadmapService.generateRoadmap('user1', {
                ...defaultInput,
                testResultId: testId,
            } as any);

            expect(mockedRoadmap.create).toHaveBeenCalled();
        });

        it('should handle testResult without analysis gracefully', async () => {
            const testResult = { totalScore: 300 }; // no analysis
            (mockedTestResult.findById as any).mockResolvedValue(testResult);
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });
            mockedLearningPlanAIService.generateLearningRoadmap.mockResolvedValue(
                { totalWeeks: 1 } as any
            );
            (mockedRoadmap.create as any).mockResolvedValue({ _id: 'r1' });

            await roadmapService.generateRoadmap('user1', {
                ...defaultInput,
                testResultId: new Types.ObjectId(),
            } as any);

            expect(
                mockedLearningPlanAIService.generateLearningRoadmap
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    testAnalysis: expect.objectContaining({
                        score: 300,
                        weaknesses: [],
                    }),
                })
            );
        });
    });

    describe('getActiveRoadmap', () => {
        it('should return active roadmap', async () => {
            (mockedRoadmap.findOne as any).mockReturnValue({
                lean: jest.fn().mockReturnValue({
                    exec: jest.fn().mockResolvedValue({ _id: 'r1' }),
                }),
            });
            const result = await roadmapService.getActiveRoadmap('user1');
            expect(result).toEqual({ _id: 'r1' });
        });
    });

    describe('updateRoadmapScheduleFromUserPreferences', () => {
        it('should throw if user preferences missing', async () => {
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
            await expect(
                roadmapService.updateRoadmapScheduleFromUserPreferences(
                    new Types.ObjectId()
                )
            ).rejects.toThrow('User study days preferences not found');
        });

        it('should iterate over active/draft roadmaps and update them', async () => {
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockResolvedValue({
                    preferences: { studyDaysOfWeek: [1, 2] },
                }),
            });

            const roadmap1 = {
                updateDayOfWeekFromUserPreferences: jest.fn(),
                save: jest.fn(),
            };
            const roadmap2 = {
                updateDayOfWeekFromUserPreferences: jest.fn(),
                save: jest.fn(),
            };
            (mockedRoadmap.find as any).mockResolvedValue([roadmap1, roadmap2]);

            await roadmapService.updateRoadmapScheduleFromUserPreferences(
                new Types.ObjectId()
            );

            expect(
                roadmap1.updateDayOfWeekFromUserPreferences
            ).toHaveBeenCalledWith([1, 2]);
            expect(roadmap1.save).toHaveBeenCalled();
            expect(
                roadmap2.updateDayOfWeekFromUserPreferences
            ).toHaveBeenCalledWith([1, 2]);
            expect(roadmap2.save).toHaveBeenCalled();
        });
    });

    describe('checkRoadmapBlocked', () => {
        it('should throw ApiError if roadmap not found', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(null);
            await expect(
                roadmapService.checkRoadmapBlocked('r1')
            ).rejects.toThrow(ApiError);
        });

        it('should return blocked status and focus', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue({
                isBlocked: true,
                blockedDailyFocus: { dayOfWeek: 1 },
                currentWeek: 2,
            });
            const result = await roadmapService.checkRoadmapBlocked('r1');
            expect(result.isBlocked).toBe(true);
            expect(result.blockedDailyFocus?.dayOfWeek).toBe(1);
            expect(result.currentWeek).toBe(2);
        });
    });

    describe('completeDailySession', () => {
        it('should throw ApiError if roadmap not found', async () => {
            (mockedRoadmap.findOne as any).mockResolvedValue(null);
            await expect(
                roadmapService.completeDailySession('r1', 1, 1)
            ).rejects.toThrow(ApiError);
        });

        it('should complete session and unblock', async () => {
            const roadmap: any = {
                completeDailySession: jest.fn(),
                isBlocked: false,
                sessionsCompleted: 1,
                totalSessions: 10,
                save: jest.fn(),
            };
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const result = await roadmapService.completeDailySession(
                'r1',
                1,
                1
            );

            expect(roadmap.completeDailySession).toHaveBeenCalledWith(1, 1);
            expect(roadmap.sessionsCompleted).toBe(2); // 1 + 1
            expect(roadmap.overallProgress).toBe(20); // 2/10 * 100
            expect(
                mockedRoadmapCalibrationService.checkAndProgressWeek
            ).toHaveBeenCalledWith('r1');
            expect(roadmap.save).toHaveBeenCalled();
            expect(result.canProceed).toBe(true);
            expect(result.message).toContain('unblocked');
        });

        it('should handle still blocked scenario', async () => {
            const roadmap: any = {
                completeDailySession: jest.fn(),
                isBlocked: true,
                totalSessions: 0, // fallback to 1
                save: jest.fn(),
            };
            (mockedRoadmap.findOne as any).mockResolvedValue(roadmap);

            const result = await roadmapService.completeDailySession(
                'r1',
                1,
                1
            );
            expect(result.canProceed).toBe(false);
            expect(result.message).toContain('still blocked');
            expect(roadmap.overallProgress).toBe(100); // 1/1 * 100
        });
    });

    describe('updateDailyFocusStatus', () => {
        it('should update successfully', async () => {
            (mockedRoadmap.findOneAndUpdate as any).mockResolvedValue({
                _id: 'r1',
            });
            await roadmapService.updateDailyFocusStatus(
                'r1',
                1,
                2,
                'completed'
            );
            expect(mockedRoadmap.findOneAndUpdate).toHaveBeenCalledWith(
                {
                    roadmapId: 'r1',
                    'weeklyFocuses.weekNumber': 1,
                    'weeklyFocuses.dailyFocuses.dayOfWeek': 2,
                },
                expect.any(Object),
                expect.any(Object)
            );
        });

        it('should throw ApiError if roadmap not found', async () => {
            (mockedRoadmap.findOneAndUpdate as any).mockResolvedValue(null);
            await expect(
                roadmapService.updateDailyFocusStatus('r1', 1, 2, 'completed')
            ).rejects.toThrow(ApiError);
        });
    });
});
