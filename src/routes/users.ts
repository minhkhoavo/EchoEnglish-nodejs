import { Router } from 'express';
import UserController from '~/controllers/userController.js';
import { RoleName } from '~/enum/role.js';
import { hasAuthority } from '~/middleware/authMiddleware.js';
import { competencyProfileController } from '~/controllers/competencyProfileController.js';

const router = Router();
const userController = new UserController();

// Competency Profile routes
router.post(
    '/competency-profile/update-from-test',
    competencyProfileController.updateFromTestResult
);
router.get(
    '/competency-profile/profile',
    competencyProfileController.getProfile
);
router.get(
    '/competency-profile/skill-progress',
    competencyProfileController.getSkillProgress
);
router.get(
    '/competency-profile/weak-skills',
    competencyProfileController.getWeakSkills
);

router.get(
    '/competency-profile/insights',
    competencyProfileController.getDailyInsights
);

router.get('/preferences', userController.getUserPreference);
router.put('/preferences', userController.setUserPreferences);
router.put('/my-profile', userController.updateProfileUser);
router.get('/credits', userController.getCredit);
router.get('/:id', userController.getUserById);
router.delete(
    '/:id',
    hasAuthority(RoleName.ADMIN),
    userController.softDeleteUser
);
router.put('/:id', hasAuthority(RoleName.ADMIN), userController.updateUser);

router.post('', hasAuthority(RoleName.ADMIN), userController.createUser);
router.get('', hasAuthority(RoleName.ADMIN), userController.getAllUsers);
export default router;
