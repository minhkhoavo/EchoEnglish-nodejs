/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { studyMemoService } from '~/services/recommendation/StudyMemoService.js';
import { Roadmap } from '~/models/roadmapModel.js';
import { Resource } from '~/models/resource.js';
import { User } from '~/models/userModel.js';
import { memoAnalysisAIService } from '~/ai/service/memoAnalysisAIService.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { Types } from 'mongoose';

jest.mock('~/models/roadmapModel.js', () => ({
    Roadmap: {
        findOne: jest.fn(),
        updateOne: jest.fn(),
    },
}));

jest.mock('~/models/resource.js', () => ({
    Resource: {
        findById: jest.fn(),
    },
}));

jest.mock('~/models/userModel.js', () => ({
    User: {
        findById: jest.fn(),
    },
}));

jest.mock('~/ai/service/memoAnalysisAIService.js', () => ({
    memoAnalysisAIService: {
        analyzeMemo: jest.fn(),
    },
}));

const mockedRoadmap = Roadmap as jest.Mocked<typeof Roadmap>;
const mockedResource = Resource as jest.Mocked<typeof Resource>;
const mockedUser = User as jest.Mocked<typeof User>;
const mockedMemoAnalysisAIService = memoAnalysisAIService as jest.Mocked<
    typeof memoAnalysisAIService
>;

