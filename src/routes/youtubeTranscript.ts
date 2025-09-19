import { Router } from 'express';
import youtubeTranscriptController from '~/controllers/youtubeTranscriptController';

const router = Router();

router.post('/', youtubeTranscriptController.getTranscriptHanlder);

export default router;