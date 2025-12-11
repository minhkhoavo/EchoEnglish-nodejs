import { Router } from 'express';
import dashboardController from '~/controllers/dashboardController.js';
import { Role } from '~/enum/role.js';
import { hasAuthority } from '~/middleware/authMiddleware.js';

const router = Router();

// Tất cả API yêu cầu quyền admin
router.get(
    '/users',
    hasAuthority(Role.ADMIN),
    dashboardController.getUserStats
);

router.get(
    '/tests',
    hasAuthority(Role.ADMIN),
    dashboardController.getTestStats
);

router.get(
    '/payments',
    hasAuthority(Role.ADMIN),
    dashboardController.getPaymentStats
);

router.get(
    '/resources',
    hasAuthority(Role.ADMIN),
    dashboardController.getResourceStats
);

export default router;
