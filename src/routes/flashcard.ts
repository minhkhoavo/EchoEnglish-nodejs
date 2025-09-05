import { Router } from "express";
import UserController from "~/controllers/user_controller";
import FlashcardController from "~/controllers/flashcard_controller";
import { globalAuth } from "~/middleware/auth_middleware";
import { isOwn } from "~/middleware/auth_middleware";
import { Flashcard } from "~/models/flashcard_model";
const router = Router();

router.post('/create',FlashcardController.createFlashcard);
router.get('/',FlashcardController.getAllFlashcard);
router.get('/by-category/:cateId', FlashcardController.getFlashcardByCategory);
router.put('/:id', isOwn(Flashcard), FlashcardController.updateFlashcard);
router.delete('/:id', isOwn(Flashcard), FlashcardController.deleteFlashcard);

export default router;