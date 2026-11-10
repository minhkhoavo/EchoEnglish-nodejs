import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import recsysRouter from '~/recsys/http/routes.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
import { RecExposure } from '~/recsys/engine/exposureModel.js';
import { Consent, ConsentLedger } from '~/recsys/privacy/consentModel.js';
import {
    CleanEvent,
    DailyFacts,
    PipelineRun,
    PipelineLock,
} from '~/recsys/etl/models.js';
import {
    SkillMastery,
    LearnerFeatures,
} from '~/recsys/features/featureModels.js';
import { consentService } from '~/recsys/privacy/consentService.js';
import { recommenderService } from '~/recsys/engine/recommender.js';
import { pipelineService } from '~/recsys/etl/pipeline.js';
import { featureBuilder } from '~/recsys/features/featureBuilder.js';
import { eventService } from '~/recsys/events/eventService.js';
import ErrorMiddleware from '~/middleware/errorMiddleware.js';
import { randomUUID } from 'node:crypto';
import { RecModel, modelRegistry } from '~/recsys/learning/registry.js';
import { retrainService } from '~/recsys/learning/retrain.js';

jest.setTimeout(120_000);
const userId = new mongoose.Types.ObjectId().toString();

function appFor(user: { id: string; scope: string } | null) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        if (user)
            (req as unknown as { user: unknown }).user = {
                ...user,
                email: 'x@y.z',
            };
        next();
    });
    app.use('/', recsysRouter);
    app.use(ErrorMiddleware.handleError);
    return app;
}
const userApp = () => appFor({ id: userId, scope: 'USER' });
const adminApp = () => appFor({ id: userId, scope: 'ADMIN' });
const view = (over: Record<string, unknown> = {}) => ({
    eventId: randomUUID(),
    schemaVersion: 1,
    type: 'resource_viewed',
    occurredAt: new Date().toISOString(),
    props: { resourceId: 'a'.repeat(24), dwellSec: 20 },
    ...over,
});

beforeAll(async () => {
    process.env.RECSYS_ENABLED = 'true';
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await startMongo();
    await syncIndexes(
        LearningEvent,
        Consent,
        ConsentLedger,
        CleanEvent,
        DailyFacts,
        PipelineRun,
        PipelineLock,
        SkillMastery,
        LearnerFeatures,
        RecExposure
    );
});
afterAll(stopMongo);
beforeEach(async () => {
    await clearDb();
    consentService.clearCache();
    recommenderService.clearCache();
});

describe('consent API', () => {
    it('defaults to nothing granted and updates per purpose with a ledger', async () => {
        const a = userApp();
        expect((await request(a).get('/privacy/consent')).body.data).toEqual({
            analytics: false,
            personalization: false,
            research: false,
        });
        const put = await request(a)
            .put('/privacy/consent')
            .send({ analytics: true });
        expect(put.status).toBe(200);
        expect(put.body.data).toMatchObject({
            analytics: true,
            personalization: false,
        });
        expect(await ConsentLedger.countDocuments({ userId })).toBe(1);
        expect((await request(a).put('/privacy/consent').send({})).status).toBe(
            400
        );
        const w = await request(a).post('/privacy/consent/withdraw');
        expect(w.body.data.analytics).toBe(false);
        expect(await ConsentLedger.countDocuments({ userId })).toBe(2);
    });
});

describe('POST /events/batch', () => {
    it('401 without a principal', async () => {
        const res = await request(appFor(null))
            .post('/events/batch')
            .send({ events: [] });
        expect(res.status).toBe(401);
    });
    it('400 for non-array and oversize batches', async () => {
        expect(
            (
                await request(userApp())
                    .post('/events/batch')
                    .send({ events: 'x' })
            ).status
        ).toBe(400);
        const big = Array.from({ length: 101 }, () => view());
        expect(
            (
                await request(userApp())
                    .post('/events/batch')
                    .send({ events: big })
            ).status
        ).toBe(400);
    });
    it('drops behavioural events without consent, accepts after, and ignores a spoofed userId', async () => {
        const a = userApp();
        const r1 = await request(a)
            .post('/events/batch')
            .send({ events: [view()] });
        expect(r1.body.data).toMatchObject({
            accepted: 0,
            droppedNoConsent: 1,
        });
        await request(a).put('/privacy/consent').send({ analytics: true });
        const spoof = view({
            userId: new mongoose.Types.ObjectId().toString(),
        });
        const r2 = await request(a)
            .post('/events/batch')
            .send({ events: [view(), spoof] });
        expect(r2.body.data.accepted).toBe(1);
        expect(r2.body.data.rejected).toHaveLength(1); // strict envelope rejects the userId field
        const stored = await LearningEvent.findOne().lean<{
            userId: { toString(): string };
        }>();
        expect(stored!.userId.toString()).toBe(userId);
    });
});

