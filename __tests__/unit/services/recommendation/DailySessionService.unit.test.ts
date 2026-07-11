/* eslint-disable @typescript-eslint/no-explicit-any */
import { dailySessionService } from '~/services/recommendation/DailySessionService.js';
import { User } from '~/models/userModel.js';
import { StudyPlan } from '~/models/studyPlanModel.js';
import { Resource } from '~/models/resource.js';
import { roadmapService } from '~/services/recommendation/RoadmapService.js';
import { dailyPlanAIService } from '~/ai/service/dailyPlanAIService.js';
import { studyPlanGeneratorService } from '~/services/recommendation/StudyPlanGeneratorService.js';
import { progressTrackingService } from '~/services/recommendation/ProgressTrackingService.js';
import { roadmapCalibrationService } from '~/services/recommendation/RoadmapCalibrationService.js';
import testService from '~/services/testService.js';

jest.mock('~/models/userModel.js', () => ({
    User: {
        findById: jest.fn(),
    },
}));
jest.mock('~/models/studyPlanModel.js', () => ({
    StudyPlan: {
        findOne: jest.fn(),
        create: jest.fn(),
        deleteOne: jest.fn(),
    },
}));
jest.mock('~/models/resource.js', () => ({
    Resource: {
        find: jest.fn(),
    },
}));
jest.mock('~/services/recommendation/RoadmapService.js', () => ({
    roadmapService: {
        getActiveRoadmap: jest.fn(),
        checkRoadmapBlocked: jest.fn(),
        updateDailyFocusStatus: jest.fn(),
    },
}));
jest.mock('~/ai/service/dailyPlanAIService.js', () => ({
    dailyPlanAIService: {
        generateDailyPlan: jest.fn(),
    },
}));
jest.mock('~/services/recommendation/StudyPlanGeneratorService.js', () => ({
    studyPlanGeneratorService: {
        generateVocabularySet: jest.fn(),
        generatePersonalizedGuide: jest.fn(),
        getTopicKeywords: jest.fn(),
    },
}));
jest.mock('~/services/recommendation/ProgressTrackingService.js', () => ({
    progressTrackingService: {
        completeDailySession: jest.fn(),
        trackResourceView: jest.fn(),
        completePracticeDrill: jest.fn(),
    },
}));
jest.mock('~/services/recommendation/RoadmapCalibrationService.js', () => ({
    roadmapCalibrationService: {
        getSkippedSessionsContent: jest.fn(),
    },
}));
jest.mock('~/services/recommendation/StudyMemoService.js', () => ({
    studyMemoService: {
        getActiveMemoForToday: jest.fn(),
        resolveMaterials: jest.fn(),
        markDayInProgress: jest.fn(),
    },
}));
jest.mock('~/ai/service/materialContentAIService.js', () => ({
    materialContentAIService: {
        extractFromMaterial: jest.fn(),
    },
}));
jest.mock('~/utils/vocabularyDedup.js', () => ({
    getSavedFlashcardTerms: jest.fn().mockResolvedValue([]),
    filterDuplicateVocabulary: jest.fn().mockImplementation((words) => words),
}));
jest.mock('~/services/testService.js', () => ({
    __esModule: true,
    default: {
        findRandomQuestionIds: jest.fn(),
    },
}));

import { studyMemoService } from '~/services/recommendation/StudyMemoService.js';
import { materialContentAIService } from '~/ai/service/materialContentAIService.js';
import { filterDuplicateVocabulary } from '~/utils/vocabularyDedup.js';
import { acquireLock, releaseLock } from '~/utils/requestLock.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

const mockedStudyMemoService = studyMemoService as jest.Mocked<
    typeof studyMemoService
>;
const mockedMaterialContentAIService = materialContentAIService as jest.Mocked<
    typeof materialContentAIService
>;
const mockedFilterDuplicateVocabulary = filterDuplicateVocabulary as jest.Mock;

const mockedUser = User as jest.Mocked<typeof User>;
const mockedStudyPlan = StudyPlan as jest.Mocked<typeof StudyPlan>;
const mockedResource = Resource as jest.Mocked<typeof Resource>;
const mockedRoadmapService = roadmapService as jest.Mocked<
    typeof roadmapService
>;
const mockedDailyPlanAIService = dailyPlanAIService as jest.Mocked<
    typeof dailyPlanAIService
>;
const mockedStudyPlanGeneratorService =
    studyPlanGeneratorService as jest.Mocked<typeof studyPlanGeneratorService>;
