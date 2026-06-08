import { Router } from 'express';
import notificationsController from '~/controllers/notificationsController.js';
import { Role } from '~/enum/role.js';
import { hasAuthority } from '~/middleware/authMiddleware.js';

const router = Router();

router.post(
    '',
    hasAuthority(Role.ADMIN),
    notificationsController.pushNotification
);
router.get('', notificationsController.getAllNotificationsForUser);
router.get('/unread-count', notificationsController.getUnreadCount);
router.put('/read/all', notificationsController.markAllAsRead);
router.put('/read/:id', notificationsController.markAsRead);
router.delete('/:id', notificationsController.softDeleteNotification);

export default router;
