import { Router } from 'express';
import speakingResultController from '~/controllers/speakingResultController';

const router = Router();

router.get('/result/:id', (req, res, next) => speakingResultController.getById(req, res, next));

export default router;
