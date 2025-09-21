import { Router } from 'express';
import SpeakingAttemptController from '~/controllers/speakingAttemptController';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/start', (req, res, next) =>
  SpeakingAttemptController.start(req, res, next)
);
router.post(
  '/:testAttemptId/submit-question',
  upload.single('audio'),
  (req, res, next) => SpeakingAttemptController.submitQuestion(req, res, next)
);
router.post('/:testAttemptId/finish', (req, res, next) =>
  SpeakingAttemptController.finish(req, res, next)
);

export default router;
