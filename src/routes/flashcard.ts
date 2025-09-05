import { Router } from "express";
import FlashcardController from "~/controllers/flashcard_controller";
import CategoryFlashcardController from "../controllers/category_flashcard_controller";
import { isOwn } from "~/middleware/auth_middleware";
import { Flashcard } from "~/models/flashcard_model";

const router = Router();
const categoryCtrl = new CategoryFlashcardController();

router.get("/", FlashcardController.getAllFlashcard);
router.get("/category/:cateId", FlashcardController.getFlashcardByCategory);
router.post("/", FlashcardController.createFlashcard);
router.put("/:id", isOwn(Flashcard), FlashcardController.updateFlashcard);
router.delete("/:id", isOwn(Flashcard), FlashcardController.deleteFlashcard);

// CATEGORY ENDPOINTS (gộp chung)
router.get("/categories", categoryCtrl.getCategories);
router.post("/categories", categoryCtrl.createCategory);
router.put("/categories/:id", categoryCtrl.updateCategory);
router.delete("/categories/:id", categoryCtrl.deleteCategory);

export default router;