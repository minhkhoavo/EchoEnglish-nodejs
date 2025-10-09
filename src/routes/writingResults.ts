import { Router } from 'express';
import writingResultController from '~/controllers/writingResultController.js';

const router = Router();

router.get('', writingResultController.getAll);
router.get('/:id', writingResultController.getById);

export default router;
