// routes/resourceRoutes.ts
import { Router } from "express";
import { resourceController } from "~/controllers/resourceController";

const router = Router();

router.put("/:id", resourceController.updateResourceHandler);
router.delete("/:id", resourceController.deleteResourceHandler);
router.post("/rss/trigger", resourceController.triggerRssHandler);

export default router;
