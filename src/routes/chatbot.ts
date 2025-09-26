import { Router } from 'express';
import chatbotAgentController from '~/controllers/chatbotController.js';

const router = Router();

router.post('/run', chatbotAgentController.runAgent);

export default router;
