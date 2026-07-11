import { Router } from 'express';
import { translateController } from '~/controllers/translateController.js';
import { oneRequestPerSecond } from '~/middleware/rateLimiter.js';

const router = Router();
router.use(oneRequestPerSecond);
router.post('', translateController.translate); // Dành cho việc dịch cả đoạn văn/câu
router.post('/dictionary', translateController.getDictionaryInfo); // Dành cho tra 1 từ vựng chi tiết

export default router;
