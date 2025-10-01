import { Router } from 'express';
import ChatbotAgentController from '~/controllers/chatbotController.js';
import { uploadSingleImage } from '~/config/multerConfig.js';

const router = Router();

router.post(
    '/run',
    (req, res, next) => {
        const contentType = req.get('Content-Type') || '';
        if (contentType.includes('multipart/form-data')) {
            uploadSingleImage(req, res, (err) => {
                if (err) {
                    return res.status(400).json({
                        message: 'File upload error',
                        error: err.message,
                    });
                }
                next();
            });
        } else {
            next();
        }
    },
    ChatbotAgentController.runAgent
);

export default router;