describe('GET /recommendations', () => {
    it('returns a cold-start list for a brand-new learner (starter diagnostic first)', async () => {
        const res = await request(userApp()).get('/recommendations?limit=5');
        expect(res.status).toBe(200);
        expect(res.body.data.mode).toBe('cold_start');
        expect(res.body.data.items[0].id).toBe('mock_test:starter');
        expect(res.body.data.items[0].reason.text.vi.length).toBeGreaterThan(
            10
        );
        expect(['control', 'srs_heavy']).toContain(res.body.data.variant);
    });

    it('closed loop: events → ETL → features → personalised recs → impressions logged', async () => {
        const a = userApp();
        await request(a)
            .put('/privacy/consent')
            .send({ analytics: true, personalization: true });
        const weak = Array.from({ length: 12 }, () => ({
            type: 'question_answered' as const,
            props: {
                skillKey: 'p5.wordform',
                correct: false,
                origin: 'drill',
                timeMs: 9000,
            },
        }));
        const strong = Array.from({ length: 12 }, () => ({
            type: 'question_answered' as const,
            props: {
                skillKey: 'p2.whquestion',
                correct: true,
                origin: 'drill',
                timeMs: 5000,
            },
        }));
        await eventService.emitManyAsync(userId, [
            ...weak,
            ...strong,
            {
                type: 'test_submitted' as const,
                props: {
                    testId: 'b'.repeat(24),
                    totalScore: 600,
                    correct: 100,
                    total: 200,
                    durationSec: 7000,
                },
            },
        ]);
        await pipelineService.runOnce({
            afterFacts: (ids) => featureBuilder.buildMany(ids),
        });

        const res = await request(a).get(
            '/recommendations?limit=5&refresh=true'
        );
        expect(res.body.data.mode).toBe('personalized');
        const ids = res.body.data.items.map((i: { id: string }) => i.id);
        expect(ids).toContain('skill_drill:p5.wordform');
        expect(ids).not.toContain('skill_drill:p2.whquestion'); // strong skill is not drilled
        const top = res.body.data.items.find(
            (i: { id: string }) => i.id === 'skill_drill:p5.wordform'
        );
        expect(top.reason.code).toBe('weak_skill');

        await new Promise((r) => setTimeout(r, 300)); // impressions are fire-and-forget
        const imps = await LearningEvent.countDocuments({
            type: 'rec_impression',
        });
        expect(imps).toBe(res.body.data.items.length);

        // training signals are logged per impression but never exposed to clients
        const logged = await LearningEvent.find({
            type: 'rec_impression',
        }).lean<
            Array<{
                props: { itemRef?: string; signals?: Record<string, number> };
            }>
        >();
        expect(logged.every((e) => e.props.signals !== undefined)).toBe(true);
        expect(
            logged.some((e) => Object.keys(e.props.signals ?? {}).length > 0)
        ).toBe(true);
        expect(JSON.stringify(res.body.data)).not.toContain('"signals"');
    });

    it('dismissals are honoured WITHOUT any consent (functional state), while analytics stays empty', async () => {
        const a = userApp(); // default-off consent: nothing granted
        const first = (await request(a).get('/recommendations?refresh=true'))
            .body.data;
        const target = first.items[0];
        const fb = await request(a).post('/recommendations/feedback').send({
            recId: first.recId,
            itemType: target.type,
            itemRef: target.ref,
            action: 'dismiss',
            variant: first.variant,
            mode: first.mode,
            reason: 'seen',
        });
        expect(fb.status).toBe(200);
        const second = (await request(a).get('/recommendations?refresh=true'))
            .body.data;
        expect(second.items.map((i: { id: string }) => i.id)).not.toContain(
            target.id
        );
        // no analytics consent → no behavioural event was stored
        expect(
            await LearningEvent.countDocuments({
                type: { $in: ['rec_impression', 'rec_dismiss'] },
            })
        ).toBe(0);
    });

    it('frequency cap works without consent: an item shown 3 times with no click stops being served', async () => {
        const a = userApp();
        let lastIds: string[] = [];
        for (let i = 0; i < 4; i++) {
            const r = (await request(a).get('/recommendations?refresh=true'))
                .body.data;
            lastIds = r.items.map((x: { id: string }) => x.id);
            await new Promise((res) => setTimeout(res, 150)); // exposure write is fire-and-forget
        }
        // cold-start list is [starter diagnostic, …]; after 3 impressions it is capped out
        expect(lastIds).not.toContain('mock_test:starter');
    });

    it('with analytics consent the same feedback also produces analytics events carrying variant and mode', async () => {
        const a = userApp();
        await request(a).put('/privacy/consent').send({ analytics: true });
        const first = (await request(a).get('/recommendations?refresh=true'))
            .body.data;
        const t = first.items[0];
        await request(a).post('/recommendations/feedback').send({
            recId: first.recId,
            itemType: t.type,
            itemRef: t.ref,
            action: 'click',
            variant: first.variant,
            mode: first.mode,
        });
        await new Promise((r) => setTimeout(r, 250));
        const click = await LearningEvent.findOne({ type: 'rec_click' }).lean<{
            props: { variant: string; mode: string };
        }>();
        expect(click!.props).toMatchObject({
            variant: first.variant,
            mode: 'cold_start',
        });
        const imp = await LearningEvent.findOne({
            type: 'rec_impression',
        }).lean<{ props: { mode: string } }>();
        expect(imp!.props.mode).toBe('cold_start');
    });

    it('feedback validates input', async () => {
        const a = userApp();
        expect(
            (
                await request(a)
                    .post('/recommendations/feedback')
                    .send({ action: 'nope' })
            ).status
        ).toBe(400);
        expect(
            (
                await request(a)
                    .post('/recommendations/feedback')
                    .send({ action: 'click', itemType: 'x', itemRef: 'y' })
            ).status
        ).toBe(400);
        // the item key is stored: only item types the recommender produces, bounded refs
        const ok = {
            action: 'click',
            recId: 'r1',
            variant: 'control',
            itemType: 'resource',
            itemRef: 'abc',
        };
        for (const bad of [
            { ...ok, itemType: 'anything' },
            { ...ok, itemRef: 'x'.repeat(81) },
            { ...ok, itemRef: '' },
            { ...ok, recId: 'r'.repeat(65) },
        ])
            expect(
                (await request(a).post('/recommendations/feedback').send(bad))
                    .status
            ).toBe(400);
        expect(
            (await request(a).post('/recommendations/feedback').send(ok)).status
        ).toBe(200);
    });
});

