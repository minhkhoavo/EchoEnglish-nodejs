import { Router } from 'express';
import SpeakingWritingController from '../controllers/speakingWritingController';

const router = Router();

router.get('/', SpeakingWritingController.getAllTests);
router.get('/:testId', SpeakingWritingController.getTestById);

export default router;
