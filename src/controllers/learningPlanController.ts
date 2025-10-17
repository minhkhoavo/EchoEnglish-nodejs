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
}

export const learningPlanController = new LearningPlanController();
