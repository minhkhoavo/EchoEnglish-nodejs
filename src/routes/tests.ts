import { Router } from 'express';
import TestController from '../controllers/test_controller';

const router = Router();

router.get('/', TestController.getAllTests); 
router.get('/:testId/part/:partNumber', TestController.getTestByPart);
router.get('/:testId', TestController.getTestById);

export default router;
