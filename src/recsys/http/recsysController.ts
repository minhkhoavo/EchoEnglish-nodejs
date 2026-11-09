import { Request, Response } from 'express';
import ApiResponse from '../../dto/response/apiResponse.js';
import { ApiError } from '../../middleware/apiError.js';
import { eventService } from '../events/eventService.js';
import { consentService } from '../privacy/consentService.js';
import { dataSubjectService } from '../privacy/dataSubjectService.js';
import { recommenderService } from '../engine/recommender.js';
import { kpiService } from '../analytics/kpiService.js';
import { PipelineRun } from '../etl/models.js';
import { recsysConfig } from '../config.js';
import { checkHealth } from '../analytics/healthService.js';
import { exposureService } from '../engine/exposureService.js';
import { ModelError, modelRegistry } from '../learning/registry.js';
import { retrainService } from '../learning/retrain.js';
import { RegionError, regionService } from '../stream/regions.js';

const uid = (req: Request): string => {
    const id = req.user?.id;
    if (!id) throw new ApiError({ message: 'Unauthorized', status: 401 });
    return id;
};
const bad = (message: string) => new ApiError({ message, status: 400 });
const platformSource = (v: unknown) =>
    v === 'ios' || v === 'android' ? v : 'web';

const modelErr = (e: unknown) => {
    if (!(e instanceof ModelError)) return e;
    return new ApiError({
        message: e.message,
        status: e.code === 'not_found' ? 404 : 400,
    });
};
const versionParam = (req: Request) => {
    const v = Number(req.params.version);
    if (!Number.isInteger(v) || v < 1) throw bad('invalid model version');
    return v;
};

class RecsysController {
    /** POST /events/batch  { events: [...] }  (client behavioural events only) */
    ingest = async (req: Request, res: Response) => {
        const events = req.body?.events;
        if (!Array.isArray(events)) throw bad('events must be an array');
        if (events.length > recsysConfig.maxBatchSize) {
            throw bad(`max ${recsysConfig.maxBatchSize} events per batch`);
        }
        const result = await eventService.ingest(uid(req), events, {
            source: platformSource(req.headers['x-client-platform']),
        });
        return res
            .status(200)
            .json(new ApiResponse('Events processed', result));
    };

    getConsent = async (req: Request, res: Response) =>
        res
            .status(200)
            .json(new ApiResponse('OK', await consentService.get(uid(req))));

    /** PUT /privacy/consent { analytics?: boolean, personalization?: boolean, research?: boolean } */
    updateConsent = async (req: Request, res: Response) => {
        const body = req.body ?? {};
        const touched = ['analytics', 'personalization', 'research'].filter(
            (k) => typeof body[k] === 'boolean'
        );
        if (touched.length === 0)
            throw bad('provide at least one boolean purpose');
        const state = await consentService.update(
            uid(req),
            body,
            platformSource(body.channel)
        );
        recommenderService.clearCache();
        return res.status(200).json(new ApiResponse('Consent updated', state));
    };

    withdrawConsent = async (req: Request, res: Response) => {
        const state = await consentService.withdrawAll(uid(req));
        recommenderService.clearCache();
        return res
            .status(200)
            .json(new ApiResponse('Consent withdrawn', state));
    };

    exportData = async (req: Request, res: Response) =>
        res
            .status(200)
            .json(
                new ApiResponse(
                    'OK',
                    await dataSubjectService.exportUserData(uid(req))
                )
            );

    eraseData = async (req: Request, res: Response) =>
        res
            .status(200)
            .json(
                new ApiResponse(
                    'Data erased',
                    await dataSubjectService.eraseUserData(uid(req))
                )
            );

    /** GET /recommendations?limit=5&refresh=true */
    recommendations = async (req: Request, res: Response) => {
        const limit = Number.parseInt(String(req.query.limit ?? ''), 10);
        const data = await recommenderService.recommend(uid(req), {
            limit: Number.isFinite(limit) ? limit : undefined,
            refresh: req.query.refresh === 'true',
        });
        return res.status(200).json(new ApiResponse('OK', data));
    };

