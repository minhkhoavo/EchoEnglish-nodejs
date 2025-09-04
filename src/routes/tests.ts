import { Router } from 'express';
import TestController from '../controllers/TestController';

const router = Router();

router.get('/', TestController.getAllTests);
router.get('/:testId', TestController.getTestById);

export default router;
