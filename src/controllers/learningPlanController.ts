import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { roadmapService } from '../services/recommendation/RoadmapService.js';
import { dailySessionService } from '../services/recommendation/DailySessionService.js';
import { StudyPlan } from '../models/studyPlanModel.js';
import ApiResponse from '../dto/response/apiResponse.js';
import { ApiError } from '../middleware/apiError.js';
import { ErrorMessage } from '../enum/errorMessage.js';
import { SuccessMessage } from '../enum/successMessage.js';
import { testResultService } from '../services/testResultService.js';
import { weaknessDetectorService } from '../services/diagnosis/WeaknessDetectorService.js';
import { analysisEngineService } from '~/services/analysis/AnalysisEngineService.js';
import { roadmapCalibrationService } from '~/services/recommendation/RoadmapCalibrationService.js';
import { studyMemoService } from '../services/recommendation/StudyMemoService.js';
import { User } from '../models/userModel.js';

export class LearningPlanController {
    async getActiveRoadmap(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const roadmap = await roadmapService.getActiveRoadmap(userId);

        if (!roadmap) {
            throw new ApiError(ErrorMessage.ROADMAP_NOT_FOUND);
        }

        return res.status(200).json(new ApiResponse('Success', roadmap));
    }

    async generateRoadmap(req: Request, res: Response) {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        let {
            testResultId,
            targetScore,
            studyTimePerDay = 30,
            studyDaysPerWeek = 5,
            userPrompt,
        } = req.body;

        if (!targetScore)
            if (!targetScore) {
                throw new ApiError(ErrorMessage.TARGET_SCORE_REQUIRED);
            }

        let testInfo = await testResultService.getFirstTestInfo(
            userId.toString()
        );
        if (!testResultId && testInfo.hasTest && testInfo.firstTest) {
            testResultId = testInfo.firstTest.id;
        }
        const roadmap = await roadmapService.generateRoadmap(userId, {
            testResultId,
            targetScore,
            studyTimePerDay,
            studyDaysPerWeek,
            userPrompt,
        });

        if (!roadmap) {
            throw new ApiError({
                message: 'Failed to generate roadmap',
                status: 500,
            });
        }

        return res.status(201).json(
            new ApiResponse(SuccessMessage.CREATE_SUCCESS, {
                roadmap: {
                    id: roadmap._id,
                    roadmapId: roadmap.roadmapId,
                    currentLevel: roadmap.currentLevel,
                    targetScore: roadmap.targetScore,
                    startDate: roadmap.startDate,
                    endDate: roadmap.endDate,
                    totalWeeks: roadmap.totalWeeks,
                    studyTimePerDay: roadmap.studyTimePerDay,
                    studyDaysPerWeek: roadmap.studyDaysPerWeek,
                    learningStrategy: roadmap.learningStrategy,
                    weeklyFocuses: roadmap.weeklyFocuses,
                    overallProgress: roadmap.overallProgress || 0,
                },
            })
        );
    }

