import { Router } from "express";
import FileUploadController from "../controllers/fileUploadController.js";
import { authenticateJWT } from "../middleware/authMiddleware.js";
import { uploadSingle } from "~/config/multerConfig.js";

const router = Router();

router.use(uploadSingle);
router.post("/upload", FileUploadController.uploadSingleFile);
router.post("/upload-image", FileUploadController.uploadImage);
router.post("/upload-audio", FileUploadController.uploadAudio);
router.delete("/:key", FileUploadController.deleteFile);
router.get("/presigned-url/:key", FileUploadController.getPresignedUrl);

export default router;
