import { Router } from 'express';
import { resourceController } from '~/controllers/resourceController.js';
import { hasAuthority } from '~/middleware/authMiddleware.js';
import { RoleName } from '~/enum/role.js';

const router = Router();
router.get('/', resourceController.searchResource);
router.post('/', resourceController.getTranscriptHanlder);
router.post('/save', resourceController.saveTranscriptHandler);
router.put(
    '/:id',
    hasAuthority(RoleName.ADMIN),
    resourceController.updateResourceHandler
);
router.delete(
    '/:id',
    hasAuthority(RoleName.ADMIN),
    resourceController.deleteResourceHandler
);
router.get('/rss/trigger', resourceController.triggerRssHandler);

export default router;
