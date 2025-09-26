import { Router } from 'express';
import FlashcardController from '~/controllers/flashcardController.js';
import CategoryFlashcardController from '../controllers/categoryFlashcardController.js';
import { isOwn } from '~/middleware/authMiddleware.js';
import { Flashcard } from '~/models/flashcardModel.js';

const router = Router();

router.get('/', FlashcardController.getAllFlashcard);
router.get('/category/:cateId', FlashcardController.getFlashcardByCategory);
router.post('/', FlashcardController.createFlashcard);
router.put('/:id', FlashcardController.updateFlashcard);
router.delete('/:id', FlashcardController.deleteFlashcard);

// CATEGORY ENDPOINTS
router.get('/categories', CategoryFlashcardController.getCategories);
router.get('/categories/:id', CategoryFlashcardController.getCategoryById);
router.post('/categories', CategoryFlashcardController.createCategory);
router.put('/categories/:id', CategoryFlashcardController.updateCategory);
router.delete('/categories/:id', CategoryFlashcardController.deleteCategory);

export default router;
