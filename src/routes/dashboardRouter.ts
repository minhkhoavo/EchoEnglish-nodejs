import { Router } from 'express';
import dashboardController from '~/controllers/dashboardController.js';
import { RoleName } from '~/enum/role.js';
import { hasAuthority } from '~/middleware/authMiddleware.js';

const router = Router();

// Tất cả API yêu cầu quyền admin
router.get(
    '/users',
    hasAuthority(RoleName.ADMIN),
    dashboardController.getUserStats
);

router.get(
    '/tests',
    hasAuthority(RoleName.ADMIN),
    dashboardController.getTestStats
);

router.get(
    '/payments',
    hasAuthority(RoleName.ADMIN),
    dashboardController.getPaymentStats
);

router.get(
    '/resources',
    hasAuthority(RoleName.ADMIN),
    dashboardController.getResourceStats
);

export default router;
