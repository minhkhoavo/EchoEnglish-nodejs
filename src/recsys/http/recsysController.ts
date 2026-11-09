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

const uid = (req: Request): string => {
    const id = req.user?.id;
    if (!id) throw new ApiError({ message: 'Unauthorized', status: 401 });
    return id;
};
const bad = (message: string) => new ApiError({ message, status: 400 });
const platformSource = (v: unknown) =>
    v === 'ios' || v === 'android' ? v : 'web';

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
