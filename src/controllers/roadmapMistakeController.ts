import { Request, Response } from 'express';
import {
    roadmapMistakeService,
    MistakeData,
} from '../services/recommendation/RoadmapMistakeService.js';

export class RoadmapMistakeController {
    async addMultipleMistakes(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const { mistakes }: { mistakes: MistakeData[] } = req.body;

        if (!Array.isArray(mistakes) || mistakes.length === 0) {
            return res.status(400).json({
                error: 'Invalid mistakes array',
            });
        }

        // Validate each mistake
        for (const mistake of mistakes) {
            if (!mistake.questionId || !mistake.questionText) {
                return res.status(400).json({
                    error: 'Each mistake must have questionId and questionText',
                });
            }
        }

        const result = await roadmapMistakeService.addMultipleMistakes(
            userId,
            mistakes
        );

        res.json({
            success: true,
            message: result.message,
            addedCount: result.addedCount,
            totalCount: mistakes.length,
        });
    }

    async removeMistake(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const { questionId, weekNumber } = req.body;

        if (!questionId) {
            return res.status(400).json({
                error: 'Missing required field: questionId',
            });
        }

        const result = await roadmapMistakeService.removeMistake(
            userId,
            questionId,
            weekNumber
        );

        res.json({
            success: true,
            message: result.message,
        });
    }
}

export const roadmapMistakeController = new RoadmapMistakeController();
