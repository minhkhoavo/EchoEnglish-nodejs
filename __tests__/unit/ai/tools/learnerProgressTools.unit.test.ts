/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.CHROMA_API_KEY = 'test';
process.env.CHROMA_TENANT = 'test';
process.env.CHROMA_DATABASE = 'test';
import { testResultService } from '~/services/testResultService.js';
import { competencyProfileService } from '~/services/recommendation/CompetencyProfileService.js';
import { dailySessionService } from '~/services/recommendation/DailySessionService.js';
import { User } from '~/models/userModel.js';

const getUserStatsSpy = jest
    .spyOn(testResultService, 'getUserStats')
    .mockImplementation();
const getListeningReadingChartDataSpy = jest
    .spyOn(testResultService, 'getListeningReadingChartData')
    .mockImplementation();
const getTestHistorySpy = jest
    .spyOn(testResultService, 'getTestHistory')
    .mockImplementation();

const getWeakSkillsSpy = jest
    .spyOn(competencyProfileService, 'getWeakSkills')
    .mockImplementation();
const getTodaySessionSpy = jest
    .spyOn(dailySessionService, 'getTodaySession')
    .mockImplementation();

const userFindByIdSpy = jest.spyOn(User, 'findById').mockImplementation();

import { learnerProgressTools } from '~/ai/tools/learnerProgressTools.js';

