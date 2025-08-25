import { Express } from "express";
import { Router } from "express";
import UserController from "~/controllers/UserController";

// Các route của user
const router = Router();
const userController = new UserController();

// Tạo user
router.post('/create',userController.createUser);


export default router;