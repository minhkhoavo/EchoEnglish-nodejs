import { Router } from 'express';
import FileUploadController from '../controllers/file_upload_controller';
import { authenticateJWT } from '../middleware/auth_middleware';
import { uploadSingle } from '~/config/multer_config';

const router = Router();

router.use(uploadSingle);
router.post('/upload', FileUploadController.uploadSingleFile);
router.post('/upload-image', FileUploadController.uploadImage);
router.post('/upload-audio', FileUploadController.uploadAudio);
router.delete('/:key', FileUploadController.deleteFile);
router.get('/presigned-url/:key', FileUploadController.getPresignedUrl);

export default router;
