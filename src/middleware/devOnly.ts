import { Request, Response, NextFunction } from 'express';

/**
 * Guard for Playground / dry-run endpoints. They invoke the real generators
 * (and the real LLM) but never persist, so they must never be reachable in a
 * production deployment. Enabled when NODE_ENV !== 'production', or explicitly
 * via ENABLE_PLAYGROUND=true. Returns 404 (not 403) so the routes are
 * indistinguishable from non-existent ones when disabled.
 */
export function devOnly(req: Request, res: Response, next: NextFunction) {
    const enabled =
        process.env.NODE_ENV !== 'production' ||
        process.env.ENABLE_PLAYGROUND === 'true';

    if (!enabled) {
        return res.status(404).json({ message: 'Not found' });
    }

    return next();
}
