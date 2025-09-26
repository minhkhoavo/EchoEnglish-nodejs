import { Router } from 'express';
import notificationsController from '~/controllers/notificationsController.js';
import { RoleName } from '~/enum/role.js';
import { hasAuthority } from '~/middleware/authMiddleware.js';

const router = Router();

router.post('', notificationsController.pushNotification);
router.get('', notificationsController.getAllNotificationsForUser);
router.post('/read/all', notificationsController.markAllAsRead);
router.post('/read/:id', notificationsController.markAsRead);
router.get(
    '/all',
    hasAuthority(RoleName.ADMIN),
    notificationsController.getBroadcastNotification
);

export default router;