describe('privacy: export and erasure', () => {
    it('exports then erases everything and withdraws consent (ledger retained)', async () => {
        const a = userApp();
        await request(a)
            .put('/privacy/consent')
            .send({ analytics: true, personalization: true });
        await request(a)
            .post('/events/batch')
            .send({ events: [view()] });
        await eventService.emitManyAsync(userId, [
            {
                type: 'question_answered' as const,
                props: {
                    skillKey: 'p5.wordform',
                    correct: true,
                    origin: 'drill',
                },
            },
        ]);
        await pipelineService.runOnce({
            afterFacts: (ids) => featureBuilder.buildMany(ids),
        });
        await request(a).post('/recommendations/feedback').send({
            recId: 'r1',
            itemType: 'resource',
            itemRef: 'x',
            action: 'dismiss',
            variant: 'control',
        });

        const exp = await request(a).get('/privacy/export');
        expect(exp.body.data.recommendationState.length).toBe(1);
        expect(exp.body.data.events.length).toBe(3);
        expect(exp.body.data.dailyFacts.length).toBe(1);
        expect(exp.body.data.skillMastery.length).toBe(1);
        expect(exp.body.data.consentHistory.length).toBe(2);

        const del = await request(a).delete('/privacy/data');
        expect(del.body.data.deleted).toMatchObject({
            events: 3,
            dailyFacts: 1,
            skillMastery: 1,
            features: 1,
            recommendationState: 1,
        });
        for (const M of [
            LearningEvent,
            CleanEvent,
            DailyFacts,
            SkillMastery,
            LearnerFeatures,
            RecExposure,
        ]) {
            expect(await M.countDocuments({ userId })).toBe(0);
        }
        expect((await request(a).get('/privacy/consent')).body.data).toEqual({
            analytics: false,
            personalization: false,
            research: false,
        });
        expect(
            await ConsentLedger.countDocuments({ userId })
        ).toBeGreaterThanOrEqual(2); // proof retained
    });

    it("erasing one user does not touch another user's data", async () => {
        const other = new mongoose.Types.ObjectId().toString();
        await eventService.emitManyAsync(other, [
            {
                type: 'question_answered' as const,
                props: { skillKey: 'a', correct: true, origin: 'drill' },
            },
        ]);
        await request(userApp()).delete('/privacy/data');
        expect(await LearningEvent.countDocuments({ userId: other })).toBe(1);
    });
});