describe('StudyMemoService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('resolveMaterials', () => {
        it('should resolve resource correctly', async () => {
            const mockResource = {
                _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
                title: 'Test Resource',
                type: 'article',
                url: 'http://test.com',
                summary: 'Summary',
                content: 'Content',
                labels: { domain: 'Business', topic: ['Grammar'], cefr: 'B2' },
            };
            (mockedResource.findById as any).mockReturnValue({
                lean: jest.fn().mockResolvedValue(mockResource),
            });

            const materials = [
                {
                    refType: 'resource' as const,
                    refId: '507f1f77bcf86cd799439011',
                },
            ];
            const result = await studyMemoService.resolveMaterials(materials);

            expect(result.length).toBe(1);
            expect(result[0].title).toBe('Test Resource');
            expect(result[0].cefr).toBe('B2');
        });

        it('should skip if resource not found', async () => {
            (mockedResource.findById as any).mockReturnValue({
                lean: jest.fn().mockResolvedValue(null),
            });

            const materials = [
                {
                    refType: 'resource' as const,
                    refId: '507f1f77bcf86cd799439011',
                },
            ];
            const result = await studyMemoService.resolveMaterials(materials);

            expect(result.length).toBe(0);
        });

        it('should handle resource without labels gracefully', async () => {
            const mockResource = {
                _id: new Types.ObjectId(),
                title: 'No Labels',
                type: 'article',
                url: 'http://test.com',
                summary: 'Summary',
                content: 'Content',
                labels: undefined, // covers line 76 fallback
            };
            (mockedResource.findById as any).mockReturnValue({
                lean: jest.fn().mockResolvedValue(mockResource),
            });

            const result = await studyMemoService.resolveMaterials([
                {
                    refType: 'resource',
                    refId: mockResource._id.toString() as any,
                },
            ]);
            expect(result.length).toBe(1);
            expect(result[0].domains).toEqual([]); // covers labels.domain fallback
            expect(result[0].labels?.topic).toEqual([]); // covers labels.topic fallback
        });
    });

    describe('analyzeMemo', () => {
        it('should throw RESOURCE_NOT_FOUND if no materials resolved', async () => {
            jest.spyOn(studyMemoService, 'resolveMaterials').mockResolvedValue(
                []
            );
            await expect(
                studyMemoService.analyzeMemo('userId', {
                    materials: [],
                    scope: 'date',
                })
            ).rejects.toThrow(new ApiError(ErrorMessage.RESOURCE_NOT_FOUND));
        });

        it('should return analysis correctly with maxDays capped', async () => {
            const resolvedMaterial = {
                refType: 'resource' as const,
                refId: new Types.ObjectId(),
                title: 'T',
                resourceType: 'article',
                domains: ['Business'],
            };
            jest.spyOn(studyMemoService, 'resolveMaterials').mockResolvedValue([
                resolvedMaterial,
            ]);

            (mockedRoadmap.findOne as any).mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue({
                    studyTimePerDay: 40,
                    currentLevel: 'B2',
                }),
            });

            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue({
                    competencyProfile: {
                        currentCEFRLevel: 'C1',
                        skillMatrix: [
                            { skill: 'GRAMMAR', currentAccuracy: 50 },
                            { skill: 'READING', currentAccuracy: 40 }, // to trigger sort
                            { skill: 'VOCAB', currentAccuracy: 100 }, // filtered out (>60)
                        ],
                        domainProficiency: [
                            { domain: 'Tech', accuracy: 40 },
                            { domain: 'Science', accuracy: 30 }, // to trigger sort
                        ],
                        aiInsights: [{ title: 'T', description: 'D' }],
                    },
                }),
            });

            mockedMemoAnalysisAIService.analyzeMemo.mockResolvedValue({
                dayPlan: [{}, {}, {}], // 3 days
                suggestedTotalDays: 3,
                suitability: { isSuitable: true },
            } as any);

            // resolved.length is 1, so maxDays = 2. The dayPlan of 3 should be capped to 2.
            const result = await studyMemoService.analyzeMemo('userId', {
                materials: [],
                scope: 'date',
            });
            expect(result.analysis.dayPlan.length).toBe(2);
            expect(result.analysis.suggestedTotalDays).toBe(2);
            expect(mockedMemoAnalysisAIService.analyzeMemo).toHaveBeenCalled();
        });

        it('should handle null user and roadmap profiles gracefully', async () => {
            const resolvedMaterial = {
                refType: 'resource' as const,
                refId: new Types.ObjectId(),
                title: 'T',
                resourceType: 'article',
                domains: ['Business'],
            };
            jest.spyOn(studyMemoService, 'resolveMaterials').mockResolvedValue([
                resolvedMaterial,
                resolvedMaterial,
            ]);

            (mockedRoadmap.findOne as any).mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });

            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            });

            mockedMemoAnalysisAIService.analyzeMemo.mockResolvedValue({
                dayPlan: [{}],
                suggestedTotalDays: 1,
                suitability: { isSuitable: true },
            } as any);

            // resolved.length is 2, maxDays = 5.
            const result = await studyMemoService.analyzeMemo('userId', {
                materials: [],
                scope: 'date',
            });
            expect(result.analysis.dayPlan.length).toBe(1);
            expect(result.analysis.suggestedTotalDays).toBe(1);
        });

        it('should handle missing fields in competency profile and analysis results', async () => {
            jest.spyOn(studyMemoService, 'resolveMaterials').mockResolvedValue([
                {
                    refType: 'resource' as const,
                    refId: new Types.ObjectId(),
                    title: 'T',
                    resourceType: 'article',
                    domains: [],
                },
            ]);

            (mockedRoadmap.findOne as any).mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue({}),
            });

            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue({
                    competencyProfile: {
                        skillMatrix: [
                            { skill: 'A' }, // currentAccuracy undefined
                            { skill: 'B' },
                        ],
                        domainProficiency: [
                            { domain: 'D1' }, // accuracy undefined
                            { domain: 'D2' },
                        ],
                        aiInsights: undefined, // fallback
                    },
                }),
            });

            mockedMemoAnalysisAIService.analyzeMemo.mockResolvedValue({
                dayPlan: undefined, // covers line 178 Array.isArray(analysis.dayPlan)
                suggestedTotalDays: undefined, // covers line 184 fallback
                suitability: { isSuitable: true },
            } as any);

            const result = await studyMemoService.analyzeMemo('userId', {
                materials: [],
                scope: 'date',
            });
            expect(result.analysis.suggestedTotalDays).toBe(1); // falls back to 1
        });
    });

    describe('confirmMemo', () => {
        it('should throw ROADMAP_NOT_FOUND if roadmap not found', async () => {
            mockedRoadmap.findOne.mockResolvedValue(null);
            await expect(
                studyMemoService.confirmMemo('userId', {
                    materials: [],
                    scope: 'date',
                } as any)
            ).rejects.toThrow(new ApiError(ErrorMessage.ROADMAP_NOT_FOUND));
        });

        it('should throw RESOURCE_NOT_FOUND if no materials resolved', async () => {
            mockedRoadmap.findOne.mockResolvedValue({} as any);
            jest.spyOn(studyMemoService, 'resolveMaterials').mockResolvedValue(
                []
            );
            await expect(
                studyMemoService.confirmMemo('userId', {
                    materials: [],
                    scope: 'date',
                } as any)
            ).rejects.toThrow(new ApiError(ErrorMessage.RESOURCE_NOT_FOUND));
        });

        it('should add memo to roadmap and supplement competency', async () => {
            const roadmapMock = {
                studyMemos: [] as any[],
                save: jest.fn(),
            };
            mockedRoadmap.findOne.mockResolvedValue(roadmapMock as any);
            jest.spyOn(studyMemoService, 'resolveMaterials').mockResolvedValue([
                {
                    refType: 'resource',
                    refId: new Types.ObjectId(),
                    title: 'T',
                    resourceType: 'a',
                    domains: [],
                },
            ]);

            const mockUserSave = jest.fn();
            const mockMarkModified = jest.fn();
            const userMock = {
                competencyProfile: {
                    skillMatrix: [{ skill: 'existing', currentAccuracy: 80 }],
                },
                markModified: mockMarkModified,
                save: mockUserSave,
            };
            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockResolvedValue(userMock),
            });

            const result = await studyMemoService.confirmMemo('userId', {
                materials: [],
                scope: 'date',
                targetDate: '2026-06-27',
                suitability: { isSuitable: true },
                dayPlan: [
                    { order: 2, focus: 'focus 2' },
                    { order: 1, focus: 'focus 1' },
                ],
                supplementedWeaknesses: [
                    {
                        skillKey: 'newSkill',
                        skillName: 'New Skill',
                        severity: 'high',
                    },
                ],
            });

            expect(roadmapMock.studyMemos.length).toBe(1);
            expect(roadmapMock.save).toHaveBeenCalled();
            expect(mockUserSave).toHaveBeenCalled();
            expect(userMock.competencyProfile.skillMatrix.length).toBe(2);
            expect(result).toBeDefined();
            expect(result.scope).toBe('date');
        });

        it('should handle week scope correctly and null user gracefully', async () => {
            const roadmapMock = {
                studyMemos: [] as any[],
                save: jest.fn(),
            };
            mockedRoadmap.findOne.mockResolvedValue(roadmapMock as any);
            jest.spyOn(studyMemoService, 'resolveMaterials').mockResolvedValue([
                {
                    refType: 'resource',
                    refId: new Types.ObjectId(),
                    title: 'T',
                    resourceType: 'a',
                    domains: [],
                },
            ]);

            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockResolvedValue(null), // null user to cover line 269
            });

            const result = await studyMemoService.confirmMemo('userId', {
                materials: [],
                scope: 'week',
                targetWeekNumber: 2,
                suitability: { isSuitable: true },
                dayPlan: [],
                supplementedWeaknesses: undefined, // to cover line 244 false branch
            });

            expect(roadmapMock.studyMemos[0].scope).toBe('week');
        });

        it('should supplement competency with existing skill and different severities', async () => {
            const roadmapMock = {
                studyMemos: [] as any[],
                save: jest.fn(),
            };
            mockedRoadmap.findOne.mockResolvedValue(roadmapMock as any);
            jest.spyOn(studyMemoService, 'resolveMaterials').mockResolvedValue([
                {
                    refType: 'resource',
                    refId: new Types.ObjectId(),
                    title: 'T',
                    resourceType: 'a',
                    domains: [],
                },
            ]);

            const mockUserSave = jest.fn();
            const userMock = {
                competencyProfile: {
                    skillMatrix: [{ skill: 's1', currentAccuracy: 80 }],
                },
                markModified: jest.fn(),
                save: mockUserSave,
            };
            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockResolvedValue(userMock),
            });

            await studyMemoService.confirmMemo('userId', {
                materials: [],
                scope: 'date',
                suitability: { isSuitable: true },
                dayPlan: [],
                supplementedWeaknesses: [
                    { skillKey: 's1', skillName: 's1', severity: 'critical' }, // existing skill
                    {
                        skillKey: 's2',
                        skillName: 's2',
                        severity: 'medium',
                        reason: 'r',
                    }, // new skill, medium
                    { skillKey: 's3', skillName: 's3', severity: 'low' }, // new skill, low
                ],
            });
            expect(mockUserSave).toHaveBeenCalled();
        });

        it('should create competencyProfile if it does not exist', async () => {
            const roadmapMock = {
                studyMemos: [] as any[],
                save: jest.fn(),
            };
            mockedRoadmap.findOne.mockResolvedValue(roadmapMock as any);
            jest.spyOn(studyMemoService, 'resolveMaterials').mockResolvedValue([
                {
                    refType: 'resource',
                    refId: new Types.ObjectId(),
                    title: 'T',
                    resourceType: 'a',
                    domains: [],
                },
            ]);

            const mockUserSave = jest.fn();
            const userMock = {
                // NO competencyProfile
                markModified: jest.fn(),
                save: mockUserSave,
            };
            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockResolvedValue(userMock),
            });

            await studyMemoService.confirmMemo('userId', {
                materials: [],
                scope: 'date',
                suitability: { isSuitable: true },
                dayPlan: [],
                supplementedWeaknesses: [
                    { skillKey: 's1', skillName: 's1', severity: 'high' },
                ],
            });
            expect(mockUserSave).toHaveBeenCalled();
            expect((userMock as any).competencyProfile).toBeDefined();
            expect(
                (userMock as any).competencyProfile.skillMatrix[0].skill
            ).toBe('s1');
        });

        it('should supplement competency with missing severity mapping fallback', async () => {
            const roadmapMock = {
                studyMemos: [] as any[],
                save: jest.fn(),
            };
            mockedRoadmap.findOne.mockResolvedValue(roadmapMock as any);
            jest.spyOn(studyMemoService, 'resolveMaterials').mockResolvedValue([
                {
                    refType: 'resource',
                    refId: new Types.ObjectId(),
                    title: 'T',
                    resourceType: 'a',
                    domains: [],
                },
            ]);

            const mockUserSave = jest.fn();
            const userMock = {
                markModified: jest.fn(),
                save: mockUserSave,
            };
            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockResolvedValue(userMock),
            });

            await studyMemoService.confirmMemo('userId', {
                materials: [],
                scope: 'date',
                suitability: { isSuitable: true },
                dayPlan: [],
                supplementedWeaknesses: [
                    {
                        skillKey: 's1',
                        skillName: 's1',
                        severity: 'unknown_severity' as any,
                    },
                ],
            });
            expect(mockUserSave).toHaveBeenCalled();
            expect(
                (userMock as any).competencyProfile.skillMatrix[0]
                    .currentAccuracy
            ).toBe(50);
        });

        it('should return if user is not found during supplementCompetency', async () => {
            const roadmapMock = {
                studyMemos: [] as any[],
                save: jest.fn(),
            };
            mockedRoadmap.findOne.mockResolvedValue(roadmapMock as any);
            jest.spyOn(studyMemoService, 'resolveMaterials').mockResolvedValue([
                {
                    refType: 'resource',
                    refId: new Types.ObjectId(),
                    title: 'T',
                    resourceType: 'a',
                    domains: [],
                },
            ]);

            (mockedUser.findById as any).mockReturnValue({
                select: jest.fn().mockResolvedValue(null),
            });

            await studyMemoService.confirmMemo('userId', {
                materials: [],
                scope: 'date',
                suitability: { isSuitable: true },
                dayPlan: [],
                supplementedWeaknesses: [
                    { skillKey: 's1', skillName: 's1', severity: 'high' },
                ],
            });
            expect(mockedUser.findById).toHaveBeenCalled();
        });
    });

    describe('getActiveMemoForToday', () => {
        const today = new Date('2026-06-27T12:00:00Z');

        it('should return null if no active memos', () => {
            const roadmap = { studyMemos: [{ status: 'completed' }] };
            const result = studyMemoService.getActiveMemoForToday(
                roadmap as any,
                today
            );
            expect(result).toBeNull();
        });

        it('should handle undefined studyMemos gracefully', () => {
            const roadmap = {};
            const result = studyMemoService.getActiveMemoForToday(
                roadmap as any,
                today
            );
            expect(result).toBeNull();
        });

        it('should match date scope correctly and handle missing targetDate', () => {
            const roadmap = {
                studyMemos: [
                    {
                        status: 'active',
                        scope: 'date', // targetDate missing -> false branch
                        dayPlan: [{ status: 'pending' }],
                    },
                    {
                        status: 'active',
                        scope: 'date',
                        targetDate: new Date('2026-06-26T12:00:00Z'), // Past date should match
                        dayPlan: [{ status: 'pending' }],
                    },
                ],
            };
            const result = studyMemoService.getActiveMemoForToday(
                roadmap as any,
                today
            );
            expect(result).not.toBeNull();
            expect(result?.memo.scope).toBe('date');
        });

        it('should not match future date scope', () => {
            const roadmap = {
                studyMemos: [
                    {
                        status: 'active',
                        scope: 'date',
                        targetDate: new Date('2026-06-28T12:00:00Z'), // Future date
                        dayPlan: [{ status: 'pending' }],
                    },
                ],
            };
            const result = studyMemoService.getActiveMemoForToday(
                roadmap as any,
                today
            );
            expect(result).toBeNull();
        });

        it('should match week scope correctly', () => {
            const roadmap = {
                activeWeekNumber: 3,
                studyMemos: [
                    {
                        status: 'active',
                        scope: 'week',
                        targetWeekNumber: 3,
                        dayPlan: [{ status: 'pending' }],
                    },
                ],
            };
            const result = studyMemoService.getActiveMemoForToday(
                roadmap as any,
                today
            );
            expect(result).not.toBeNull();
        });

        it('should return null if dayPlan has no pending/in-progress items', () => {
            const roadmap = {
                activeWeekNumber: 3,
                studyMemos: [
                    {
                        status: 'active',
                        scope: 'week',
                        targetWeekNumber: 3,
                        dayPlan: [{ status: 'done' }],
                    },
                ],
            };
            const result = studyMemoService.getActiveMemoForToday(
                roadmap as any,
                today
            );
            expect(result).toBeNull();
        });

        it('should handle missing activeWeekNumber in roadmap', () => {
            const roadmap = {
                activeWeekNumber: 0,
                studyMemos: [
                    {
                        status: 'active',
                        scope: 'week',
                        targetWeekNumber: 1, // should match fallback 1
                        dayPlan: [{ status: 'pending' }],
                    },
                ],
            };
            const result = studyMemoService.getActiveMemoForToday(
                roadmap as any,
                today
            );
            expect(result).not.toBeNull();
        });
    });

    describe('markDayInProgress', () => {
        it('should call Roadmap.updateOne correctly', async () => {
            mockedRoadmap.updateOne.mockResolvedValue({} as any);
            await studyMemoService.markDayInProgress(
                'roadmapId',
                new Types.ObjectId(),
                new Types.ObjectId()
            );
            expect(mockedRoadmap.updateOne).toHaveBeenCalled();
        });
    });

    describe('markActiveMemoDayDone', () => {
        it('should mark in-progress day as done and update memo status if all done', async () => {
            const roadmapMock = {
                studyMemos: [
                    {
                        status: 'active',
                        dayPlan: [
                            { status: 'done' },
                            { status: 'in-progress' },
                        ],
                    },
                    {
                        status: 'active',
                        dayPlan: [
                            { status: 'done' },
                            { status: 'pending' }, // no in-progress, shouldn't change
                        ],
                    },
                    {
                        status: 'completed', // skip
                        dayPlan: [],
                    },
                ],
                markModified: jest.fn(),
                save: jest.fn(),
            };
            mockedRoadmap.findOne.mockResolvedValue(roadmapMock as any);

            await studyMemoService.markActiveMemoDayDone('userId');

            expect(roadmapMock.studyMemos[0].dayPlan[1].status).toBe('done');
            expect(roadmapMock.studyMemos[0].status).toBe('completed');
            expect(roadmapMock.studyMemos[1].dayPlan[1].status).toBe('pending'); // unchanged
            expect(roadmapMock.save).toHaveBeenCalled();
        });

        it('should do nothing if no roadmap or memos', async () => {
            mockedRoadmap.findOne.mockResolvedValue(null);
            await studyMemoService.markActiveMemoDayDone('userId');
            // no exception
        });

        it('should do nothing if no changes were made to memos', async () => {
            const roadmapMock = {
                studyMemos: [
                    {
                        status: 'active',
                        dayPlan: [{ status: 'pending' }],
                    },
                ],
                markModified: jest.fn(),
                save: jest.fn(),
            };
            mockedRoadmap.findOne.mockResolvedValue(roadmapMock as any);

            await studyMemoService.markActiveMemoDayDone('userId');

            expect(roadmapMock.markModified).not.toHaveBeenCalled();
            expect(roadmapMock.save).not.toHaveBeenCalled();
        });
    });

    describe('deleteMemo', () => {
        it('should delete memo if matchedCount > 0', async () => {
            mockedRoadmap.updateOne.mockResolvedValue({
                matchedCount: 1,
            } as any);
            await studyMemoService.deleteMemo(
                'userId',
                new Types.ObjectId().toString()
            );
            expect(mockedRoadmap.updateOne).toHaveBeenCalled();
        });

        it('should throw ROADMAP_NOT_FOUND if matchedCount === 0', async () => {
            mockedRoadmap.updateOne.mockResolvedValue({
                matchedCount: 0,
            } as any);
            await expect(
                studyMemoService.deleteMemo(
                    'userId',
                    new Types.ObjectId().toString()
                )
            ).rejects.toThrow(new ApiError(ErrorMessage.ROADMAP_NOT_FOUND));
        });
    });
});
