import { Router } from 'express';
import { testResultController } from '../controllers/testResultController';
import { authenticateJWT } from '../middleware/authMiddleware';

const router = Router();

// Submit test result
router.post('/submit', authenticateJWT, testResultController.submitTestResult);

// Get test history for user
router.get('/history', authenticateJWT, testResultController.getTestHistory);

// Get specific test result detail
router.get(
  '/detail/:resultId',
  authenticateJWT,
  testResultController.getTestResultDetail
);

// Get user test stats
router.get('/stats', authenticateJWT, testResultController.getUserStats);

export default router;
