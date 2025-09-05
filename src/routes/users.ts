import { Express } from "express";
import { Router } from "express";
import UserController from "~/controllers/user_controller";
import { globalAuth, hasAuthority, isOwn } from "~/middleware/auth_middleware";
import { User } from "~/models/user_model";
// Các route của user
const router = Router();
const userController = new UserController();

// Tạo user
router.post('/create', hasAuthority("ADMIN"), userController.createUser);
router.get('/:id', userController.getUserById);
router.delete('/:id', hasAuthority("ADMIN"), userController.softDeleteUser);
router.put('/:id', hasAuthority("ADMIN"), userController.updateUser);
router.put('/my-profile/:id', isOwn(User), userController.updateProfileUser);


export default router;