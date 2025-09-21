import { Router } from 'express';
import FlashcardController from '~/controllers/flashcardController';
import CategoryFlashcardController from '../controllers/categoryFlashcardController';
import { isOwn } from '~/middleware/authMiddleware';
import { Flashcard } from '~/models/flashcardModel';

const router = Router();
const categoryCtrl = new CategoryFlashcardController();

router.get('/', FlashcardController.getAllFlashcard);
router.get('/category/:cateId', FlashcardController.getFlashcardByCategory);
router.post('/', FlashcardController.createFlashcard);
router.put('/:id', isOwn(Flashcard), FlashcardController.updateFlashcard);
router.delete('/:id', isOwn(Flashcard), FlashcardController.deleteFlashcard);

// CATEGORY ENDPOINTS
router.get('/categories', categoryCtrl.getCategories);
router.post('/categories', categoryCtrl.createCategory);
router.put('/categories/:id', categoryCtrl.updateCategory);
router.delete('/categories/:id', categoryCtrl.deleteCategory);

export default router;
