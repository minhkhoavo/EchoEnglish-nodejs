import { Router } from 'express';
import UserController from '~/controllers/userController.js';
import { hasAuthority } from '~/middleware/authMiddleware.js';
const router = Router();
const userController = new UserController();

router.put('/my-profile', userController.updateProfileUser);
router.post('', hasAuthority('ADMIN'), userController.createUser);
router.get('/credits', userController.getCredit);
router.get('/:id', userController.getUserById);
router.delete('/:id', hasAuthority('ADMIN'), userController.softDeleteUser);
router.put('/:id', hasAuthority('ADMIN'), userController.updateUser);

export default router;
