import { Router } from 'express';
import FlashcardController from '~/controllers/flashcardController.js';
import CategoryFlashcardController from '../controllers/categoryFlashcardController.js';

const router = Router();

router.get('', FlashcardController.getAllFlashcard);
router.get('/category/:cateId', FlashcardController.getFlashcardByCategory);
router.post('/by-source', FlashcardController.getFlashcardBySource);
router.post('/', FlashcardController.createFlashcard);
router.post('/bulk', FlashcardController.bulkCreateFlashcards);
router.put('/bulk', FlashcardController.bulkUpdateFlashcards);
router.delete('/bulk', FlashcardController.bulkDeleteFlashcards);
router.put('/:id', FlashcardController.updateFlashcard);
router.delete('/:id', FlashcardController.deleteFlashcard);

// CATEGORY ENDPOINTS
router.get('/categories', CategoryFlashcardController.getCategories);
router.get('/categories/:id', CategoryFlashcardController.getCategoryById);
router.post('/categories', CategoryFlashcardController.createCategory);
router.put('/categories/:id', CategoryFlashcardController.updateCategory);
router.delete('/categories/:id', CategoryFlashcardController.deleteCategory);

export default router;
