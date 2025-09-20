import { Router } from 'express';
import youtubeTranscriptController from '~/controllers/youtubeTranscriptController';

const router = Router();

router.post('/', youtubeTranscriptController.getTranscriptHanlder);
router.post('/save', youtubeTranscriptController.saveTranscriptHandler);

export default router;