import { Router } from 'express';
import { resourceController } from '~/controllers/resourceController.js';
import { hasAuthority } from '~/middleware/authMiddleware.js';
import { RoleName } from '~/enum/role.js';

const router = Router();

// Public routes
router.get('', resourceController.searchResource);
router.get('/:id', resourceController.getResourceById);

// Transcript (YouTube)
router.post('', resourceController.getTranscriptHanlder);
router.post('/save', resourceController.saveTranscriptHandler);

// Admin Article routes
router.post(
    '/articles',
    hasAuthority(RoleName.ADMIN),
    resourceController.createArticle
);
router.put(
    '/articles/:id',
    hasAuthority(RoleName.ADMIN),
    resourceController.updateArticle
);

// Knowledge Base routes
router.post(
    '/knowledge/reindex',
    hasAuthority(RoleName.ADMIN),
    resourceController.reindexKnowledge
);
router.post('/knowledge/query', resourceController.queryKnowledge);

// General admin routes
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
