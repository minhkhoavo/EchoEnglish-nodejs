import { Router } from 'express';
import ReviewController from '../controllers/reviewController.js';

const router = Router();

// Get flashcards due for review
router.get('/due', ReviewController.getDueFlashcards);

// Submit a review result
router.post('/submit', ReviewController.submitReview);

// Get review statistics
router.get('/statistics', ReviewController.getStatistics);

// Reset all review progress (for testing/development)
router.post('/reset', ReviewController.resetProgress);

export default router;
