import { Router } from 'express';
import TestController from '../controllers/testController.js';

const router = Router();

router.get('', TestController.getAllTests);
router.get('/:id', TestController.getTestById);
router.post('/questions/by-ids', TestController.getQuestionsByIds);

export default router;
