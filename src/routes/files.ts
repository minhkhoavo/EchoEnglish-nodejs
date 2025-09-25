import { Router } from 'express';
import FileUploadController from '../controllers/fileUploadController.js';
import { uploadSingle } from '~/config/multerConfig.js';

const router = Router();

router.post('/upload', uploadSingle, FileUploadController.uploadOnly);
router.post('/upload-analyze', uploadSingle, FileUploadController.analyzeFile);
router.post('/upload-image', uploadSingle, FileUploadController.uploadImage);
router.post('/upload-audio', uploadSingle, FileUploadController.uploadAudio);
router.post('/chat', FileUploadController.chatWithUploads);
router.delete('/:key', FileUploadController.deleteFile);
router.get('/presigned-url/:key', FileUploadController.getPresignedUrl);

export default router;