    async getTodaySession(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const session = await dailySessionService.getTodaySession(userId);

        if (!session) {
            return res.json(
                new ApiResponse(
                    'No active learning plan found. Please generate a plan first.',
                    null
                )
            );
        }

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, session));
    }

    async regenerateTodaySession(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const session =
            await dailySessionService.regenerateTodaySession(userId);

        if (!session) {
            return res.json(
                new ApiResponse('No active learning plan found.', null)
            );
        }

        return res
            .status(200)
            .json(
                new ApiResponse(
                    "Today's session regenerated successfully",
                    session
                )
            );
    }

    async updateUserSchedule(req: Request, res: Response) {
        const userId = req.user?.id as string;

        await roadmapService.updateRoadmapScheduleFromUserPreferences(
            new Types.ObjectId(userId)
        );

        return res.status(200).json(
            new ApiResponse(SuccessMessage.UPDATE_SUCCESS, {
                message: 'Roadmap schedule updated successfully',
            })
        );
    }

    async trackResource(req: Request, res: Response) {
        const { sessionId, itemId, resourceId } = req.params;
        const { timeSpent } = req.body;

        const session = await dailySessionService.trackResourceView(
            sessionId,
            itemId,
            resourceId,
            timeSpent
        );

        return res.status(200).json(
            new ApiResponse('Resource tracked successfully', {
                progress: session.progress,
                status: session.status,
            })
        );
    }

    async completePracticeDrill(req: Request, res: Response) {
        const { sessionId } = req.params;

        const session =
            await dailySessionService.completePracticeDrill(sessionId);

        return res.status(200).json(
            new ApiResponse(SuccessMessage.UPDATE_SUCCESS, {
                message: 'Practice drill completed',
                progress: session.progress,
                status: session.status,
            })
        );
    }
    async completeSession(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const { sessionId } = req.params;

        const result = await dailySessionService.completeDailySession(
            userId,
            sessionId
        );

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.UPDATE_SUCCESS, result));
    }

    async getSessionDetail(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const { sessionId } = req.params;

        const session = await StudyPlan.findOne({
            _id: sessionId,
            userId,
        }).lean();

        if (!session) {
            throw new ApiError(ErrorMessage.SESSION_NOT_FOUND);
        }

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, session));
    }

    async getFirstTestInfoAndAnalyze(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const testInfo = await testResultService.getFirstTestInfo(userId);

        if (
            testInfo.hasTest &&
            testInfo.firstTest &&
            !testInfo.firstTest.isAnalyzed
        ) {
            console.log(
                `First test not analyzed, triggering analysis for test: ${testInfo.firstTest.id}`
            );

            // 1. Analyze test result
            await analysisEngineService.analyzeTestResult(
                testInfo.firstTest.id
            );
            // 2. Weakness detection with AI
            await weaknessDetectorService.detectWeaknesses(
                testInfo.firstTest.id
            );
            console.log('First test analysis completed');

            // Update isAnalyzed flag
            testInfo.firstTest.isAnalyzed = true;
        }

        return res.status(200).json(
            new ApiResponse(SuccessMessage.GET_SUCCESS, {
                ...testInfo,
                message: testInfo.hasTest
                    ? testInfo.firstTest?.isAnalyzed
                        ? 'First test found and analyzed'
                        : 'First test found, analysis in progress'
                    : 'No listening-reading test found. Please complete a test first.',
            })
        );
    }

    // Study memo (User provices materials + note + scope -> AI analyze suitability)
    // Step A: analyze suitability + propose multi-day breakdown (nothing saved)
    async analyzeMemo(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const {
            materials,
            note,
            scope,
            targetDate,
            targetWeekNumber,
            preferredDays,
        } = req.body;

        if (!Array.isArray(materials) || materials.length === 0) {
            throw new ApiError(ErrorMessage.RESOURCE_NOT_FOUND);
        }
        if (scope !== 'date' && scope !== 'week') {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }

        const result = await studyMemoService.analyzeMemo(userId, {
            materials,
            note,
            scope,
            targetDate,
            targetWeekNumber,
            preferredDays,
        });

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    }

    // Step B: confirm -> save memo + supplement competency + regenerate today if relevant
    async createMemo(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const {
            materials,
            note,
            scope,
            targetDate,
            targetWeekNumber,
            suitability,
            dayPlan,
            supplementedWeaknesses,
        } = req.body;

        if (!Array.isArray(materials) || materials.length === 0) {
            throw new ApiError(ErrorMessage.RESOURCE_NOT_FOUND);
        }
        if (!Array.isArray(dayPlan) || dayPlan.length === 0) {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }

        const memo = await studyMemoService.confirmMemo(userId, {
            materials,
            note,
            scope,
            targetDate,
            targetWeekNumber,
            suitability: suitability || { isSuitable: true },
            dayPlan,
            supplementedWeaknesses,
        });

        // Regenerate today's session if this memo applies today.
        let session = null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let appliesToday = scope === 'week';
        if (scope === 'date' && targetDate) {
            const d = new Date(targetDate);
            d.setHours(0, 0, 0, 0);
            appliesToday = d.getTime() === today.getTime();
        }
        if (appliesToday) {
            session = await dailySessionService.regenerateTodaySession(userId);
        }

        return res.status(201).json(
            new ApiResponse(SuccessMessage.CREATE_SUCCESS, {
                memo,
                session,
            })
        );
    }

    async deleteMemo(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const { memoId } = req.params;

        await studyMemoService.deleteMemo(userId, memoId);

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.DELETE_SUCCESS, { memoId }));
    }

    async checkMissedSessions(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const result =
            await roadmapCalibrationService.checkMissedSessions(userId);

        return res.status(200).json({
            message: SuccessMessage.GET_SUCCESS,
            data: result,
        });
    }

    // Close the learning loop (kept simple): record an inline activity's score
    // as one AI insight. Since signals already read aiInsights, this alone feeds
    // back into the next day's generation.
    async recordActivityResult(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const { kind, targetSkill, score } = req.body as {
            kind?: string;
            targetSkill?: string;
            score?: number;
        };

        if (typeof score !== 'number') {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }
        const clamped = Math.max(0, Math.min(100, Math.round(score)));

        const user = await User.findById(userId).select('competencyProfile');
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        if (!user.competencyProfile) {
            user.competencyProfile = {};
        }
        user.competencyProfile.aiInsights =
            user.competencyProfile.aiInsights || [];

        const label = (kind || 'activity').replace(/_/g, ' ');
        user.competencyProfile.aiInsights.push({
            title: `${label} activity: ${clamped}/100`,
            description: `Scored ${clamped}/100${
                targetSkill ? ` on ${targetSkill}` : ''
            }.`,
            actionText: targetSkill
                ? `Practice ${targetSkill}`
                : 'Keep practicing',
            priority: clamped < 50 ? 'high' : clamped < 75 ? 'medium' : 'low',
            createdAt: new Date(),
        });
        user.competencyProfile.lastUpdated = new Date();
        user.markModified('competencyProfile');
        await user.save();

        return res
            .status(200)
            .json(
                new ApiResponse(SuccessMessage.UPDATE_SUCCESS, {
                    score: clamped,
                })
            );
    }
}

export const learningPlanController = new LearningPlanController();
