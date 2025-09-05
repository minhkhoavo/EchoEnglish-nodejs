import { Router, Request, Response } from "express";
import CategoryFlashcardController from "../controllers/category_flashcard_controller";

// Các route của user
const router = Router();
const categoryCtrl = new CategoryFlashcardController();

// CategoryFlashcard routes
/* Test public enpoint */
router.get("/test/:id/:key", (req: Request, res: Response)=>{
    res.status(200).json({success: `${req.params.id} success, ${req.params.key}`});
});

router.post("", categoryCtrl.createCategory);
router.get("", categoryCtrl.getCategories);
router.get("/:id", categoryCtrl.getCategoryById);
router.put("/:id", categoryCtrl.updateCategory);
router.delete("/:id", categoryCtrl.deleteCategory);

export default router;