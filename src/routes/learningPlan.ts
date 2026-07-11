import { Router } from 'express';
import { learningPlanController } from '../controllers/learningPlanController.js';
import { roadmapMistakeController } from '../controllers/roadmapMistakeController.js';

const learningPlanRouter = Router();

// ==================== ROADMAP MANAGEMENT ====================
learningPlanRouter.get(
    '/first-test',
    learningPlanController.getFirstTestInfoAndAnalyze.bind(
        learningPlanController
    )
);

learningPlanRouter.get(
    '/active',
    learningPlanController.getActiveRoadmap.bind(learningPlanController)
);

// Delete a roadmap
learningPlanRouter.delete(
    '/roadmap/:roadmapId',
    learningPlanController.deleteRoadmap.bind(learningPlanController)
);

// Generate new roadmap
learningPlanRouter.post(
    '/generate',
    learningPlanController.generateRoadmap.bind(learningPlanController)
);

learningPlanRouter.get(
    '/check-missed',
    learningPlanController.checkMissedSessions.bind(learningPlanController)
);

// Record an inline activity's AI score → nudge competency (close the loop)
learningPlanRouter.post(
    '/activity-result',
    learningPlanController.recordActivityResult.bind(learningPlanController)
);

// ==================== DAILY SESSION ====================
learningPlanRouter.get(
    '/today',
    learningPlanController.getTodaySession.bind(learningPlanController)
);

// Regenerate today's session
learningPlanRouter.post(
    '/today/regenerate',
    learningPlanController.regenerateTodaySession.bind(learningPlanController)
);

// Update user schedule
learningPlanRouter.get(
    '/user-schedule',
    learningPlanController.updateUserSchedule.bind(learningPlanController)
);

// ==================== SESSION DETAIL & COMPLETION ====================
learningPlanRouter.get(
    '/sessions/:sessionId',
    learningPlanController.getSessionDetail.bind(learningPlanController)
);
learningPlanRouter.post(
    '/sessions/:sessionId/complete',
    learningPlanController.completeSession.bind(learningPlanController)
);

// ==================== ACTIVITY COMPLETION ====================
learningPlanRouter.post(
    '/sessions/:sessionId/items/:itemId/resources/:resourceId/track',
    learningPlanController.trackResource.bind(learningPlanController)
);

// Complete practice drill (auto complete khi submit)
learningPlanRouter.post(
    '/sessions/:sessionId/practice-drill/complete',
    learningPlanController.completePracticeDrill.bind(learningPlanController)
);

// ==================== STUDY MEMO (USER-PROVIDED MATERIAL) ====================

// Step A: analyze suitability + propose multi-day breakdown (no save)
learningPlanRouter.post(
    '/memos/analyze',
    learningPlanController.analyzeMemo.bind(learningPlanController)
);

// Step B: confirm -> save memo (+ regenerate today if relevant)
learningPlanRouter.post(
    '/memos',
    learningPlanController.createMemo.bind(learningPlanController)
);

learningPlanRouter.delete(
    '/memos/:memoId',
    learningPlanController.deleteMemo.bind(learningPlanController)
);

// ==================== MISTAKE TRACKING ====================

// Add multiple mistakes to stack
learningPlanRouter.post(
    '/mistakes/batch',
    roadmapMistakeController.addMultipleMistakes.bind(roadmapMistakeController)
);

// Remove mistake from stack
learningPlanRouter.delete(
    '/mistakes/remove',
    roadmapMistakeController.removeMistake.bind(roadmapMistakeController)
);

export default learningPlanRouter;
