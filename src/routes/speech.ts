import { Router } from "express";
import SpeechController from "~/controllers/speechController.js";
import { uploadSingle } from "~/config/multerConfig.js";

const router = Router();

router.post("/assess", uploadSingle, (req, res, next) => SpeechController.assess(req, res, next));

// Recording
router.get('/recordings/', (req, res, next) => SpeechController.listRecordings(req, res, next));
router.get('/recordings/:id', (req, res, next) => SpeechController.detailRecording(req, res, next));
router.delete('/recordings/:id', (req, res, next) => SpeechController.removeRecording(req, res, next));

export default router;
