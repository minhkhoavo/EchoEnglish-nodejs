import { Router } from 'express';
import SpeakingAttemptController from '~/controllers/speakingAttemptController.js';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/start', SpeakingAttemptController.start);
router.get('/', SpeakingAttemptController.getAllSpeakingAttempts);
router.post(
    '/:testAttemptId/submit-question',
    upload.single('audio'),
    SpeakingAttemptController.submitQuestion
);
router.post('/:testAttemptId/finish', SpeakingAttemptController.finish);

export default router;
