import { Router } from 'express';
import SpeakingWritingController from '../controllers/speakingWritingController.js';

const router = Router();

router.get('/', SpeakingWritingController.getAllTests);
router.get('/:id', SpeakingWritingController.getTestById);

export default router;
