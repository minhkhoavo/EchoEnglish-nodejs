import { Router } from "express";
import SpeechController from "~/controllers/speechController";
import { uploadSingle } from "~/config/multerConfig";

const router = Router();

router.post("/assess", uploadSingle, (req, res, next) => SpeechController.assess(req, res, next));

export default router;
