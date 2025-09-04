import { Router } from "express";
import UserController from "~/controllers/UserController";
import FlashcardController from "~/controllers/FlashcardController";
import { globalAuth } from "~/middleware/auth.middleware";
import { isOwn } from "~/middleware/auth.middleware";
import { Flashcard } from "~/models/flashcard.model";
// Các route của user
const router = Router();

// Tạo user
router.post('/create',FlashcardController.createFlashcard);
router.get('/by-category/:cateId', FlashcardController.getFlashcardByCategory);
router.put('/:id', isOwn(Flashcard), FlashcardController.updateFlashcard);
router.delete('/:id', isOwn(Flashcard), FlashcardController.deleteFlashcard);


export default router;