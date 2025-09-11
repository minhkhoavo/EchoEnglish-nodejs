import { Router } from "express";
import SpeechController from "~/controllers/speechController";
import RecordingController from "~/controllers/recordingController";
import { uploadSingle } from "~/config/multerConfig";

const router = Router();

router.post("/assess", uploadSingle, (req, res, next) => SpeechController.assess(req, res, next));

// Recording
router.get('/recordings/', (req, res, next) => RecordingController.list(req, res, next));
router.get('/recordings/:id', (req, res, next) => RecordingController.detail(req, res, next));
router.delete('/recordings/:id', (req, res, next) => RecordingController.remove(req, res, next));

export default router;