const mockedProgressTrackingService = progressTrackingService as jest.Mocked<
    typeof progressTrackingService
>;
const mockedRoadmapCalibrationService =
    roadmapCalibrationService as jest.Mocked<typeof roadmapCalibrationService>;
const mockedTestService = testService as jest.Mocked<typeof testService>;

describe('DailySessionService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('getTodaySession', () => {
        beforeEach(() => {
            mockedStudyPlanGeneratorService.getTopicKeywords.mockReturnValue([
                'topic1',
            ]);
            (mockedResource.find as any) = jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue([]),
            });
        });

        it('should return existing session if found', async () => {
            const mockSession = { _id: 'session1' };
            (mockedStudyPlan.findOne as any) = jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue(mockSession),
            });

            const result = await dailySessionService.getTodaySession('userId');
            expect(result).toEqual(mockSession);
            expect(
                mockedRoadmapService.getActiveRoadmap
            ).not.toHaveBeenCalled();
        });

        function buildMockRoadmap(overrides: any = {}) {
            return {
                roadmapId: 'roadmap-id',
                activeWeekNumber: 1,
                currentLevel: 'B2',
                studyTimePerDay: 45,
                userId: 'userId',
                testResultId: 'testResultId',
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        title: 'Week 1 Focus',
                        summary: 'Summary 1',
                        focusSkills: ['GRAMMAR'],
                        targetWeaknesses: [
                            {
                                skillName: 'w1',
                                skillKey: 'k1',
                                category: 'c1',
                                severity: 'high',
                                userAccuracy: 80,
                            },
                        ],
                        recommendedDomains: ['Business'],
                        mistakes: [
                            {
                                questionId: 'q1',
                                questionText: 'q1',
                                mistakeCount: 1,
                            },
                        ],
                        dailyFocuses: [
                            {
                                dayOfWeek: new Date().getDay(),
                                focus: 'Daily Focus',
                                targetSkills: ['GRAMMAR'],
                                suggestedDomains: ['Business'],
                                estimatedMinutes: 30,
                                status: 'upcoming',
                            },
                        ],
                    },
                ],
                ...overrides,
            };
        }

        it('should return null if no active roadmap found', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                null as any
            );

            const result = await dailySessionService.getTodaySession('userId');
            expect(result).toBeNull();
        });

        it('should return null if active roadmap does not have roadmapId', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue([
                {},
            ] as any);

            const result = await dailySessionService.getTodaySession('userId');
            expect(result).toBeNull();
        });

        it('should handle blocked roadmap (isCritical mode)', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap();
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: true,
                blockedDailyFocus: { dayOfWeek: new Date().getDay() } as any,
                currentWeek: 1,
            });
            mockedRoadmapService.updateDailyFocusStatus.mockResolvedValue();

            const mockUser = {
                competencyProfile: {
                    currentCEFRLevel: 'C1',
                    skillMatrix: [
                        {
                            skill: 'GRAMMAR',
                            currentAccuracy: 50,
                            proficiency: 'weak',
                        },
                        {
                            skill: 'VOCAB',
                            currentAccuracy: 40,
                            proficiency: 'weak',
                        },
                    ],
                },
                preferences: {
                    preferredStudyTime: 'morning',
                    contentInterests: ['Business'],
                },
            };
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(mockUser),
            });

            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                {
                    hasSkippedSessions: false,
                    skippedContent: [],
                }
            );

            const mockAIPlan = {
                reasoning: 'test',
                activities: [],
            };
            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue(
                mockAIPlan as any
            );
            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            const result = await dailySessionService.getTodaySession('userId');
            expect(result).toEqual({ _id: 'new-session' });
            expect(
                mockedRoadmapService.updateDailyFocusStatus
            ).toHaveBeenCalledWith(
                'roadmap-id',
                1,
                new Date().getDay(),
                'in-progress'
            );

            const createCall = (mockedStudyPlan.create as jest.Mock).mock
                .calls[0][0];
            expect(createCall.title).toContain('CRITICAL:');
        });

        it('should return null if blocked week or daily focus is not found', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap({ weeklyFocuses: [] });
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: true,
                blockedDailyFocus: { dayOfWeek: 99 } as any, // non-existent
                currentWeek: 1,
            });

            const result = await dailySessionService.getTodaySession('userId');
            expect(result).toBeNull();
        });

        it('should return null if blocked week is found but daily focus is not found', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap({
                weeklyFocuses: [{ weekNumber: 1, dailyFocuses: [] }],
            });
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: true,
                blockedDailyFocus: { dayOfWeek: 99 } as any,
                currentWeek: 1,
            });

            const result = await dailySessionService.getTodaySession('userId');
            expect(result).toBeNull();
        });

        it('should hit !targetDailyFocus when blockedWeek is found but targetDailyFocus is not', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap();

            const fakeWeek = { weekNumber: 1 };
            Object.defineProperty(fakeWeek, 'dailyFocuses', {
                get: jest
                    .fn()
                    .mockReturnValueOnce([{ dayOfWeek: 99 }]) // For some()
                    .mockReturnValueOnce([]), // For find(), so targetDailyFocus is undefined
            });

            mockRoadmap.weeklyFocuses = [fakeWeek];
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: true,
                blockedDailyFocus: { dayOfWeek: 99 } as any,
                currentWeek: 1,
            });

            const result = await dailySessionService.getTodaySession('userId');
            expect(result).toBeNull();
        });

        it('should hit !weekFocus at line 187 when weekFocus is found first but not later', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap();

            const fakeWeek = {
                weekNumber: 1,
                dailyFocuses: [{ dayOfWeek: 99 }],
            };
            Object.defineProperty(mockRoadmap, 'weeklyFocuses', {
                get: jest
                    .fn()
                    .mockReturnValueOnce([fakeWeek]) // For blockedWeek find()
                    .mockReturnValueOnce([]), // For weekFocus find() later
            });

            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: true,
                blockedDailyFocus: { dayOfWeek: 99 } as any,
                currentWeek: 1,
            });

            const result = await dailySessionService.getTodaySession('userId');
            expect(result).toBeNull();
        });

        it('should return null if no weekly focus found for unblocked current week (missing active week)', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap({
                activeWeekNumber: 0,
                weeklyFocuses: [{ weekNumber: 2 }],
            }); // activeWeek is 0 to cover || 1 fallback
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });

            const result = await dailySessionService.getTodaySession('userId');
            expect(result).toBeNull();
        });

        it('should not update status if targetDailyFocus is completed or skipped', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap();
            mockRoadmap.weeklyFocuses[0].dailyFocuses[0].status = 'completed'; // status === 'completed'
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                { hasSkippedSessions: false, skippedContent: [] } as any
            );
            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue({
                activities: [],
            } as any);
            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            await dailySessionService.getTodaySession('userId');
            expect(
                mockedRoadmapService.updateDailyFocusStatus
            ).not.toHaveBeenCalled();

            // Test skipped
            mockRoadmap.weeklyFocuses[0].dailyFocuses[0].status = 'skipped';
            await dailySessionService.getTodaySession('userId');
            expect(
                mockedRoadmapService.updateDailyFocusStatus
            ).not.toHaveBeenCalled();
        });

        it('should generate session for unblocked roadmap with no scheduled daily focus today and no user profile', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const todayDayOfWeek = new Date().getDay();
            const mockRoadmap = buildMockRoadmap({
                currentLevel: undefined, // cover singleRoadmap.currentLevel || 'B1'
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        title: 'Week 1 Focus',
                        summary: 'Summary 1',
                        dailyFocuses: [
                            {
                                dayOfWeek: (todayDayOfWeek + 1) % 7,
                                focus: 'Future focus',
                            }, // not today
                        ],
                    },
                ],
            });
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });

            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                {
                    hasSkippedSessions: true,
                    skippedContent: [
                        {
                            focus: 'missed',
                            targetSkills: [],
                            suggestedDomains: [],
                        },
                    ] as any,
                }
            );

            const mockAIPlan = { activities: [] };
            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue(
                mockAIPlan as any
            );
            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            const result = await dailySessionService.getTodaySession('userId');
            expect(result).toEqual({ _id: 'new-session' });

            const createCall = (mockedStudyPlan.create as jest.Mock).mock
                .calls[0][0];
            expect(createCall.title).toContain('Practice + Catch-up Review');
        });

        it('should handle unblocked roadmap with no scheduled daily focus today and no skipped sessions', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const todayDayOfWeek = new Date().getDay();
            const mockRoadmap = buildMockRoadmap({
                studyTimePerDay: undefined, // cover || 30
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        title: 'W1',
                        summary: 'S1',
                        dailyFocuses: [
                            {
                                dayOfWeek: (todayDayOfWeek + 1) % 7,
                                focus: 'Future',
                            },
                        ],
                    },
                ],
            });
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                { hasSkippedSessions: false, skippedContent: [] } as any
            );
            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue({
                activities: [],
            } as any);
            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            await dailySessionService.getTodaySession('userId');

            const createCall = (mockedStudyPlan.create as jest.Mock).mock
                .calls[0][0];
            expect(createCall.title).toBe('W1 Practice'); // hits hasSkippedSessions = false branch
        });

        it('should process AI plan activities successfully (all types)', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap();
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });
            mockedRoadmapService.updateDailyFocusStatus.mockResolvedValue();

            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                {
                    hasSkippedSessions: false,
                    skippedContent: [],
                }
            );

            // Mock DB Resource finding
            const mockDBResource = {
                _id: 'res1',
                type: 'video',
                title: 'Video 1',
                labels: { domain: 'Business', topic: ['Grammar'] },
            };
            const mockDBResource2 = {
                _id: 'res2',
                type: 'article',
                title: 'Article 1',
            };
            (mockedResource.find as any) = jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnThis(),
                lean: jest
                    .fn()
                    .mockResolvedValue([mockDBResource, mockDBResource2]),
            });

            const mockAIPlan = {
                activities: [
                    {
                        activityType: 'learn',
                        title: 'Learn',
                        useDBResource: true,
                        // missing dbResourceIndex to hit fallback
                        generateVocabularySet: true,
                        targetWeakness: {
                            skillName: 'Vocab',
                            skillKey: 'V1',
                            severity: 'high',
                        },
                    },
                    {
                        activityType: 'learn',
                        useDBResource: true,
                        dbResourceIndex: 1, // hit article branch for line 336
                        targetWeakness: {
                            skillName: 'Vocab',
                            skillKey: 'V1',
                            severity: 'high',
                        },
                    },
                    {
                        activityType: 'learn',
                        useDBResource: true,
                        dbResourceIndex: 0, // valid resource! hits 334-335
                        targetWeakness: {
                            skillName: 'Grammar',
                            skillKey: 'G1',
                            severity: 'high',
                        },
                    },
                    {
                        activityType: 'invalid_type', // should fallback to learn
                        generatePersonalizedGuide: true,
                        targetWeakness: {
                            skillName: 'Grammar',
                            skillKey: 'G1',
                            severity: 'high',
                        },
                    },
                    {
                        activityType: 'learn',
                        generatePersonalizedGuide: true, // second guide to hit truthy branch
                        targetWeakness: {
                            skillName: 'Vocab',
                            skillKey: 'V2',
                            severity: 'medium',
                        },
                    },
                    {
                        activityType: 'practice',
                        generatePracticeDrill: true,
                        // practiceQuestionIds missing to test || []
                        skillsToImprove: ['Grammar'],
                        targetPracticeSkills: ['Grammar'], // trigger RandomQuestionIds finding
                        // estimatedTime missing to test fallback (line 429)
                    },
                    {
                        activityType: 'drill',
                        generatePracticeDrill: true,
                        practiceQuestionIds: ['q1'], // line 394: if (questionIds.length === 0) false branch
                        // No skills but has domain, should trigger finding
                    },
                    {
                        activityType: 'drill',
                        generatePracticeDrill: true,
                        practiceQuestionIds: [],
                        targetPracticeDomains: ['Business'], // lines 414-415 trigger criteria.domains length > 0
                        estimatedTime: 20, // hit line 429 true branch
                    },
                    {
                        activityType: 'drill',
                        generatePracticeDrill: true,
                        practiceQuestionIds: [],
                        // No skills or domains, hits line 423
                    },
                    {
                        activityType: 'learn',
                        useDBResource: true,
                        dbResourceIndex: 99, // out of bounds to hit undefined resource (line 333)
                        targetWeakness: {
                            skillName: 'Vocab',
                            skillKey: 'V1',
                            severity: 'high',
                        },
                    },
                ],
            };
            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue(
                mockAIPlan as any
            );
            // mock one to return undefined to hit `if (vocabSet)` and `if (guide)` failure branches
            mockedStudyPlanGeneratorService.generateVocabularySet
                .mockResolvedValueOnce({ title: 'Vocab Set' } as any)
                .mockResolvedValueOnce(undefined as any);
            mockedStudyPlanGeneratorService.generatePersonalizedGuide
                .mockResolvedValueOnce(undefined as any) // first call returns undefined
                .mockResolvedValueOnce({ title: 'Guide Set' } as any); // second call returns valid guide
            mockedTestService.findRandomQuestionIds.mockResolvedValue([
                'q3',
                'q4',
            ]);

            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            await dailySessionService.getTodaySession('userId');

            const createCall = (mockedStudyPlan.create as jest.Mock).mock
                .calls[0][0];
            expect(createCall.planItems.length).toBe(10);

            // Check dbResourceIndex missing fallback
            expect(createCall.planItems[0].resources.length).toBe(1); // vocab set
            // Check vocab mapping undefined fallback
            expect(createCall.planItems[1].resources[0].type).toBe('article'); // dbResourceIndex: 1
            // Check dbResource valid
            expect(createCall.planItems[2].resources[0].title).toBe('Video 1');
            // Check guide mapping undefined fallback
            expect(createCall.planItems[3].resources.length).toBe(0);
            // Check guide mapping valid
            expect(createCall.planItems[4].resources[0].title).toBe(
                'Guide Set'
            );
            // Check practice drill undefined fields fallback
            expect(
                createCall.planItems[5].practiceDrills[0].practiceQuestionIds
            ).toEqual(['q3', 'q4']);
            expect(
                createCall.planItems[5].practiceDrills[0].estimatedTime
            ).toBe(15);
            // Check practiceQuestionIds provided
            expect(
                createCall.planItems[6].practiceDrills[0].practiceQuestionIds
            ).toEqual(['q1']);
        });

        it('should handle targetDailyFocus without targetSkills and suggestedDomains', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap();
            delete mockRoadmap.weeklyFocuses[0].dailyFocuses[0].targetSkills;
            delete mockRoadmap.weeklyFocuses[0].dailyFocuses[0]
                .suggestedDomains;

            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                { hasSkippedSessions: false, skippedContent: [] } as any
            );
            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue({
                activities: [],
            } as any);
            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            await dailySessionService.getTodaySession('userId');
            const createCall = (mockedStudyPlan.create as jest.Mock).mock
                .calls[0][0];
            expect(createCall.targetSkills).toEqual([]); // fallback to []
        });

        it('should handle scheduled session today with skipped content (lines 536-539)', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap();
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });

            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                {
                    hasSkippedSessions: true,
                    skippedContent: [
                        {
                            focus: 'missed',
                            targetSkills: [],
                            suggestedDomains: [],
                        },
                    ] as any,
                }
            );
            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue({
                activities: [],
            } as any);
            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            await dailySessionService.getTodaySession('userId');

            const createCall = (mockedStudyPlan.create as jest.Mock).mock
                .calls[0][0];
            expect(createCall.title).toContain('+ Catch-up Review');
            expect(createCall.description).toContain('skipped session(s)');
        });

        it('should hit line 358 fallback weakDomains by not having targetDailyFocus', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const todayDayOfWeek = new Date().getDay();
            const mockRoadmap = buildMockRoadmap({
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        title: 'Week 1 Focus',
                        summary: 'Summary 1',
                        dailyFocuses: [
                            {
                                dayOfWeek: (todayDayOfWeek + 1) % 7,
                                focus: 'Future focus',
                            }, // not today -> targetDailyFocus is undefined
                        ],
                    },
                ],
            });
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                { hasSkippedSessions: false, skippedContent: [] } as any
            );

            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue({
                activities: [{ generateVocabularySet: true }],
            } as any);
            mockedStudyPlanGeneratorService.generateVocabularySet.mockResolvedValue(
                { title: 'Vocab Set' } as any
            );
            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            await dailySessionService.getTodaySession('userId');

            // Should call generateVocabularySet with fallback domains
            expect(
                mockedStudyPlanGeneratorService.generateVocabularySet
            ).toHaveBeenCalled();
        });

        it('should use singleRoadmap when getActiveRoadmap returns array', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap();
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue([
                mockRoadmap,
            ] as any);
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });

            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                { hasSkippedSessions: false, skippedContent: [] } as any
            );
            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue({
                activities: [],
            } as any);
            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            const result = await dailySessionService.getTodaySession('userId');
            expect(result).toEqual({ _id: 'new-session' });
        });

        it('should handle memoMatch and create content-grounded lesson and link-only resources', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap();
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });

            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue({
                    competencyProfile: {
                        currentCEFRLevel: 'B2',
                        skillMatrix: [],
                        aiInsights: [
                            { title: 'insight 1', description: 'desc 1' },
                        ],
                    },
                    preferences: {},
                }),
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                { hasSkippedSessions: false, skippedContent: [] } as any
            );

            mockedStudyMemoService.getActiveMemoForToday.mockReturnValue({
                memo: {
                    _id: 'memoId',
                    materials: [
                        { refType: 'file', refId: 'file1' },
                        { refType: 'resource', refId: 'res1' },
                    ],
                    note: 'note 1',
                },
                dayItem: { _id: 'dayId', focus: 'Test focus' },
            } as any);

            mockedStudyMemoService.resolveMaterials.mockResolvedValue([
                {
                    refId: 'file1',
                    resourceType: 'article',
                    title: 'Title 1',
                    description: 'Desc 1',
                    url: 'url 1',
                    labels: { domain: 'Business' },
                    domains: ['Business'],
                    content:
                        'This is a long enough content to pass the hasUsableText check. '.repeat(
                            10
                        ),
                },
                {
                    refId: 'res1',
                    resourceType: 'video',
                    title: 'Title 2',
                    description: 'Desc 2',
                    url: 'url 2',
                    content: '', // empty content, so it becomes linkOnlyMaterial
                },
            ] as any);

            mockedStudyMemoService.markDayInProgress.mockResolvedValue(
                undefined
            );

            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue({
                activities: [
                    {
                        activityType: 'learn',
                        title: 'Learn AI',
                        interactiveActivities: [
                            { kind: 'writing', brief: 'Write something' },
                            { kind: 'invalid', brief: '' }, // should skip due to missing brief or kind
                        ],
                    },
                ],
            } as any);

            mockedFilterDuplicateVocabulary.mockReturnValue([{ word: 'test' }]);
            mockedMaterialContentAIService.extractFromMaterial.mockResolvedValue(
                {
                    grammarGuide: {
                        title: 'Grammar Guide',
                        sections: [{ title: 'section', content: 'content' }],
                        quickTips: ['tip'],
                    },
                    vocabulary: {
                        title: 'Vocab',
                        description: 'Desc',
                        words: [{ word: 'test' }],
                    },
                } as any
            );

            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            const result = await dailySessionService.getTodaySession('userId');
            expect(result).toEqual({ _id: 'new-session' });

            const createCall = (mockedStudyPlan.create as jest.Mock).mock
                .calls[0][0];

            // Should prepend memo items
            expect(createCall.planItems[0].title).toBe(
                'Study your material: Title 1'
            );
            expect(createCall.planItems[0].activityType).toBe('learn');
            expect(createCall.planItems[0].resources.length).toBe(3); // article, grammar guide, vocab set

            // interactive activities
            expect(createCall.planItems[1].resources.length).toBe(1); // the writing activity
            expect(createCall.planItems[1].resources[0].type).toBe('activity');
        });

        it('should handle memoMatch with ONLY content materials (linkOnlyMaterials.length === 0)', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                buildMockRoadmap() as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue({
                    competencyProfile: {
                        currentCEFRLevel: 'B2',
                        aiInsights: [],
                    },
                }),
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                { hasSkippedSessions: false, skippedContent: [] } as any
            );
            mockedStudyMemoService.getActiveMemoForToday.mockReturnValue({
                memo: {
                    materials: [{ refType: 'file', refId: 'file1' }],
                    note: '',
                },
                dayItem: { focus: 'focus' },
            } as any);
            mockedStudyMemoService.resolveMaterials.mockResolvedValue([
                {
                    refId: 'file1',
                    resourceType: 'article',
                    title: 'T1',
                    domains: [],
                    content:
                        'This is a long enough content to pass the hasUsableText check. '.repeat(
                            10
                        ),
                },
            ] as any);
            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue({
                activities: [],
            } as any);
            mockedMaterialContentAIService.extractFromMaterial.mockResolvedValue(
                {
                    grammarGuide: { sections: [], title: 'Title' },
                    vocabulary: {
                        words: [],
                        title: 'Vocab',
                        description: 'desc',
                    },
                    comprehensionQuestions: [],
                } as any
            );
            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            await dailySessionService.getTodaySession('userId');
            expect(mockedStudyPlan.create).toHaveBeenCalled();
        });

        it('should handle memoMatch with ONLY link materials (memoContentMaterials.length === 0) and cover weakDomains map fallback', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                buildMockRoadmap() as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue({
                    competencyProfile: {
                        currentCEFRLevel: 'B2',
                        domainProficiency: [
                            { domain: 'Tech' },
                            { domain: 'Business', accuracy: 50 },
                        ], // testing map fallback
                    },
                }),
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                { hasSkippedSessions: false, skippedContent: [] } as any
            );
            mockedStudyMemoService.getActiveMemoForToday.mockReturnValue({
                memo: {
                    materials: [{ refType: 'resource', refId: 'res1' }],
                    note: '',
                },
                dayItem: { focus: 'focus' },
            } as any);
            mockedStudyMemoService.resolveMaterials.mockResolvedValue([
                {
                    refId: 'res1',
                    resourceType: 'video',
                    title: 'T2',
                    domains: [],
                    content: '',
                },
            ] as any);
            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue({
                activities: [],
            } as any);
            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            await dailySessionService.getTodaySession('userId');
            expect(mockedStudyPlan.create).toHaveBeenCalled();
        });

        it('should handle memoMatch and cover falsy branches for interactive activities and content extraction', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap({
                currentLevel: undefined, // line 600 falsy
                studyTimePerDay: undefined, // line 700 falsy
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        targetWeaknesses: [
                            {
                                skillName: 'w1',
                                skillKey: 'k1',
                                category: 'c1',
                                severity: 'high',
                                userAccuracy: undefined,
                            },
                        ], // line 610 falsy
                        focusSkills: undefined, // line 685 falsy
                        dailyFocuses: [
                            {
                                dayOfWeek: new Date().getDay(),
                                focus: 'Daily Focus',
                                targetSkills: undefined, // line 685 falsy
                            },
                        ],
                    },
                ],
            });
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null), // user is null, covers lines 599, 615 falsy
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                { hasSkippedSessions: false, skippedContent: [] } as any
            );

            mockedStudyMemoService.getActiveMemoForToday.mockReturnValue({
                memo: {
                    materials: [{ refType: 'file', refId: 'file1' }],
                },
                dayItem: { focus: undefined }, // line 602, 697, 750 falsy
            } as any);

            mockedStudyMemoService.resolveMaterials.mockResolvedValue([
                {
                    refId: 'file1',
                    resourceType: 'article',
                    title: 'Title 1',
                    content:
                        'This is a long enough content to pass the hasUsableText check. '.repeat(
                            10
                        ), // needs valid content to enter the loop
                },
                {
                    refId: 'file2',
                    resourceType: 'video',
                    title: 'Title 2',
                    content:
                        'This is a long enough content to pass the hasUsableText check. '.repeat(
                            10
                        ),
                },
            ] as any);

            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue({
                activities: [
                    {
                        activityType: 'learn',
                        interactiveActivities: [
                            { kind: 'unknown_kind', brief: 'brief' }, // line 643 fallback to 'Practice'
                        ],
                    },
                ],
            } as any);

            mockedFilterDuplicateVocabulary.mockReturnValue([]); // line 735 uniqueWords.length === 0

            mockedMaterialContentAIService.extractFromMaterial.mockResolvedValue(
                {
                    grammarGuide: { sections: [] },
                    vocabulary: { words: [] },
                } as any
            );

            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            await dailySessionService.getTodaySession('userId');

            const createCall = (mockedStudyPlan.create as jest.Mock).mock
                .calls[0][0];
            expect(createCall).toBeDefined();

            const learnActivity = createCall.planItems.find(
                (p: any) =>
                    p.activityType === 'learn' &&
                    p.resources.some((r: any) => r.type === 'activity')
            );
            expect(learnActivity.resources[0].title).toBe('Practice exercise');
        });

        it('should handle targetWeaknesses undefined', async () => {
            (mockedStudyPlan.findOne as any) = jest
                .fn()
                .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
            const mockRoadmap = buildMockRoadmap({
                weeklyFocuses: [
                    {
                        weekNumber: 1,
                        targetWeaknesses: undefined, // line 605 falsy
                        dailyFocuses: [{ dayOfWeek: new Date().getDay() }],
                    },
                ],
            });
            mockedRoadmapService.getActiveRoadmap.mockResolvedValue(
                mockRoadmap as any
            );
            mockedRoadmapService.checkRoadmapBlocked.mockResolvedValue({
                isBlocked: false,
            });
            (mockedUser.findById as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });
            mockedRoadmapCalibrationService.getSkippedSessionsContent.mockResolvedValue(
                { hasSkippedSessions: false, skippedContent: [] } as any
            );

            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue({
                activities: [
                    {
                        activityType: 'learn',
                        interactiveActivities: [
                            { kind: 'writing', brief: 'b' },
                        ],
                    },
                ],
            } as any);
            (mockedStudyPlan.create as any) = jest
                .fn()
                .mockResolvedValue({ _id: 'new-session' });

            await dailySessionService.getTodaySession('userId');
            expect(mockedStudyPlan.create).toHaveBeenCalled();
        });

        it('should throw ApiError if lock cannot be acquired', async () => {
            const userId = 'userId-lock-fail';
            const lockKey = `daily-session:${userId}`;
            acquireLock(lockKey);
            try {
                await expect(
                    dailySessionService.getTodaySession(userId)
                ).rejects.toThrow(
                    new ApiError(
                        ErrorMessage.DAILY_SESSION_GENERATION_IN_PROGRESS
                    )
                );
            } finally {
                releaseLock(lockKey);
            }
        });
    });

    describe('regenerateTodaySession', () => {
        it('should delete existing and get new', async () => {
            (mockedStudyPlan.deleteOne as any) = jest
                .fn()
                .mockResolvedValue(true);
            jest.spyOn(
                dailySessionService,
                'getTodaySession'
            ).mockResolvedValue({ _id: 'regenerated' } as any);

            const result =
                await dailySessionService.regenerateTodaySession('userId');
            expect(result).toEqual({ _id: 'regenerated' });
            expect(mockedStudyPlan.deleteOne).toHaveBeenCalled();
        });
    });

    describe('completeDailySession', () => {
        it('should delegate to progressTrackingService', async () => {
            mockedProgressTrackingService.completeDailySession.mockResolvedValue(
                { success: true } as any
            );
            const result = await dailySessionService.completeDailySession(
                'userId',
                'sessionId'
            );
            expect(result.success).toBe(true);
        });
    });

    describe('trackResourceView', () => {
        it('should delegate to progressTrackingService', async () => {
            mockedProgressTrackingService.trackResourceView.mockResolvedValue({
                _id: 'tracked',
            } as any);
            const result = await dailySessionService.trackResourceView(
                'session',
                'item',
                'res',
                10
            );
            expect(result._id).toBe('tracked');
        });
    });

    describe('completePracticeDrill', () => {
        it('should delegate to progressTrackingService', async () => {
            mockedProgressTrackingService.completePracticeDrill.mockResolvedValue(
                { _id: 'completed' } as any
            );
            const result =
                await dailySessionService.completePracticeDrill('session');
            expect(result._id).toBe('completed');
        });
    });

    describe('buildSessionPlan direct coverage for simContext and dryRun', () => {
        it('should use simContext and bypass markDayInProgress when dryRun is true', async () => {
            const mockAIPlan = { activities: [] };
            mockedDailyPlanAIService.generateDailyPlan.mockResolvedValue(
                mockAIPlan as any
            );
            mockedStudyMemoService.getActiveMemoForToday.mockReturnValue({
                memo: {
                    _id: 'memoId',
                    materials: [{ refType: 'file', refId: 'refId' }],
                },
                dayItem: { _id: 'dayId', focus: 'Test focus' },
            } as any);
            mockedStudyMemoService.resolveMaterials.mockResolvedValue([
                {
                    refId: 'refId',
                    resourceType: 'article',
                    title: 'A',
                    description: 'B',
                    url: 'C',
                    labels: {},
                    content:
                        '<p>Some long text to bypass hasUsableText '.repeat(5) +
                        '</p>',
                },
            ] as any);

            const result = await dailySessionService.buildSessionPlan(
                {
                    userId: 'userId',
                    singleRoadmap: { roadmapId: 'roadmapId' } as any,
                    roadmapStatus: { isBlocked: false },
                    targetWeekNumber: 1,
                    targetDailyFocus: {
                        focus: 'Test',
                        targetSkills: [],
                        suggestedDomains: [],
                    } as any,
                    weekFocus: {
                        title: 'W',
                        focusSkills: [],
                        recommendedDomains: [],
                    } as any,
                    today: new Date(),
                    simContext: {
                        user: { competencyProfile: { skillMatrix: [] } } as any,
                        availableResources: [],
                        skippedContent: {
                            hasSkippedSessions: false,
                            skippedContent: [],
                        },
                    },
                },
                true
            ); // dryRun = true

            expect(mockedUser.findById).not.toHaveBeenCalled();
            expect(
                mockedRoadmapCalibrationService.getSkippedSessionsContent
            ).not.toHaveBeenCalled();
            expect(
                mockedStudyMemoService.markDayInProgress
            ).not.toHaveBeenCalled();
            expect(result).toBeDefined();
        });
    });
});
