/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { progressTrackingService } from '~/services/recommendation/ProgressTrackingService.js';
import { StudyPlan } from '~/models/studyPlanModel.js';
import { roadmapService } from '~/services/recommendation/RoadmapService.js';

jest.mock('~/models/studyPlanModel.js', () => ({
    StudyPlan: {
        findById: jest.fn(),
    },
}));
jest.mock('~/services/recommendation/RoadmapService.js', () => ({
    roadmapService: {
        getActiveRoadmap: jest.fn(),
        completeDailySession: jest.fn(),
    },
}));
jest.mock('~/services/recommendation/StudyMemoService.js', () => ({
    studyMemoService: {
        markActiveMemoDayDone: jest.fn(),
    },
}));

const mockedStudyPlan = StudyPlan as jest.Mocked<typeof StudyPlan>;
const mockedRoadmapService = roadmapService as jest.Mocked<
    typeof roadmapService
>;
import { studyMemoService } from '~/services/recommendation/StudyMemoService.js';
const mockedStudyMemoService = studyMemoService as jest.Mocked<
    typeof studyMemoService
>;

describe('ProgressTrackingService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('calculatePlanItemProgress', () => {
        it('should handle zero activities', () => {
            const planItem: any = {
                resources: [],
                practiceDrills: [],
                progress: 50,
            };
            progressTrackingService.calculatePlanItemProgress(planItem);
            expect(planItem.progress).toBe(0);
        });

        it('should handle undefined activities arrays', () => {
            const planItem: any = {};
            progressTrackingService.calculatePlanItemProgress(planItem);
            expect(planItem.progress).toBe(0);
        });

        it('should calculate progress based on completed resources and drills', () => {
            const planItem: any = {
                resources: [{ completed: true }, { completed: false }],
                practiceDrills: [{ completed: true }],
                status: 'pending',
            };
            progressTrackingService.calculatePlanItemProgress(planItem);
            expect(planItem.progress).toBe(67); // 2 out of 3 -> 66.6 -> 67
            expect(planItem.status).toBe('in-progress');
            expect(planItem.startedAt).toBeDefined();
        });

        it('should set status to completed if progress is 100', () => {
            const planItem: any = {
                resources: [{ completed: true }],
                practiceDrills: [],
            };
            progressTrackingService.calculatePlanItemProgress(planItem);
            expect(planItem.progress).toBe(100);
            expect(planItem.status).toBe('completed');
            expect(planItem.completedAt).toBeDefined();
        });

        it('should not overwrite startedAt and completedAt if already defined', () => {
            const date1 = new Date('2023-01-01');
            const date2 = new Date('2023-01-02');
            const planItem: any = {
                resources: [{ completed: true }],
                status: 'pending',
                completedAt: date1,
            };
            progressTrackingService.calculatePlanItemProgress(planItem);
            expect(planItem.completedAt).toBe(date1);

            const planItem2: any = {
                resources: [{ completed: false }, { completed: true }],
                status: 'pending',
                startedAt: date2,
            };
            progressTrackingService.calculatePlanItemProgress(planItem2);
            expect(planItem2.startedAt).toBe(date2);
        });
    });

    describe('calculateSessionProgress', () => {
        it('should handle zero items', () => {
            const session: any = { planItems: [], progress: 50 };
            progressTrackingService.calculateSessionProgress(session);
            expect(session.progress).toBe(0);
        });

        it('should calculate progress based on completed planItems', () => {
            const session: any = {
                planItems: [
                    { status: 'completed' },
                    { status: 'pending' },
                    { status: 'in-progress' },
                ],
                status: 'upcoming',
            };
            progressTrackingService.calculateSessionProgress(session);
            expect(session.progress).toBe(33); // 1 out of 3 -> 33
            expect(session.status).toBe('in-progress');
            expect(session.startedAt).toBeDefined();
        });

        it('should set status to completed if progress is 100', () => {
            const session: any = {
                planItems: [{ status: 'completed' }],
            };
            progressTrackingService.calculateSessionProgress(session);
            expect(session.progress).toBe(100);
            expect(session.status).toBe('completed');
            expect(session.completedAt).toBeDefined();
        });

        it('should not overwrite startedAt and completedAt if already defined', () => {
            const date1 = new Date('2023-01-01');
            const date2 = new Date('2023-01-02');
            const session: any = {
                planItems: [{ status: 'completed' }],
                completedAt: date1,
            };
            progressTrackingService.calculateSessionProgress(session);
            expect(session.completedAt).toBe(date1);

            const session2: any = {
                planItems: [{ status: 'completed' }, { status: 'pending' }],
                status: 'upcoming',
                startedAt: date2,
            };
            progressTrackingService.calculateSessionProgress(session2);
            expect(session2.startedAt).toBe(date2);
        });
    });

    describe('updateProgressCascade', () => {
        it('should update plan item and session', () => {
            const planItem: any = { resources: [{ completed: true }] };
            const session: any = { planItems: [planItem] };

            progressTrackingService.updateProgressCascade(session, planItem);

            expect(planItem.progress).toBe(100);
            expect(session.progress).toBe(100);
        });
    });

    describe('autoScanAndUpdateProgress', () => {
        it('should scan all items and update session without autocomplete roadmap', async () => {
            const session: any = {
                planItems: [{ resources: [{ completed: true }] }],
            };

            await progressTrackingService.autoScanAndUpdateProgress(
                session,
                false
            );

            expect(session.planItems[0].progress).toBe(100);
            expect(session.progress).toBe(100);
            expect(
                mockedRoadmapService.getActiveRoadmap
            ).not.toHaveBeenCalled();
        });

        it('should use default autoCompleteSession=false if not provided', async () => {
            const session: any = {
                planItems: [{ resources: [{ completed: true }] }],
            };

            await progressTrackingService.autoScanAndUpdateProgress(session);

            expect(session.planItems[0].progress).toBe(100);
            expect(session.progress).toBe(100);
            expect(
                mockedRoadmapService.getActiveRoadmap
            ).not.toHaveBeenCalled();
        });

        it('should auto-complete roadmap if enabled and session reached 100%', async () => {
            const session: any = {
                _id: 's1',
                userId: 'u1',
                weekNumber: 1,
                dayNumber: 2,
                status: 'in-progress',
                planItems: [{ resources: [{ completed: true }] }],
            };

            mockedRoadmapService.getActiveRoadmap.mockResolvedValue({
                roadmapId: 'r1',
            } as any);
            mockedRoadmapService.completeDailySession.mockResolvedValue(
                {} as any
            );

            await progressTrackingService.autoScanAndUpdateProgress(
                session,
                true
            );

            expect(session.status).toBe('completed');
            expect(mockedRoadmapService.getActiveRoadmap).toHaveBeenCalledWith(
                'u1'
            );
            expect(
                mockedRoadmapService.completeDailySession
            ).toHaveBeenCalledWith('r1', 1, 2);
        });

        it('should not auto-complete roadmap if already completed', async () => {
            const session: any = {
                status: 'completed',
                planItems: [{ resources: [{ completed: true }] }],
            };
            await progressTrackingService.autoScanAndUpdateProgress(
                session,
                true
            );
            expect(
                mockedRoadmapService.getActiveRoadmap
            ).not.toHaveBeenCalled();
        });

        it('should handle roadmap auto-update errors gracefully', async () => {
            const session: any = {
                _id: 's1',
                userId: 'u1',
                status: 'in-progress',
                planItems: [{ resources: [{ completed: true }] }],
            };

            mockedRoadmapService.getActiveRoadmap.mockRejectedValue(
                new Error('DB Error')
            );

            await progressTrackingService.autoScanAndUpdateProgress(
                session,
                true
            );
            expect(console.error).toHaveBeenCalledWith(
                'Failed to auto-update roadmap when session completed:',
                expect.any(Error)
            );
        });

        it('should handle missing roadmapId in auto-update', async () => {
            const session: any = {
                _id: 's1',
                userId: 'u1',
                status: 'in-progress',
                planItems: [{ resources: [{ completed: true }] }],
            };

            mockedRoadmapService.getActiveRoadmap.mockResolvedValue([
                {},
            ] as any);

            await progressTrackingService.autoScanAndUpdateProgress(
                session,
                true
            );
            expect(
                mockedRoadmapService.completeDailySession
            ).not.toHaveBeenCalled();
        });

        it('should fallback to week 1 day 1 if missing in auto-update', async () => {
            const session: any = {
                _id: 's1',
                userId: 'u1',
                status: 'in-progress',
                planItems: [{ resources: [{ completed: true }] }],
            };
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue({
                roadmapId: 'r1',
            } as any);
            await progressTrackingService.autoScanAndUpdateProgress(
                session,
                true
            );
            expect(
                mockedRoadmapService.completeDailySession
            ).toHaveBeenCalledWith('r1', 1, 1);
        });
    });

    describe('getSessionSummary', () => {
        it('should return correct summary', () => {
            const session: any = {
                progress: 50,
                status: 'in-progress',
                planItems: [
                    {
                        title: 'Item 1',
                        progress: 100,
                        status: 'completed',
                        resources: [{ completed: true }],
                        practiceDrills: [
                            { completed: true },
                            { completed: false },
                        ],
                    },
                    {
                        // missing title, progress, status, resources, practiceDrills
                    },
                ],
            };

            const summary = progressTrackingService.getSessionSummary(session);

            expect(summary.sessionProgress).toBe(50);
            expect(summary.sessionStatus).toBe('in-progress');
            expect(summary.totalPlanItems).toBe(2);
            expect(summary.completedPlanItems).toBe(1);
            expect(summary.planItemsSummary[0].title).toBe('Item 1');
            expect(summary.planItemsSummary[0].totalActivities).toBe(3); // 1 resource + 2 drills
            expect(summary.planItemsSummary[0].completedActivities).toBe(2); // 1 resource + 1 drill
            expect(summary.planItemsSummary[1].title).toBe('Untitled');
            expect(summary.planItemsSummary[1].progress).toBe(0);
            expect(summary.planItemsSummary[1].totalActivities).toBe(0);
            expect(summary.planItemsSummary[1].completedActivities).toBe(0);
        });
    });

    describe('trackResourceView', () => {
        it('should throw if session not found', async () => {
            (mockedStudyPlan.findById as any) = jest
                .fn()
                .mockResolvedValue(null);
            await expect(
                progressTrackingService.trackResourceView('s1', 'i1', 'r1', 10)
            ).rejects.toThrow('SESSION_NOT_FOUND');
        });

        it('should throw if plan item not found', async () => {
            (mockedStudyPlan.findById as any) = jest
                .fn()
                .mockResolvedValue({ planItems: [] });
            await expect(
                progressTrackingService.trackResourceView('s1', 'i1', 'r1', 10)
            ).rejects.toThrow('PLAN_ITEM_NOT_FOUND');
        });

        it('should throw if resource not found', async () => {
            const session: any = {
                planItems: [{ _id: { toString: () => 'i1' }, resources: [] }],
            };
            (mockedStudyPlan.findById as any) = jest
                .fn()
                .mockResolvedValue(session);
            await expect(
                progressTrackingService.trackResourceView('s1', 'i1', 'r1', 10)
            ).rejects.toThrow('RESOURCE_IN_ITEM_NOT_FOUND');
        });

        it('should mark resource as completed if time spent >= threshold', async () => {
            const resource: any = {
                _id: { toString: () => 'r1' },
                completed: false,
            };
            const session: any = {
                planItems: [
                    { _id: { toString: () => 'i1' }, resources: [resource] },
                ],
                save: jest.fn().mockResolvedValue(true),
            };
            (mockedStudyPlan.findById as any) = jest
                .fn()
                .mockResolvedValue(session);

            await progressTrackingService.trackResourceView(
                's1',
                'i1',
                'r1',
                5
            ); // threshold is 5

            expect(resource.completed).toBe(true);
            expect(resource.completedAt).toBeDefined();
            expect(session.totalTimeSpent).toBe(5);
            expect(session.save).toHaveBeenCalled();
        });

        it('should add time spent if already completed or below threshold', async () => {
            const resource: any = {
                _id: { toString: () => 'r1' },
                completed: true,
            }; // already completed
            const session: any = {
                totalTimeSpent: 10,
                planItems: [
                    { _id: { toString: () => 'i1' }, resources: [resource] },
                ],
                save: jest.fn().mockResolvedValue(true),
            };
            (mockedStudyPlan.findById as any) = jest
                .fn()
                .mockResolvedValue(session);

            await progressTrackingService.trackResourceView(
                's1',
                'i1',
                'r1',
                4
            );

            expect(resource.completedAt).toBeUndefined(); // shouldn't overwrite
            expect(session.totalTimeSpent).toBe(14);
            expect(session.save).toHaveBeenCalled();
        });
    });

    describe('completePracticeDrill', () => {
        it('should throw if session not found', async () => {
            (mockedStudyPlan.findById as any) = jest
                .fn()
                .mockResolvedValue(null);
            await expect(
                progressTrackingService.completePracticeDrill('s1')
            ).rejects.toThrow('SESSION_NOT_FOUND');
        });

        it('should mark first practice drill as completed in practice_drill items', async () => {
            const drill: any = { completed: false };
            const session: any = {
                planItems: [
                    { resourceType: 'practice_drill', practiceDrills: [drill] },
                    {
                        resourceType: 'other',
                        practiceDrills: [{ completed: false }],
                    }, // ignored
                ],
                save: jest.fn().mockResolvedValue(true),
            };
            (mockedStudyPlan.findById as any) = jest
                .fn()
                .mockResolvedValue(session);

            await progressTrackingService.completePracticeDrill('s1');

            expect(drill.completed).toBe(true);
            expect(session.save).toHaveBeenCalled();
        });
    });

    describe('completeDailySession', () => {
        it('should throw if session not found', async () => {
            (mockedStudyPlan.findById as any) = jest
                .fn()
                .mockResolvedValue(null);
            await expect(
                progressTrackingService.completeDailySession('u1', 's1')
            ).rejects.toThrow('Session not found');
        });

        it('should handle session completed but no roadmapId', async () => {
            const session: any = { save: jest.fn().mockResolvedValue(true) };
            (mockedStudyPlan.findById as any) = jest
                .fn()
                .mockResolvedValue(session);
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue([
                {},
            ] as any); // no roadmapId

            const result = await progressTrackingService.completeDailySession(
                'u1',
                's1'
            );

            expect(session.status).toBe('completed');
            expect(session.progress).toBe(100);
            expect(result.success).toBe(true);
            expect(result.unblocked).toBe(false);
            expect(result.canProceed).toBe(true);
        });

        it('should handle session completed and delegate to roadmapService (single roadmap)', async () => {
            const session: any = {
                weekNumber: 2,
                dayNumber: 3,
                save: jest.fn().mockResolvedValue(true),
            };
            (mockedStudyPlan.findById as any) = jest
                .fn()
                .mockResolvedValue(session);
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue({
                roadmapId: 'r1',
            } as any);
            mockedRoadmapService.completeDailySession.mockResolvedValue({
                canProceed: true,
            } as any);

            const result = await progressTrackingService.completeDailySession(
                'u1',
                's1'
            );

            expect(
                mockedRoadmapService.completeDailySession
            ).toHaveBeenCalledWith('r1', 2, 3);
            expect(result.unblocked).toBe(true);
            expect(result.message).toContain('unblocked');
        });

        it('should handle fallback week/day in completeDailySession and canProceed false', async () => {
            const session: any = { save: jest.fn().mockResolvedValue(true) };
            (mockedStudyPlan.findById as any) = jest
                .fn()
                .mockResolvedValue(session);
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue([
                { roadmapId: 'r1' },
            ] as any); // array roadmap
            mockedRoadmapService.completeDailySession.mockResolvedValue({
                canProceed: false,
            } as any);

            const result = await progressTrackingService.completeDailySession(
                'u1',
                's1'
            );

            expect(
                mockedRoadmapService.completeDailySession
            ).toHaveBeenCalledWith('r1', 1, 1);
            expect(result.unblocked).toBe(false);
            expect(result.message).toContain('still critical days');
        });
    });
});
