import { Router } from 'express';
import { playgroundController } from '../controllers/playgroundController.js';
import { devOnly } from '../middleware/devOnly.js';

/**
 * Playground / dry-run endpoints for simulating the Roadmap and Daily Session
 * generators with full input parity and ZERO persistence. Guarded by devOnly so
 * they are never reachable in production. globalAuth still applies (the dev/admin
 * is logged in); userId defaults to req.user.id but can be overridden per request.
 */
const playgroundRouter = Router();

playgroundRouter.use(devOnly);

// Roadmap
playgroundRouter.post(
    '/roadmap/ai',
    playgroundController.roadmapAi.bind(playgroundController)
);
playgroundRouter.post(
    '/roadmap/pipeline',
    playgroundController.roadmapPipeline.bind(playgroundController)
);

// Daily Session
playgroundRouter.post(
    '/daily-session/ai',
    playgroundController.dailySessionAi.bind(playgroundController)
);
playgroundRouter.post(
    '/daily-session/pipeline',
    playgroundController.dailySessionPipeline.bind(playgroundController)
);

// Data loaders (read-only) — assemble real inputs so the admin can load & tweak
playgroundRouter.post(
    '/load/roadmap-input',
    playgroundController.loadRoadmapInput.bind(playgroundController)
);
playgroundRouter.post(
    '/load/daily-context',
    playgroundController.loadDailyContext.bind(playgroundController)
);

export default playgroundRouter;
