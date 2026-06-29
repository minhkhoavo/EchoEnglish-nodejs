import { Request, Response } from 'express';
import { learningPlanAIService } from '~/ai/service/learningPlanAIService.js';
import { dailyPlanAIService } from '~/ai/service/dailyPlanAIService.js';
import { dailySessionService } from '~/services/recommendation/DailySessionService.js';
import { roadmapService } from '~/services/recommendation/RoadmapService.js';
import { roadmapCalibrationService } from '~/services/recommendation/RoadmapCalibrationService.js';
import { testResultService } from '~/services/testResultService.js';
import { User } from '~/models/userModel.js';
import { TestResult } from '~/models/testResultModel.js';
import { determineToeicLevel } from '~/utils/toeicScore.js';
import ApiResponse from '~/dto/response/apiResponse.js';

// Minimal structural views of the lean documents the loaders read (read-only).
interface LeanWeekFocus {
    weekNumber: number;
    title: string;
    summary: string;
    focusSkills: string[];
    targetWeaknesses: unknown[];
    recommendedDomains: string[];
    mistakes?: Array<{
        questionId?: { toString(): string };
        questionText: string;
        contentTags?: string[];
        skillTag?: string;
        partNumber?: number;
        difficulty?: string;
        mistakeCount: number;
    }>;
    dailyFocuses?: Array<{
        dayOfWeek: number;
        focus: string;
        targetSkills?: string[];
        suggestedDomains?: string[];
        estimatedMinutes?: number;
    }>;
}
interface LeanRoadmap {
    activeWeekNumber?: number;
    currentLevel?: string;
    studyTimePerDay?: number;
    weeklyFocuses?: LeanWeekFocus[];
}
interface LeanUser {
    competencyProfile?: {
        currentCEFRLevel?: string;
        skillMatrix?: Array<{
            skill: string;
            currentAccuracy: number;
            proficiency: string;
        }>;
    };
    preferences?: {
        primaryGoal?: string;
        currentLevel?: string;
        preferredStudyTime?: string;
        contentInterests?: string[];
        studyDaysOfWeek?: number[];
    };
}

// Tie the simulator input to the REAL generator signatures so the Playground
// stays in 100% parity at compile time. If a generator's input changes, these
// break until the Playground is updated.
type RoadmapAiInput = Parameters<
    typeof learningPlanAIService.generateLearningRoadmap
>[0];
type DailyPlanInput = Parameters<
    typeof dailyPlanAIService.generateDailyPlan
>[0];
type BuildSessionInput = Parameters<
    typeof dailySessionService.buildSessionPlan
>[0];

/**
 * Surface the raw error to the client — this is a debugging tool, so the full
 * message/stack is the whole point. Never used in production (devOnly guard).
 */
function fail(res: Response, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return res.status(500).json({ message, stack });
}

export class PlaygroundController {
    // ==================== ROADMAP ====================

    /**
     * Pure AI generator mirror. Body = full GenerateRoadmapInput.
     * Calls learningPlanAIService.generateLearningRoadmap directly. No DB writes.
     */
    async roadmapAi(req: Request, res: Response) {
        try {
            const input = req.body as RoadmapAiInput;
            if (input.targetScore == null) {
                return res
                    .status(400)
                    .json(new ApiResponse('targetScore is required'));
            }
            const output =
                await learningPlanAIService.generateLearningRoadmap(input);
            return res
                .status(200)
                .json(new ApiResponse('Roadmap (AI) generated', output));
        } catch (error) {
            return fail(res, error);
        }
    }

