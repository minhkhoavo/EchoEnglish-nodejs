import { Router } from 'express';
import { roadmapCalibrationController } from '~/controllers/roadmapCalibrationController.js';
import { authenticateJWT } from '~/middleware/authMiddleware.js';

const router = Router();

router.get(
    '/check-missed',
    authenticateJWT,
    roadmapCalibrationController.checkMissedSessions
);

router.get(
    '/:roadmapId/check-week-progress',
    authenticateJWT,
    roadmapCalibrationController.checkWeekProgress
);

router.post(
    '/generate-daily-focuses',
    authenticateJWT,
    roadmapCalibrationController.generateDailyFocuses
);

export default router;