describe('admin endpoints', () => {
    it('are forbidden for normal users and available to admins', async () => {
        for (const path of [
            '/admin/recsys/kpis',
            '/admin/recsys/experiments',
            '/admin/recsys/pipeline',
        ]) {
            expect((await request(userApp()).get(path)).status).toBe(403);
            expect((await request(adminApp()).get(path)).status).toBe(200);
        }
    });
    it('health is admin-only and reports a status (503 only when down)', async () => {
        expect(
            (await request(userApp()).get('/admin/recsys/health')).status
        ).toBe(403);
        const res = await request(adminApp()).get('/admin/recsys/health');
        expect([200, 503]).toContain(res.status);
        expect(['ok', 'degraded', 'down']).toContain(res.body.data.status);
        expect(res.status === 503).toBe(res.body.data.status === 'down');
    });
    it('KPI overview works on an empty database (no NaN, suppressed cohorts)', async () => {
        const res = await request(adminApp()).get(
            '/admin/recsys/kpis?windowDays=30'
        );
        expect(res.status).toBe(200);
        expect(res.body.data.users).toMatchObject({ dau: 0, mau: 0 });
        expect(res.body.data.activation7d.rate).toBeNull();
        expect(JSON.stringify(res.body.data)).not.toMatch(/NaN|Infinity/);
    });
});

describe('model admin endpoints', () => {
    beforeEach(async () => {
        await RecModel.deleteMany({});
        modelRegistry.clearCache();
    });
    it('are admin-only', async () => {
        expect(
            (await request(userApp()).get('/admin/recsys/models')).status
        ).toBe(403);
        expect(
            (
                await request(userApp())
                    .post('/admin/recsys/models/retrain')
                    .send({})
            ).status
        ).toBe(403);
        expect(
            (
                await request(userApp())
                    .post('/admin/recsys/models/1/activate')
                    .send({ allocationPct: 5 })
            ).status
        ).toBe(403);
        expect(
            (await request(adminApp()).get('/admin/recsys/models')).status
        ).toBe(200);
    });
    it('retrain on an empty log is a safe no-op that registers a rejected model', async () => {
        const res = await request(adminApp())
            .post('/admin/recsys/models/retrain')
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            status: 'trained',
            activated: false,
        });
        const list = await request(adminApp()).get('/admin/recsys/models');
        expect(list.body.data[0]).toMatchObject({
            status: 'rejected',
            version: 1,
        });
    });
    it('maps registry errors to 4xx and never serves a rejected model', async () => {
        await retrainService
            .run({ force: true, rows: [] })
            .catch(() => undefined);
        await request(adminApp()).post('/admin/recsys/models/retrain').send({});
        const nf = await request(adminApp())
            .post('/admin/recsys/models/99/activate')
            .send({ allocationPct: 5 });
        expect(nf.status).toBe(404);
        const bad = await request(adminApp())
            .post('/admin/recsys/models/abc/activate')
            .send({ allocationPct: 5 });
        expect(bad.status).toBe(400);
        const rejected = await request(adminApp())
            .post('/admin/recsys/models/1/activate')
            .send({ allocationPct: 5 });
        expect(rejected.status).toBe(400);
        expect(rejected.body.message).toMatch(/rejected/);
    });
});
