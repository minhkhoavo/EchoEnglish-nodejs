import { Router } from 'express';
import UserController from '~/controllers/userController.js';
import { RoleName } from '~/enum/role.js';
import { hasAuthority } from '~/middleware/authMiddleware.js';
const router = Router();
const userController = new UserController();

router.put('/my-profile', userController.updateProfileUser);
router.post('', hasAuthority(RoleName.ADMIN), userController.createUser);
router.get('', hasAuthority(RoleName.ADMIN), userController.getAllUsers);
router.get('/credits', userController.getCredit);
router.get('/:id', userController.getUserById);
router.delete(
    '/:id',
    hasAuthority(RoleName.ADMIN),
    userController.softDeleteUser
);
router.put('/:id', hasAuthority(RoleName.ADMIN), userController.updateUser);

export default router;