describe('learnerProgressTools', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    const [
        getLearningProgressTool,
        getWeakSkillsTool,
        getTodayLearningPlanTool,
        getTestHistoryTool,
        getUserCreditsTool,
        getCompetencyInsightsTool,
    ] = learnerProgressTools as any[];

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

    describe('getLearningProgressTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(
                getLearningProgressTool.invoke({}, {})
            ).rejects.toThrow('userId required');
        });

        it('should return progress and handle empty tests', async () => {
            getUserStatsSpy.mockResolvedValue({
                listeningReadingTests: 0,
                averageScore: 0,
                highestScore: 0,
                recentTests: [],
            } as any);

            getListeningReadingChartDataSpy.mockResolvedValue({
                timeline: [],
            } as any);

            userFindByIdSpy.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            } as any);

            const result = await getLearningProgressTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );

            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(true);
            expect(parsed.progress.currentLevel).toBe('Not assessed');
            expect(parsed.progress.trend).toBe('stable');
            expect(parsed.message).toBe(
                'You have not taken any tests yet. Start with a practice test to track your progress!'
            );
        });

        it('should return progress with trend improving', async () => {
            getUserStatsSpy.mockResolvedValue({
                listeningReadingTests: 5,
                averageScore: 500,
                highestScore: 600,
                recentTests: [
                    { testTitle: 't1', completedAt: 'date', percentage: 80 },
                ],
            } as any);

            getListeningReadingChartDataSpy.mockResolvedValue({
                timeline: [
                    {
                        date: 'd0',
                        totalScore: 0,
                        listeningScore: 0,
                        readingScore: 0,
                    },
                    {
                        date: 'd1',
                        totalScore: 0,
                        listeningScore: 0,
                        readingScore: 0,
                    },
                    {
                        date: 'd2',
                        totalScore: 550,
                        listeningScore: 275,
                        readingScore: 275,
                    },
                ],
            } as any);

            userFindByIdSpy.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue({
                    competencyProfile: { currentCEFRLevel: 'B1' },
                }),
            } as any);

            const result = await getLearningProgressTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );

            const parsed = JSON.parse(result);
            expect(parsed.progress.currentLevel).toBe('B1');
            expect(parsed.progress.trend).toBe('improving');
            expect(parsed.progress.recentScores).toHaveLength(3);
        });

        it('should return progress with trend stable', async () => {
            getUserStatsSpy.mockResolvedValue({
                listeningReadingTests: 5,
                averageScore: 500,
                highestScore: 600,
                recentTests: [],
            } as any);

            getListeningReadingChartDataSpy.mockResolvedValue({
                timeline: [{ totalScore: 600 }, { totalScore: 600 }],
            } as any);

            userFindByIdSpy.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            } as any);

            const result = await getLearningProgressTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.progress.trend).toBe('stable');
        });

        it('should return trend based on recent scores, handling missing totalScore', async () => {
            getUserStatsSpy.mockResolvedValue({
                listeningReadingTests: 2,
                averageScore: 100,
                highestScore: 150,
                recentTests: [],
            } as any);
            getListeningReadingChartDataSpy.mockResolvedValue({
                timeline: [
                    { date: '1', listeningScore: 50 }, // no totalScore
                    { date: '2', listeningScore: 50 },
                ],
            } as any);
            userFindByIdSpy.mockReturnValue({
                select: () => ({ lean: () => ({}) }),
            } as any);

            const result = await getLearningProgressTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.progress.trend).toBe('stable');
        });

        it('should calculate trend properly', async () => {
            getUserStatsSpy.mockResolvedValue({
                listeningReadingTests: 2,
                averageScore: 100,
                highestScore: 150,
                recentTests: [],
            } as any);
            getListeningReadingChartDataSpy.mockResolvedValue({
                timeline: [
                    { date: '1', totalScore: 500 },
                    { date: '2', totalScore: 530 },
                ],
            } as any);
            userFindByIdSpy.mockReturnValue({
                select: () => ({ lean: () => ({}) }),
            } as any);

            const result = await getLearningProgressTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(JSON.parse(result).progress.trend).toBe('improving');

            getListeningReadingChartDataSpy.mockResolvedValue({
                timeline: [
                    { date: '1', totalScore: 500 },
                    { date: '2', totalScore: 470 },
                ],
            } as any);
            const result2 = await getLearningProgressTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(JSON.parse(result2).progress.trend).toBe('declining');
        });

        it('should return progress with trend declining', async () => {
            getUserStatsSpy.mockResolvedValue({
                listeningReadingTests: 5,
                averageScore: 500,
                highestScore: 600,
                recentTests: [],
            } as any);

            getListeningReadingChartDataSpy.mockResolvedValue({
                timeline: [{ totalScore: 600 }, { totalScore: 550 }],
            } as any);

            userFindByIdSpy.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            } as any);

            const result = await getLearningProgressTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.progress.trend).toBe('declining');
        });

        it('should handle error', async () => {
            getUserStatsSpy.mockRejectedValue(new Error('Failed'));
            const result = await getLearningProgressTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(JSON.parse(result).success).toBe(false);
            expect(JSON.parse(result).error).toBe('Failed');
        });

        it('should handle non-Error instance in catch block', async () => {
            getUserStatsSpy.mockRejectedValue('String Error');
            const result = await getLearningProgressTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(JSON.parse(result).error).toBe('Unknown error');
        });
    });

    describe('getWeakSkillsTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(getWeakSkillsTool.invoke({}, {})).rejects.toThrow(
                'userId required'
            );
        });

        it('should return empty weak skills', async () => {
            getWeakSkillsSpy.mockResolvedValue([]);

            const result = await getWeakSkillsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(true);
            expect(parsed.focusArea).toBe('General Practice');
            expect(parsed.totalWeakSkills).toBe(0);
        });

        it('should return weak skills for Listening (Part 1)', async () => {
            getWeakSkillsSpy.mockResolvedValue([
                {
                    skill: 'identifyActionInProgress',
                    accuracy: 40,
                    proficiency: 'weak',
                },
            ] as any);

            const result = await getWeakSkillsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.focusArea).toBe('Listening');
            expect(parsed.weakSkills[0].recommendedAction).toContain(
                'needs intensive practice'
            );
        });

        it('should return weak skills with different accuracy levels', async () => {
            getWeakSkillsSpy.mockResolvedValue([
                { skill: 'wordForm', accuracy: 40, proficiency: 'weak' },
                {
                    skill: 'verbTenseMood',
                    accuracy: 60,
                    proficiency: 'developing',
                },
            ] as any);

            const result = await getWeakSkillsTool.invoke(
                { limit: 5 },
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.weakSkills[0].recommendedAction).toContain(
                'needs intensive practice'
            );
            expect(parsed.weakSkills[1].recommendedAction).toContain(
                'strengthen this skill'
            );
        });

        it('should return weak skills for Reading (Part 5)', async () => {
            getWeakSkillsSpy.mockResolvedValue([
                { skill: 'wordForm', accuracy: 50, proficiency: 'developing' },
            ] as any);

            const result = await getWeakSkillsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.focusArea).toBe('Reading');
            expect(parsed.weakSkills[0].recommendedAction).toContain(
                'strengthen this skill'
            );
        });

        it('should handle fallback for unknown skill key (accuracy >= 50)', async () => {
            getWeakSkillsSpy.mockResolvedValue([
                {
                    skill: 'unknownSkill',
                    accuracy: 60,
                    proficiency: 'developing',
                },
            ] as any);

            const result = await getWeakSkillsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.weakSkills[0].skillName).toBe('unknownSkill');
            expect(parsed.weakSkills[0].recommendedAction).toContain(
                'unknownSkill'
            );
        });

        it('should handle fallback for unknown skill key with accuracy < 50 (covers L168)', async () => {
            // Covers: `Focus on ${SKILL_NAME_MAP[skill.skill] || skill.skill}` when key not in map
            getWeakSkillsSpy.mockResolvedValue([
                {
                    skill: 'customUnknownSkill',
                    accuracy: 30,
                    proficiency: 'weak',
                },
            ] as any);

            const result = await getWeakSkillsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.weakSkills[0].skillName).toBe('customUnknownSkill');
            expect(parsed.weakSkills[0].recommendedAction).toContain(
                'customUnknownSkill'
            );
            expect(parsed.weakSkills[0].recommendedAction).toContain(
                'needs intensive practice'
            );
        });

        it('should handle error', async () => {
            getWeakSkillsSpy.mockRejectedValue(new Error('Failed'));
            const result = await getWeakSkillsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(JSON.parse(result).success).toBe(false);
        });

        it('should handle non-Error instance in catch block', async () => {
            getWeakSkillsSpy.mockRejectedValue('String Error');
            const result = await getWeakSkillsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(JSON.parse(result).error).toBe('Unknown error');
        });
    });

    describe('getTodayLearningPlanTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(
                getTodayLearningPlanTool.invoke({}, {})
            ).rejects.toThrow('userId required');
        });

        it('should return no active plan', async () => {
            getTodaySessionSpy.mockResolvedValue(null);

            const result = await getTodayLearningPlanTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(true);
            expect(parsed.hasActivePlan).toBe(false);
        });

        it('should return active plan and activities', async () => {
            getTodaySessionSpy.mockResolvedValue({
                title: 'Session',
                description: 'Desc',
                scheduledDate: new Date(),
                totalEstimatedTime: 45,
                status: 'in_progress',
                targetSkills: ['skill1'],
                planItems: undefined,
            } as any);

            const result = await getTodayLearningPlanTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.hasActivePlan).toBe(true);
            expect(parsed.session.progress).toBe(0);
            expect(parsed.session.activities).toEqual([]);
        });

        it('should return 100% progress', async () => {
            getTodaySessionSpy.mockResolvedValue({
                planItems: [{ status: 'completed' }, { status: 'completed' }],
            } as any);

            const result = await getTodayLearningPlanTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.session.progress).toBe(100);
            expect(parsed.message).toContain(
                "completed today's learning session"
            );
        });

        it('should handle error', async () => {
            getTodaySessionSpy.mockRejectedValue(new Error('Failed'));
            const result = await getTodayLearningPlanTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(JSON.parse(result).success).toBe(false);
        });

        it('should handle non-Error instance in catch block', async () => {
            getTodaySessionSpy.mockRejectedValue('String Error');
            const result = await getTodayLearningPlanTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(JSON.parse(result).error).toBe('Unknown error');
        });
    });

    describe('getTestHistoryTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(getTestHistoryTool.invoke({}, {})).rejects.toThrow(
                'userId required'
            );
        });

        it('should filter by testType and calculate average', async () => {
            getTestHistorySpy.mockResolvedValue({
                total: 2,
                results: [
                    { id: '1', testType: 'listening-reading', percentage: 80 },
                    { id: '2', testType: 'other', percentage: 90 },
                ],
            } as any);

            const result = await getTestHistoryTool.invoke(
                { testType: 'listening-reading' },
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(true);
            expect(parsed.tests).toHaveLength(1);
            expect(parsed.averagePercentage).toBe(80);
        });

        it('should handle empty tests', async () => {
            getTestHistorySpy.mockResolvedValue({
                total: 0,
                results: [],
            } as any);

            const result = await getTestHistoryTool.invoke(
                { testType: 'all' },
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.averagePercentage).toBe(0);
        });

        it('should handle error', async () => {
            getTestHistorySpy.mockRejectedValue(new Error('Failed'));
            const result = await getTestHistoryTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(JSON.parse(result).success).toBe(false);
        });

        it('should handle non-Error instance in catch block', async () => {
            getTestHistorySpy.mockRejectedValue('String Error');
            const result = await getTestHistoryTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(JSON.parse(result).error).toBe('Unknown error');
        });
    });

    describe('getUserCreditsTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(getUserCreditsTool.invoke({}, {})).rejects.toThrow(
                'userId required'
            );
        });

        it('should return 0 credits if user null', async () => {
            userFindByIdSpy.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            } as any);

            const result = await getUserCreditsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.credits).toBe(0);
            expect(parsed.canAfford.testAnalysis).toBe(false);
        });

        it('should return credits and affordances', async () => {
            userFindByIdSpy.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue({ credits: 6 }),
            } as any);

            const result = await getUserCreditsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.credits).toBe(6);
            expect(parsed.canAfford.testAnalysis).toBe(false);
            expect(parsed.canAfford.aiTutor).toBe(true);
            expect(parsed.canAfford.premiumResources).toBe(true);
        });

        it('should handle error', async () => {
            userFindByIdSpy.mockImplementation(() => {
                throw new Error('DB error');
            });
            const result = await getUserCreditsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(JSON.parse(result).success).toBe(false);
        });

        it('should handle non-Error instance in catch block', async () => {
            userFindByIdSpy.mockImplementation(() => {
                throw 'String Error';
            });
            const result = await getUserCreditsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(JSON.parse(result).error).toBe('Unknown error');
        });
    });

    describe('getCompetencyInsightsTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(
                getCompetencyInsightsTool.invoke({}, {})
            ).rejects.toThrow('userId required');
        });

        it('should return no insights if profile is missing', async () => {
            userFindByIdSpy.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(null),
            } as any);

            const result = await getCompetencyInsightsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.hasInsights).toBe(false);
        });

        it('should return insights', async () => {
            userFindByIdSpy.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue({
                    competencyProfile: {
                        aiInsights: [
                            {
                                title: 't1',
                                description: 'd1',
                                priority: 'high',
                                actionText: 'a1',
                            },
                            { title: 't2', priority: 'low' },
                        ],
                        scorePrediction: {
                            overallScore: 500,
                            listeningScore: 250,
                            readingScore: 250,
                            cefrLevel: 'B1',
                            summary: 'sum',
                        },
                        skillsMap: [{ skillName: 's1', percentage: 50 }],
                        lastUpdated: new Date(),
                    },
                }),
            } as any);

            const result = await getCompetencyInsightsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.hasInsights).toBe(true);
            expect(parsed.insights[0].type).toBe('weakness');
            expect(parsed.insights[1].type).toBe('tip');
            expect(parsed.scorePrediction.total).toBe(500);
        });

        it('should return competency insights with different priorities', async () => {
            userFindByIdSpy.mockReturnValue({
                select: () => ({
                    lean: () => ({
                        competencyProfile: {
                            aiInsights: [
                                {
                                    title: 'T1',
                                    description: 'D1',
                                    priority: 'high',
                                    actionText: 'A1',
                                },
                                {
                                    title: 'T2',
                                    description: 'D2',
                                    priority: 'medium',
                                    actionText: 'A2',
                                },
                            ],
                        },
                    }),
                }),
            } as any);

            const result = await getCompetencyInsightsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.insights[0].type).toBe('weakness');
            expect(parsed.insights[1].type).toBe('tip');
        });

        it('should return insights without scorePrediction', async () => {
            userFindByIdSpy.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue({
                    competencyProfile: {
                        aiInsights: [
                            { title: 't2', description: 'd2', priority: 'low' },
                        ],
                        // no skillsMap — triggers || [] branch
                    },
                }),
            } as any);

            const result = await getCompetencyInsightsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            const parsed = JSON.parse(result);
            expect(parsed.hasInsights).toBe(true);
            expect(parsed.insights[0].type).toBe('tip');
            expect(parsed.scorePrediction).toBeNull();
            expect(parsed.skillsMap).toEqual([]);
        });

        it('should handle error', async () => {
            userFindByIdSpy.mockImplementation(() => {
                throw new Error('DB error');
            });
            const result = await getCompetencyInsightsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(JSON.parse(result).success).toBe(false);
        });

        it('should handle non-Error instance in catch block', async () => {
            userFindByIdSpy.mockImplementation(() => {
                throw 'String Error';
            });
            const result = await getCompetencyInsightsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );
            expect(JSON.parse(result).error).toBe('Unknown error');
        });
    });
});
