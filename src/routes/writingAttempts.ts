import { Router } from 'express';
import WritingAttemptController from '~/controllers/writingAttemptController.js';

const router = Router();

router.post('/submit-and-score', WritingAttemptController.submitAndScore);

export default router;
