import { Router, Request, Response } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import { roadmapService } from '../services/recommendation/RoadmapService.js';
import { dailySessionService } from '../services/recommendation/DailySessionService.js';

const learningPlanRouter = Router();

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
            res.json({
                message: 'Generated learning roadmap',
                data: {
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
                },
            });
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
            return res.json({
                success: true,
                message:
                    'No active learning plan found. Please generate a plan first.',
                data: null,
            });
        }

        res.json({
            success: true,
            data: session,
        });
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
                return res.json({
                    success: true,
                    message: 'No active learning plan found.',
                    data: null,
                });
            }

            res.json({
                success: true,
                message: "Today's session regenerated successfully",
                data: session,
            });
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
