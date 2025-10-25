import { Request, Response } from 'express';
import { roadmapCalibrationService } from '~/services/recommendation/RoadmapCalibrationService.js';
import { SuccessMessage } from '~/enum/successMessage.js';

export class RoadmapCalibrationController {
    async checkMissedSessions(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const result =
            await roadmapCalibrationService.checkMissedSessions(userId);

        return res.status(200).json({
            message: SuccessMessage.GET_SUCCESS,
            data: result,
        });
    }

    async checkWeekProgress(req: Request, res: Response) {
        const { roadmapId } = req.params;

        const result =
            await roadmapCalibrationService.checkAndProgressWeek(roadmapId);

        return res.status(200).json({
            message: SuccessMessage.GET_SUCCESS,
            data: result,
        });
    }

    async generateDailyFocuses(req: Request, res: Response) {
        const { roadmapId, weekNumber } = req.body;

        const roadmap =
            await roadmapCalibrationService.generateDailyFocusesForWeek(
                roadmapId,
                weekNumber
            );

        return res.status(200).json({
            message: SuccessMessage.GET_SUCCESS,
            data: roadmap,
        });
    }
}

export const roadmapCalibrationController = new RoadmapCalibrationController();
