import { Router } from 'express';
import { translateController } from '~/controllers/translateController.js';

const router = Router();
router.post('', translateController.translate);
router.post(
    '/ftapi/dictionary',
    translateController.dictionaryWithFreeTranslateAPI
);

export default router;
