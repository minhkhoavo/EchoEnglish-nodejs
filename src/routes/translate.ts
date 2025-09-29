import { Router } from 'express';
import { translateController } from '~/controllers/translateController.js';

const router = Router();
router.post('/ai', translateController.translateWithAI);
router.post('/ftapi', translateController.translateWithFreeAPI);
router.post('/ftapi/dictionary', translateController.dictionaryWithFreeAPI);

export default router;
