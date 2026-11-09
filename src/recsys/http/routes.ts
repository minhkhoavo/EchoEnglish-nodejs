import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import controller from './recsysController.js';
import { hasAuthority } from '../../middleware/authMiddleware.js';
import { Role } from '../../enum/role.js';

/** Per-user limiter (all routes here are authenticated, so req.user is always set). */
const perUser = (limit: number, windowMs = 60_000) =>
    rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id ?? 'anonymous',
        message: { message: 'Too many requests, please slow down.' },
    });

const router = Router();

router.post('/events/batch', perUser(60), controller.ingest);

router.get('/privacy/consent', controller.getConsent);
router.put('/privacy/consent', perUser(20), controller.updateConsent);
router.post(
    '/privacy/consent/withdraw',
    perUser(20),
    controller.withdrawConsent
);
router.get('/privacy/export', perUser(5, 3_600_000), controller.exportData);
router.delete('/privacy/data', perUser(3, 3_600_000), controller.eraseData);

router.get('/recommendations', perUser(30), controller.recommendations);

router.get('/admin/recsys/kpis', hasAuthority(Role.ADMIN), controller.kpis);
router.get(
    '/admin/recsys/experiments',
    hasAuthority(Role.ADMIN),
    controller.experiments
);
router.get(
    '/admin/recsys/pipeline',
    hasAuthority(Role.ADMIN),
    controller.pipeline
);

export default router;
