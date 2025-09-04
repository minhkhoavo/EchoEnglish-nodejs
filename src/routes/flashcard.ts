import { Router } from "express";
import UserController from "~/controllers/UserController";

// Các route của user
const router = Router();
const flashcardController = new UserController();

// Tạo user
router.post('/create',flashcardController.createUser);
router.get('/:id', flashcardController.getUserById);


export default router;