import { Router, Request, Response } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import { roadmapService } from '../services/recommendation/RoadmapService.js';
import { dailySessionService } from '../services/recommendation/DailySessionService.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ApiError } from '~/middleware/apiError.js';

const learningPlanRouter = Router();

learningPlanRouter.get('/active', async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id as string;

        const roadmap = await roadmapService.getActiveRoadmap(userId);
        console.log('Active roadmap:', roadmap);
        if (!roadmap) {
            return res
                .status(404)
                .json(new ApiResponse('No active learning plan found', null));
        }
        return res.status(200).json(new ApiResponse('Success', roadmap));
    } catch (error) {
        console.error('Error fetching active roadmap:', error);
        return res
            .status(400)
            .json(
                new ApiError({
                    message: 'Error fetching active roadmap',
                    status: 400,
                })
            );
    }
});

learningPlanRouter.post(
    '/generate',
    authenticateJWT,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            const {
                testResultId,
                targetScore,
                currentScore = 0,
                studyTimePerDay = 30,
                studyDaysPerWeek = 5,
                userPrompt,
            } = req.body;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            if (!targetScore) {
                return res
                    .status(400)
                    .json({ error: 'targetScore is required' });
            }

            // Generate roadmap using RoadmapService
            const roadmap = await roadmapService.generateRoadmap(userId, {
                testResultId,
                targetScore,
                currentScore,
                studyTimePerDay,
                studyDaysPerWeek,
                userPrompt,
            });

            if (!roadmap) {
                return res
                    .status(500)
                    .json({ error: 'Failed to generate roadmap' });
            }

            // Note: Daily sessions will be created lazily when user accesses each day
            res.json(
                new ApiResponse('Generated learning roadmap', {
                    roadmap: {
                        id: roadmap._id,
                        roadmapId: roadmap.roadmapId,
                        currentLevel: roadmap.currentLevel,
                        currentScore: roadmap.currentScore,
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
        } catch (error) {
            console.error('Error generating roadmap:', error);
            res.status(500).json({
                error: 'Failed to generate roadmap',
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
);

learningPlanRouter.get('/today', async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id as string;

        // Get or create today's session (lazy creation)
        const session = await dailySessionService.getTodaySession(userId);

        if (!session) {
            return res.json(
                new ApiResponse(
                    'No active learning plan found. Please generate a plan first.',
                    null
                )
            );
        }

        res.json(new ApiResponse('Today session retrieved', session));
    } catch (error) {
        console.error('Error fetching today session:', error);
        res.status(500).json({
            error: 'Failed to fetch today session',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

learningPlanRouter.post(
    '/today/regenerate',
    authenticateJWT,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id as string;
            const session =
                await dailySessionService.regenerateTodaySession(userId);

            if (!session) {
                return res.json(
                    new ApiResponse('No active learning plan found.', null)
                );
            }

            res.json(
                new ApiResponse(
                    "Today's session regenerated successfully",
                    session
                )
            );
        } catch (error) {
            console.error('Error regenerating today session:', error);
            res.status(500).json({
                error: 'Failed to regenerate session',
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
);

export default learningPlanRouter;
