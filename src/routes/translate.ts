import { Router } from 'express';
import { translateController } from '~/controllers/translateController.js';
import { oneRequestPerSecond } from '~/middleware/rateLimiter.js';

const router = Router();
router.use(oneRequestPerSecond);
router.post('', translateController.translate);
router.post(
    '/ftapi/dictionary',
    translateController.dictionaryWithFreeTranslateAPI
);

export default router;
