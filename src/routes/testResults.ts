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

// Metrics endpoints (new timing analysis system)
router.get(
    '/metrics/:resultId',
    authenticateJWT,
    testResultController.getTestResultMetrics
);
router.get(
    '/slowest-questions/:testId',
    authenticateJWT,
    testResultController.getSlowestQuestions
);

// Get user test stats
router.get('/stats', testResultController.getUserStats);
router.get(
    '/listening-reading',
    testResultController.getAllListeningReadingResults
);

// ===== TOEIC Analysis Endpoints =====
// Trigger deep analysis for a test result
router.post(
    '/:id/analyze',
    authenticateJWT,
    testResultController.analyzeTestResult
);

// Get analysis result
router.get(
    '/:id/analysis',
    authenticateJWT,
    testResultController.getAnalysisResult
);

// Get study plan
router.get(
    '/:id/study-plan',
    authenticateJWT,
    testResultController.getStudyPlan
);

// Update study plan item progress
router.patch(
    '/study-plans/:id/items/:priority/progress',
    authenticateJWT,
    testResultController.updateStudyPlanProgress
);

export default router;
