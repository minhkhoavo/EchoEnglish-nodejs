// routes/resourceRoutes.ts
import { Router } from "express";
import { resourceController } from "~/controllers/resourceController.js";

const router = Router();
router.get('/', resourceController.searchResource);
router.post('/', resourceController.getTranscriptHanlder);
router.post('/save', resourceController.saveTranscriptHandler);
router.put("/:id", resourceController.updateResourceHandler);
router.delete("/:id", resourceController.deleteResourceHandler);
router.get("/rss/trigger", resourceController.triggerRssHandler);

export default router;