import { Router, Request, Response } from 'express';
import SpeechController from '~/controllers/speechController.js';
import { uploadSingle } from '~/config/multerConfig.js';

const router = Router();

router.post('/assess', uploadSingle, (req, res) =>
    SpeechController.assess(req, res)
);

// Recording
router.get('/recordings/', (req, res) =>
    SpeechController.listRecordings(req, res)
);
router.get('/recordings/:id', (req, res) =>
    SpeechController.detailRecording(req, res)
);
router.delete('/recordings/:id', (req, res) =>
    SpeechController.removeRecording(req, res)
);

export default router;