    /**
     * Pipeline mirror of RoadmapService.generateRoadmap WITHOUT Roadmap.create().
     * Mirrors the context assembly (preferences mapping, test-analysis shaping,
     * toeic-level detection, dates). Pieces that production loads from Mongo
     * (userPreferences, testAnalysis) can be supplied inline, or loaded
     * read-only when userId / testResultId are provided.
     */
    async roadmapPipeline(req: Request, res: Response) {
        try {
            const {
                userId: bodyUserId,
                userPrompt,
                targetScore,
                studyTimePerDay = 30,
                studyDaysPerWeek = 5,
                testResultId,
                weaknesses,
                userPreferences: inlinePreferences,
                testAnalysis: inlineTestAnalysis,
                todayDayOfWeek: todayOverride,
            } = req.body;

            if (targetScore == null) {
                return res
                    .status(400)
                    .json(new ApiResponse('targetScore is required'));
            }

            const userId = bodyUserId || req.user?.id || 'playground-user';

            // userPreferences: inline override wins, else read-only from DB.
            let userPreferences = inlinePreferences;
            if (!userPreferences && bodyUserId) {
                const user = await User.findById(bodyUserId)
                    .select('preferences')
                    .lean();
                if (user && !Array.isArray(user) && user.preferences) {
                    userPreferences = {
                        primaryGoal: user.preferences.primaryGoal,
                        currentLevel: user.preferences.currentLevel,
                        preferredStudyTime: user.preferences.preferredStudyTime,
                        contentInterests: user.preferences.contentInterests,
                        studyDaysOfWeek: user.preferences.studyDaysOfWeek,
                    };
                }
            }

            // testAnalysis: inline override wins, else read-only from DB.
            let testAnalysis = inlineTestAnalysis;
            let detectedCurrentLevel: string | null = null;
            if (!testAnalysis && testResultId) {
                const testResult = await TestResult.findById(testResultId);
                if (testResult) {
                    testAnalysis = {
                        score: testResult.totalScore,
                        weaknesses:
                            testResult.analysis?.examAnalysis?.topWeaknesses ||
                            [],
                        strengths:
                            testResult.analysis?.examAnalysis?.strengths || [],
                        domainsPerformance:
                            testResult.analysis?.examAnalysis
                                ?.domainPerformance || [],
                        summary:
                            testResult.analysis?.examAnalysis?.summary || '',
                    };
                    detectedCurrentLevel = determineToeicLevel(
                        testResult.totalScore
                    );
                }
            } else if (inlineTestAnalysis?.score != null) {
                detectedCurrentLevel = determineToeicLevel(
                    inlineTestAnalysis.score
                );
            }

            const todayDayOfWeek = todayOverride ?? new Date().getDay();

            const context = {
                userId: userId.toString(),
                userPrompt: userPrompt || 'I want to improve my TOEIC score',
                targetScore,
                studyTimePerDay,
                studyDaysPerWeek,
                userPreferences,
                testAnalysis: testAnalysis || undefined,
                providedWeaknesses: weaknesses,
                todayDayOfWeek,
            } as RoadmapAiInput;

            const llmResponse =
                await learningPlanAIService.generateLearningRoadmap(context);

            // Assemble the roadmap document exactly as RoadmapService would,
            // but DO NOT persist it.
            const startDate = new Date();
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + llmResponse.totalWeeks * 7);
            const finalCurrentLevel =
                detectedCurrentLevel || llmResponse.currentLevel;

            const roadmap = {
                userId,
                roadmapId: `RM_PLAYGROUND_${Date.now()}`,
                userPrompt,
                currentLevel: finalCurrentLevel,
                targetScore,
                startDate,
                endDate,
                totalWeeks: llmResponse.totalWeeks,
                studyTimePerDay,
                studyDaysPerWeek,
                learningStrategy: llmResponse.learningStrategy,
                phaseSummary: llmResponse.phaseSummary || [],
                weeklyFocuses: llmResponse.weeklyFocuses,
                totalSessions: llmResponse.totalWeeks * studyDaysPerWeek,
                status: 'active',
                testResultId,
                activeWeekNumber: 1,
                currentWeek: 1,
                overallProgress: 0,
                sessionsCompleted: 0,
            };

            return res.status(200).json(
                new ApiResponse('Roadmap (pipeline) generated', {
                    roadmap,
                    raw: llmResponse,
                    contextUsed: context,
                })
            );
        } catch (error) {
            return fail(res, error);
        }
    }

    // ==================== DAILY SESSION ====================

    /**
     * Pure AI generator mirror. Body = full DailyPlanContext.
     * Calls dailyPlanAIService.generateDailyPlan directly. No DB writes.
     */
    async dailySessionAi(req: Request, res: Response) {
        try {
            const input = req.body as DailyPlanInput;
            if (!input?.dailyFocus || !input?.weekFocus) {
                return res
                    .status(400)
                    .json(
                        new ApiResponse('dailyFocus and weekFocus are required')
                    );
            }
            const output = await dailyPlanAIService.generateDailyPlan(input);
            return res
                .status(200)
                .json(new ApiResponse('Daily session (AI) generated', output));
        } catch (error) {
            return fail(res, error);
        }
    }

    /**
     * Pipeline mirror of DailySessionService.getTodaySession WITHOUT
     * StudyPlan.create(). Builds the would-be session (planItems + title +
     * description) via the shared buildSessionPlan(dryRun=true). Read-only DB
     * lookups (competency, resources) still run; the LLM is still called.
     *
     * Body: { roadmap, targetWeekNumber, targetDayOfWeek?, isBlocked?, userId? }
     * where `roadmap` carries weeklyFocuses/studyTimePerDay/currentLevel.
     */
    async dailySessionPipeline(req: Request, res: Response) {
        try {
            const {
                roadmap,
                targetWeekNumber,
                targetDayOfWeek,
                isBlocked = false,
                userId: bodyUserId,
                simContext,
            } = req.body;

            if (!roadmap?.weeklyFocuses || targetWeekNumber == null) {
                return res
                    .status(400)
                    .json(
                        new ApiResponse(
                            'roadmap.weeklyFocuses and targetWeekNumber are required'
                        )
                    );
            }

            const userId = bodyUserId || req.user?.id || 'playground-user';

            const weekFocus = roadmap.weeklyFocuses.find(
                (w: { weekNumber: number }) => w.weekNumber === targetWeekNumber
            );
            if (!weekFocus) {
                return res
                    .status(400)
                    .json(
                        new ApiResponse(
                            `No weeklyFocus found for week ${targetWeekNumber}`
                        )
                    );
            }

            const targetDailyFocus =
                targetDayOfWeek != null
                    ? weekFocus.dailyFocuses?.find(
                          (d: { dayOfWeek: number }) =>
                              d.dayOfWeek === targetDayOfWeek
                      )
                    : undefined;

            const params = {
                userId,
                singleRoadmap: roadmap,
                roadmapStatus: {
                    isBlocked,
                    blockedDailyFocus: targetDailyFocus,
                    currentWeek: targetWeekNumber,
                },
                targetWeekNumber,
                targetDailyFocus,
                weekFocus,
                today: new Date(),
                // Inline overrides (competency / preferences / resources /
                // missed sessions) so the pipeline runs with zero DB reads.
                simContext,
            } as BuildSessionInput;

            // dryRun=true → no memo write, no StudyPlan.create.
            const result = await dailySessionService.buildSessionPlan(
                params,
                true
            );

            // Shape it like the persisted StudyPlan the dashboard renders.
            const session = {
                userId: roadmap.userId,
                roadmapRef: roadmap._id,
                testResultId: roadmap.testResultId,
                dayNumber: targetDailyFocus?.dayOfWeek || 1,
                weekNumber: targetWeekNumber,
                scheduledDate: new Date(),
                title: result.sessionTitle,
                description: result.sessionDescription,
                targetSkills: targetDailyFocus?.targetSkills || [],
                targetDomains: targetDailyFocus?.suggestedDomains || [],
                targetWeaknesses: weekFocus.targetWeaknesses,
                planItems: result.planItems,
                totalEstimatedTime: targetDailyFocus?.estimatedMinutes || 0,
                status: 'upcoming',
            };

            return res
                .status(200)
                .json(
                    new ApiResponse(
                        'Daily session (pipeline) generated',
                        session
                    )
                );
        } catch (error) {
            return fail(res, error);
        }
    }

    // ==================== DATA LOADERS (read-only) ====================

    /**
     * Assemble a ready-to-run RoadmapAiInput from real data so the admin doesn't
     * hand-type it. Mirrors exactly what RoadmapService.generateRoadmap pulls
     * from Mongo: user.preferences + the firstTest analysis (or a given
     * testResultId). All read-only.
     */
    async loadRoadmapInput(req: Request, res: Response) {
        try {
            const {
                userId: bodyUserId,
                testResultId,
                targetScore = 700,
                studyTimePerDay = 30,
                studyDaysPerWeek = 5,
                userPrompt,
            } = req.body;

            const userId = bodyUserId || req.user?.id;
            if (!userId) {
                return res
                    .status(400)
                    .json(new ApiResponse('userId is required'));
            }

            const user = (await User.findById(userId)
                .select('preferences')
                .lean()) as LeanUser | null;
            const userPreferences = user?.preferences
                ? {
                      primaryGoal: user.preferences.primaryGoal,
                      currentLevel: user.preferences.currentLevel,
                      preferredStudyTime: user.preferences.preferredStudyTime,
                      contentInterests: user.preferences.contentInterests,
                      studyDaysOfWeek: user.preferences.studyDaysOfWeek,
                  }
                : undefined;

            // Resolve the test: explicit id, else the learner's first L&R test.
            let resolvedTestId = testResultId;
            if (!resolvedTestId) {
                const info = await testResultService.getFirstTestInfo(
                    userId.toString()
                );
                if (info.hasTest && info.firstTest) {
                    resolvedTestId = info.firstTest.id;
                }
            }

            let testAnalysis;
            let detectedCurrentLevel: string | undefined;
            if (resolvedTestId) {
                const tr = await TestResult.findById(resolvedTestId).lean();
                const testResult = (Array.isArray(tr) ? tr[0] : tr) as {
                    totalScore?: number;
                    analysis?: {
                        examAnalysis?: {
                            topWeaknesses?: unknown[];
                            strengths?: string[];
                            domainPerformance?: unknown[];
                            summary?: string;
                        };
                    };
                } | null;
                if (testResult) {
                    const ea = testResult.analysis?.examAnalysis;
                    testAnalysis = {
                        score: testResult.totalScore ?? 0,
                        weaknesses: ea?.topWeaknesses || [],
                        strengths: ea?.strengths || [],
                        summary: ea?.summary || '',
                        domainsPerformance: ea?.domainPerformance || [],
                    };
                    detectedCurrentLevel = determineToeicLevel(
                        testResult.totalScore ?? 0
                    );
                }
            }

            const input = {
                userId: userId.toString(),
                userPrompt: userPrompt || 'I want to improve my TOEIC score',
                targetScore,
                studyTimePerDay,
                studyDaysPerWeek,
                userPreferences,
                testAnalysis,
                providedWeaknesses: testAnalysis?.weaknesses,
                todayDayOfWeek: new Date().getDay(),
            };

            return res.status(200).json(
                new ApiResponse('Loaded roadmap input from real data', {
                    input,
                    detectedCurrentLevel,
                    testResultId: resolvedTestId,
                    hasTest: !!testAnalysis,
                })
            );
        } catch (error) {
            return fail(res, error);
        }
    }

    /**
     * Assemble the full DailyPlanContext (AI input) + a pipeline simContext from
     * real data, mirroring what DailySessionService loads from Mongo: active
     * roadmap week/day, competency/preferences, week mistakes, DB resources and
     * skipped sessions. Lets the admin "load then tweak" every daily parameter.
     */
    async loadDailyContext(req: Request, res: Response) {
        try {
            const { userId: bodyUserId, weekNumber, dayOfWeek } = req.body;
            const userId = bodyUserId || req.user?.id;
            if (!userId) {
                return res
                    .status(400)
                    .json(new ApiResponse('userId is required'));
            }

            const roadmapRaw = await roadmapService.getActiveRoadmap(userId);
            const roadmap = (
                Array.isArray(roadmapRaw) ? roadmapRaw[0] : roadmapRaw
            ) as LeanRoadmap | null;
            if (!roadmap?.weeklyFocuses?.length) {
                return res
                    .status(404)
                    .json(new ApiResponse('No active roadmap for this user'));
            }

            const week = weekNumber ?? roadmap.activeWeekNumber ?? 1;
            const weekFocus = roadmap.weeklyFocuses.find(
                (w) => w.weekNumber === week
            );
            if (!weekFocus) {
                return res
                    .status(404)
                    .json(new ApiResponse(`No weeklyFocus for week ${week}`));
            }

            const dow = dayOfWeek ?? new Date().getDay();
            const daily = weekFocus.dailyFocuses?.find(
                (d) => d.dayOfWeek === dow
            );

            const user = (await User.findById(userId)
                .select('competencyProfile preferences')
                .lean()) as LeanUser | null;
            const comp = user?.competencyProfile || {};
            const lowestSkills = comp.skillMatrix
                ?.filter((s) => s.currentAccuracy < 60)
                .sort((a, b) => a.currentAccuracy - b.currentAccuracy)
                .slice(0, 3)
                .map((s) => ({
                    skill: s.skill,
                    currentAccuracy: s.currentAccuracy,
                    proficiency: s.proficiency,
                }));

            const domains =
                daily?.suggestedDomains || weekFocus.recommendedDomains || [];
            const skills = daily?.targetSkills || weekFocus.focusSkills || [];
            const resources = await dailySessionService.findAvailableResources(
                domains,
                skills
            );
            const skipped =
                await roadmapCalibrationService.getSkippedSessionsContent(
                    userId
                );

            const context = {
                dailyFocus: daily
                    ? {
                          focus: daily.focus,
                          targetSkills: daily.targetSkills || [],
                          suggestedDomains: daily.suggestedDomains || [],
                          estimatedMinutes: daily.estimatedMinutes ?? 30,
                      }
                    : {
                          focus: `General practice for ${weekFocus.title}`,
                          targetSkills: weekFocus.focusSkills || [],
                          suggestedDomains: weekFocus.recommendedDomains || [],
                          estimatedMinutes: roadmap.studyTimePerDay || 30,
                      },
                weekFocus: {
                    weekNumber: weekFocus.weekNumber,
                    title: weekFocus.title,
                    summary: weekFocus.summary,
                    focusSkills: weekFocus.focusSkills,
                    targetWeaknesses: weekFocus.targetWeaknesses,
                    recommendedDomains: weekFocus.recommendedDomains,
                },
                competencyProfile: {
                    currentLevel:
                        comp.currentCEFRLevel || roadmap.currentLevel || 'B1',
                    lowestSkills,
                },
                userPreferences: {
                    preferredStudyTime: user?.preferences?.preferredStudyTime,
                    contentInterests: user?.preferences?.contentInterests,
                },
                mistakesToReview: (weekFocus.mistakes || [])
                    .slice(0, 40)
                    .map((m) => ({
                        questionId: m.questionId?.toString(),
                        questionText: m.questionText,
                        contentTags: m.contentTags || [],
                        skillTag: m.skillTag,
                        partNumber: m.partNumber,
                        difficulty: m.difficulty,
                        mistakeCount: m.mistakeCount,
                    })),
                availableResources: resources.map((r) => ({
                    type: r.type,
                    title: r.title,
                    description: r.description || '',
                    url: r.url,
                    domain: r.labels?.domain,
                    topics: r.labels?.topic,
                })),
                missedSessions: skipped.hasSkippedSessions
                    ? skipped.skippedContent
                    : undefined,
            };

            // For pipeline mode: the roadmap + the inline simContext so it runs
            // with zero DB reads.
            const simContext = {
                user: {
                    competencyProfile: comp,
                    preferences: user?.preferences,
                },
                availableResources: resources,
                skippedContent: skipped,
            };

            return res.status(200).json(
                new ApiResponse('Loaded daily context from real data', {
                    context,
                    pipeline: {
                        roadmap,
                        targetWeekNumber: week,
                        targetDayOfWeek: dow,
                        isBlocked: false,
                        userId: userId.toString(),
                        simContext,
                    },
                })
            );
        } catch (error) {
            return fail(res, error);
        }
    }
}

export const playgroundController = new PlaygroundController();
