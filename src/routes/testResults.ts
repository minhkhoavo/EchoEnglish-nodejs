import { Router } from 'express';
import { testResultController } from '../controllers/testResultController.js';
import { authenticateJWT } from '../middleware/authMiddleware.js';

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
router.get(
    '/listening-reading',
    authenticateJWT,
    testResultController.getListeningReading
);

export default router;
