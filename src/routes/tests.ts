import { Router } from 'express';
import TestController from '../controllers/testController.js';

const router = Router();

router.get('', TestController.getAllTests);
router.get('/:id', TestController.getTestById);

export default router;
