import { Router } from 'express';
import { resourceController } from '~/controllers/resourceController.js';
import { hasAuthority } from '~/middleware/authMiddleware.js';
import { Role } from '~/enum/role.js';

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
    hasAuthority(Role.ADMIN),
    resourceController.createArticle
);
router.put(
    '/articles/:id',
    hasAuthority(Role.ADMIN),
    resourceController.updateArticle
);

// Knowledge Base routes
router.post(
    '/knowledge/reindex',
    hasAuthority(Role.ADMIN),
    resourceController.reindexKnowledge
);
router.post('/knowledge/query', resourceController.queryKnowledge);

// General admin routes
router.put(
    '/:id',
    hasAuthority(Role.ADMIN),
    resourceController.updateResourceHandler
);
router.delete(
    '/:id',
    hasAuthority(Role.ADMIN),
    resourceController.deleteResourceHandler
);
router.get('/rss/trigger', resourceController.triggerRssHandler);

export default router;
