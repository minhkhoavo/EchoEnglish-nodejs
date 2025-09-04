import { Express } from "express";
import { Router } from "express";
import UserController from "~/controllers/UserController";
import { globalAuth, hasAuthority, isOwn } from "~/middleware/auth.middleware";
// Các route của user
const router = Router();
const userController = new UserController();

// Tạo user
router.post('/create',globalAuth, hasAuthority("ADMIN"), userController.createUser);
router.get('/:id', userController.getUserById);
router.delete('/:id', globalAuth, hasAuthority("ADMIN"), userController.softDeleteUser);
router.put('/:id',globalAuth, hasAuthority("ADMIN"), userController.updateUser);
router.put('/my-profile/:id',globalAuth, isOwn("id"), userController.updateProfileUser);


export default router;