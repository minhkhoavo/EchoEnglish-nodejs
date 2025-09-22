import { Router } from 'express';
import SpeakingWritingController from '../controllers/speakingWritingController.js';

const router = Router();

router.get('/', SpeakingWritingController.getAllTests);
router.get(
    '/:testId/part/:partNumber',
    SpeakingWritingController.getTestByPart
);
router.get('/:testId', SpeakingWritingController.getTestById);

export default router;
