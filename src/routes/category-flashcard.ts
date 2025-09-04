import { Router } from "express";
import CategoryFlashcardController from "../controllers/category-flashcard-controller";

// Các route của user
const router = Router();
const categoryCtrl = new CategoryFlashcardController();

// CategoryFlashcard routes
router.post("", categoryCtrl.createCategory);
router.get("", categoryCtrl.getCategories);
router.get("/:id", categoryCtrl.getCategoryById);
router.put("/:id", categoryCtrl.updateCategory);
router.delete("/:id", categoryCtrl.deleteCategory);

export default router;