    /**
     * POST /recommendations/feedback
     * { recId, itemType, itemRef, action: click|complete|dismiss, variant, mode?, reason?, outcome? }
     * Updates the functional repetition guard (always) and emits the analytics event (consent-gated).
     */
    feedback = async (req: Request, res: Response) => {
        const b = req.body ?? {};
        const action = b.action as 'click' | 'complete' | 'dismiss';
        if (!['click', 'complete', 'dismiss'].includes(action))
            throw bad('action must be click|complete|dismiss');
        if (typeof b.itemType !== 'string' || typeof b.itemRef !== 'string')
            throw bad('itemType and itemRef are required');
        if (typeof b.recId !== 'string' || typeof b.variant !== 'string')
            throw bad('recId and variant are required');
        const userId = uid(req);
        await exposureService.recordFeedback(
            userId,
            `${b.itemType}:${b.itemRef}`,
            action,
            { reason: typeof b.reason === 'string' ? b.reason : undefined }
        );
        recommenderService.invalidate(userId);
        const type =
            action === 'click'
                ? 'rec_click'
                : action === 'complete'
                  ? 'rec_complete'
                  : 'rec_dismiss';
        await eventService.emitAsync(userId, type, {
            recId: b.recId,
            itemType: b.itemType,
            itemRef: b.itemRef,
            variant: b.variant,
            ...(b.mode ? { mode: b.mode } : {}),
            ...(action === 'dismiss' && b.reason ? { reason: b.reason } : {}),
            ...(action === 'complete' && typeof b.outcome === 'number'
                ? { outcome: b.outcome }
                : {}),
        });
        return res.status(200).json(new ApiResponse('Feedback recorded'));
    };

    kpis = async (req: Request, res: Response) => {
        const windowDays = Number.parseInt(
            String(req.query.windowDays ?? ''),
            10
        );
        const data = await kpiService.overview({
            windowDays: Number.isFinite(windowDays) ? windowDays : undefined,
        });
        return res.status(200).json(new ApiResponse('OK', data));
    };

    experiments = async (_req: Request, res: Response) =>
        res
            .status(200)
            .json(new ApiResponse('OK', await kpiService.experiments()));

    /** GET /admin/recsys/models */
    models = async (_req: Request, res: Response) =>
        res.status(200).json(new ApiResponse('OK', await modelRegistry.list()));

    /** POST /admin/recsys/models/retrain  { dryRun?: boolean } */
    retrain = async (req: Request, res: Response) =>
        res.status(200).json(
            new ApiResponse(
                'OK',
                await retrainService.run({
                    force: true,
                    dryRun: req.body?.dryRun === true,
                })
            )
        );

    /** POST /admin/recsys/models/:version/activate  { allocationPct } (admin may go up to 50%) */
    activateModel = async (req: Request, res: Response) => {
        try {
            const m = await modelRegistry.activate(
                versionParam(req),
                Number(req.body?.allocationPct),
                'admin'
            );
            return res.status(200).json(new ApiResponse('OK', m));
        } catch (e) {
            throw modelErr(e);
        }
    };

    retireModel = async (req: Request, res: Response) => {
        try {
            await modelRegistry.retire(
                versionParam(req),
                String(req.body?.reason ?? 'retired by admin')
            );
            return res
                .status(200)
                .json(new ApiResponse('OK', { retired: true }));
        } catch (e) {
            throw modelErr(e);
        }
    };

    /** PUT /admin/recsys/learners/:userId/region  { region }  — residency tag (affects FUTURE exports). */
    setRegion = async (req: Request, res: Response) => {
        try {
            await regionService.set(
                String(req.params.userId),
                String(req.body?.region ?? ''),
                'admin'
            );
            return res.status(200).json(
                new ApiResponse('OK', {
                    region: String(req.body.region).trim().toLowerCase(),
                })
            );
        } catch (e) {
            if (e instanceof RegionError) throw bad(e.message);
            throw e;
        }
    };

    health = async (_req: Request, res: Response) => {
        const report = await checkHealth();
        return res
            .status(report.status === 'down' ? 503 : 200)
            .json(new ApiResponse(report.status, report));
    };

    pipeline = async (_req: Request, res: Response) => {
        const runs = await PipelineRun.find()
            .sort({ startedAt: -1 })
            .limit(20)
            .select('-_id')
            .lean();
        return res.status(200).json(new ApiResponse('OK', runs));
    };
}

export default new RecsysController();
