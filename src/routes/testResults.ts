import { Router } from 'express';
import { testResultController } from '../controllers/testResultController.js';
import { authenticateJWT } from '../middleware/authMiddleware.js';

const router = Router();

// Submit test result
router.post('/submit', testResultController.submitTestResult);

// Get test history for user
router.get('/history', testResultController.getTestHistory);

// Get specific test result detail
router.get('/detail/:testId', testResultController.getTestResultDetail);

// Analytics endpoints
router.get(
    '/time-result/:resultId',
    testResultController.getTestResultAnalytics
);
router.get(
    '/slowest-questions/:testId',
    testResultController.getSlowestQuestions
);

// Get user test stats
router.get('/stats', testResultController.getUserStats);
router.get(
    '/listening-reading',
    testResultController.getAllListeningReadingResults
);

export default router;
