import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import recsysRouter from '~/recsys/http/routes.js';
import ErrorMiddleware from '~/middleware/errorMiddleware.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
import { RecServed } from '~/recsys/engine/servedModel.js';
import { RecExposure } from '~/recsys/engine/exposureModel.js';
import { Consent, ConsentLedger } from '~/recsys/privacy/consentModel.js';
import {
    CleanEvent,
    DailyFacts,
    PipelineLock,
    PipelineRun,
} from '~/recsys/etl/models.js';
import {
    LearnerFeatures,
    SkillMastery,
} from '~/recsys/features/featureModels.js';
import {
    ItemDifficulty,
    MIN_ITEM_ANSWERS,
} from '~/recsys/features/itemDifficulty.js';
import { consentService } from '~/recsys/privacy/consentService.js';
import { mongoDeps, recommenderService } from '~/recsys/engine/recommender.js';
import { pipelineService } from '~/recsys/etl/pipeline.js';
import { featureBuilder } from '~/recsys/features/featureBuilder.js';
import { eventService } from '~/recsys/events/eventService.js';
import {
    loadExploreLogs,
    loadTrainingRows,
} from '~/recsys/learning/dataset.js';
import { kpiService } from '~/recsys/analytics/kpiService.js';
import { Resource } from '~/models/resource.js';

jest.setTimeout(180_000);
const userId = new mongoose.Types.ObjectId().toString();
const otherId = new mongoose.Types.ObjectId().toString();

function appFor(id: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        (req as unknown as { user: unknown }).user = {
            id,
            scope: 'USER',
            email: 'x@y.z',
        };
        next();
    });
    app.use('/', recsysRouter);
    app.use(ErrorMiddleware.handleError);
    return app;
}
const settle = () => new Promise((r) => setTimeout(r, 250));

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
        RecExposure,
        RecServed,
        ItemDifficulty,
        Resource
    );
});
afterAll(stopMongo);
beforeEach(async () => {
    process.env.RECSYS_EXPLORE_PCT = '0';
    await clearDb();
    consentService.clearCache();
    recommenderService.clearCache();
});

describe('served-list log and feedback attribution (T4.1)', () => {
    it('stores every served list; signals and the pool only with analytics consent', async () => {
        const a = appFor(userId);
        const first = (await request(a).get('/recommendations?refresh=true'))
            .body.data;
        const stored = await RecServed.findOne({ recId: first.recId }).lean<{
            userId: mongoose.Types.ObjectId;
            variant: string;
            mode: string;
            segment: string;
            items: Array<{
                itemRef: string;
                position: number;
                signals?: unknown;
            }>;
            pool?: unknown[];
            expireAt: Date;
        }>();
        expect(stored!.userId.toString()).toBe(userId);
        expect(stored).toMatchObject({
            variant: first.variant,
            mode: 'cold_start',
            segment: 'new',
        });
        expect(stored!.items.map((i) => i.itemRef)).toEqual(
            first.items.map((i: { ref: string }) => i.ref)
        );
        expect(stored!.items.every((i) => i.signals === undefined)).toBe(true);
        expect(stored!.pool).toBeUndefined();
        expect(stored!.expireAt.getTime()).toBeGreaterThan(Date.now());

        await request(a).put('/privacy/consent').send({ analytics: true });
        const second = (await request(a).get('/recommendations?refresh=true'))
            .body.data;
        const withConsent = await RecServed.findOne({
            recId: second.recId,
        }).lean<{ items: Array<{ signals?: unknown }>; pool?: unknown[] }>();
        expect(withConsent!.items.every((i) => i.signals !== undefined)).toBe(
            true
        );
        expect(Array.isArray(withConsent!.pool)).toBe(true);
    });

    it('a client cannot move its feedback into another experiment arm', async () => {
        const a = appFor(userId);
        await request(a).put('/privacy/consent').send({ analytics: true });
        const list = (await request(a).get('/recommendations?refresh=true'))
            .body.data;
        const t = list.items[0];
        const fb = await request(a).post('/recommendations/feedback').send({
            recId: list.recId,
            itemType: t.type,
            itemRef: t.ref,
            action: 'click',
            variant: 'learned', // forged
            mode: 'personalized', // forged
        });
        expect(fb.body.data).toEqual({ attributed: true });
        await settle();
        const click = await LearningEvent.findOne({ type: 'rec_click' }).lean<{
            props: Record<string, unknown>;
        }>();
        expect(click!.props).toMatchObject({
            variant: list.variant,
            mode: list.mode,
            position: 0,
        });
    });

    it('feedback on a list that was never served to this user produces no analytics', async () => {
        const mine = appFor(userId);
        const theirs = appFor(otherId);
        await request(mine).put('/privacy/consent').send({ analytics: true });
        await request(theirs).put('/privacy/consent').send({ analytics: true });
        const list = (
            await request(theirs).get('/recommendations?refresh=true')
        ).body.data;
        const t = list.items[0];
        for (const recId of [list.recId, 'made-up']) {
            const fb = await request(mine)
                .post('/recommendations/feedback')
                .send({
                    recId,
                    itemType: t.type,
                    itemRef: t.ref,
                    action: 'click',
                });
            expect(fb.status).toBe(200);
            expect(fb.body.data).toEqual({ attributed: false });
        }
        // an item that was not in my own list is not attributed either
        const own = (await request(mine).get('/recommendations?refresh=true'))
            .body.data;
        const fb = await request(mine)
            .post('/recommendations/feedback')
            .send({
                recId: own.recId,
                itemType: 'resource',
                itemRef: 'f'.repeat(24),
                action: 'click',
            });
        expect(fb.body.data).toEqual({ attributed: false });
        await settle();
        expect(await LearningEvent.countDocuments({ type: 'rec_click' })).toBe(
            0
        );
    });

    it('client-batched rec events are checked the same way', async () => {
        const a = appFor(userId);
        await request(a).put('/privacy/consent').send({ analytics: true });
        const list = (await request(a).get('/recommendations?refresh=true'))
            .body.data;
        const t = list.items[0];
        const ev = (recId: string) => ({
            eventId: randomUUID(),
            schemaVersion: 1,
            type: 'rec_click',
            occurredAt: new Date().toISOString(),
            props: {
                recId,
                itemType: t.type,
                itemRef: t.ref,
                variant: 'learned',
            },
        });
        const res = await request(a)
            .post('/events/batch')
            .send({ events: [ev(list.recId), ev('forged-rec')] });
        expect(res.body.data.accepted).toBe(1);
        expect(res.body.data.rejected).toEqual([
            { index: 1, reason: 'recId/item was not served to this user' },
        ]);
        const click = await LearningEvent.findOne({ type: 'rec_click' }).lean<{
            props: { variant: string; position: number };
        }>();
        expect(click!.props.variant).toBe(list.variant);
        expect(click!.props.position).toBe(0);
    });

    it('export includes and erasure removes the served-list log', async () => {
        const a = appFor(userId);
        await request(a).get('/recommendations?refresh=true');
        const exp = (await request(a).get('/privacy/export')).body.data;
        expect(exp.servedRecommendations).toHaveLength(1);
        const del = (await request(a).delete('/privacy/data')).body.data;
        expect(del.deleted.servedRecommendations).toBe(1);
        expect(await RecServed.countDocuments({})).toBe(0);
    });
});

/** A learner with a weak and a strong skill, personalisation + analytics consent. */
async function personalisedLearner(id = userId) {
    await consentService.update(
        id,
        { analytics: true, personalization: true },
        'web'
    );
    await eventService.emitManyAsync(id, [
        ...Array.from({ length: 12 }, (_, i) => ({
            type: 'question_answered' as const,
            props: {
                skillKey: 'p5.wordform',
                correct: i % 4 === 0,
                origin: 'drill',
            },
        })),
        ...Array.from({ length: 12 }, () => ({
            type: 'question_answered' as const,
            props: {
                skillKey: 'p6.conjunction',
                correct: false,
                origin: 'drill',
            },
        })),
    ]);
    await pipelineService.runOnce({
        afterFacts: (ids) => featureBuilder.buildMany(ids),
    });
}

describe('exploration is logged end to end (T4.2, T4.5, T4.9)', () => {
    it('an explored list records slot, propensity and pool; impressions carry the flags', async () => {
        process.env.RECSYS_EXPLORE_PCT = '30';
        await personalisedLearner();
        await Resource.insertMany(
            Array.from({ length: 12 }, (_, i) => ({
                type: 'article',
                title: `Grammar ${i}`,
                suitableForLearners: true,
                publishedAt: new Date(Date.now() - i * 86_400_000),
                labels: { cefr: 'B1', topic: ['grammar', 'word form'] },
            }))
        );
        const a = appFor(userId);
        type Explored = {
            recId: string;
            explore: { slot: number; propensity: number };
            items: Array<{ explored?: boolean; position: number }>;
            pool: unknown[];
        };
        let explored: Explored | null = null;
        for (let i = 0; i < 60 && !explored; i++) {
            await request(a).get('/recommendations?refresh=true');
            explored = await RecServed.findOne({
                explore: { $exists: true },
            }).lean<Explored | null>();
        }
        expect(explored).not.toBeNull();
        const slotItem = explored!.items.find((i) => i.explored)!;
        expect(slotItem.position).toBe(explored!.explore.slot);
        expect(explored!.explore.propensity).toBeCloseTo(
            1 / explored!.pool.length
        );
        await settle();
        const imp = await LearningEvent.findOne({
            type: 'rec_impression',
            'props.recId': explored!.recId,
            'props.explored': true,
        }).lean<{
            props: { propensity: number; segment: string; position: number };
        }>();
        expect(imp!.props.position).toBe(explored!.explore.slot);
        expect(imp!.props.propensity).toBeCloseTo(explored!.explore.propensity);
        expect(imp!.props.segment).toBe('established');

        // the exploration log is usable by the counterfactual estimator
        const since = new Date(Date.now() - 86_400_000);
        const rows = await loadTrainingRows(since);
        expect(rows.every((r) => r.segment === 'established')).toBe(true); // serve-time value
        expect(rows.some((r) => r.explored)).toBe(true);
        const logs = await loadExploreLogs(since, rows);
        expect(logs.length).toBeGreaterThan(0);
        expect(logs[0].pool.map((p) => p.id)).toContain(logs[0].pickedId);
    });
});

describe('training label = click that led to verified learning (T4.4)', () => {
    afterEach(() => delete process.env.RECSYS_TRAIN_LABEL);

    it('a click with no follow-up is not a positive; a click followed by the activity is', async () => {
        await personalisedLearner();
        const a = appFor(userId);
        const list = (await request(a).get('/recommendations?refresh=true'))
            .body.data;
        const drills = list.items.filter(
            (i: { type: string }) => i.type === 'skill_drill'
        );
        expect(drills.length).toBe(2);
        for (const d of drills)
            await request(a).post('/recommendations/feedback').send({
                recId: list.recId,
                itemType: d.type,
                itemRef: d.ref,
                action: 'click',
            });
        // the learner then really practises only the FIRST recommended skill
        await eventService.emitManyAsync(userId, [
            {
                type: 'question_answered',
                occurredAt: new Date(Date.now() + 60_000),
                props: {
                    skillKey: drills[0].ref,
                    correct: true,
                    origin: 'drill',
                },
            },
        ]);
        await settle();

        const since = new Date(Date.now() - 3_600_000);
        const rows = await loadTrainingRows(since);
        const byRef = (ref: string) =>
            rows.find((r) => r.itemKey === `${list.recId}|skill_drill|${ref}`)!;
        expect(byRef(drills[0].ref)).toMatchObject({
            clicked: true,
            label: true,
        });
        expect(byRef(drills[1].ref)).toMatchObject({
            clicked: true,
            label: false,
        });
        expect(
            rows.filter((r) => !r.clicked).every((r) => r.label === false)
        ).toBe(true);

        process.env.RECSYS_TRAIN_LABEL = 'click';
        const clickRows = await loadTrainingRows(since);
        expect(clickRows.filter((r) => r.label).length).toBe(2);
    });
});

describe('experiment read-out (T4.6)', () => {
    it('adds per-learner statistics, the sample-ratio check and outcomes', async () => {
        await personalisedLearner();
        const a = appFor(userId);
        await request(a).get('/recommendations?refresh=true');
        await settle();
        const e = await kpiService.experiments();
        expect(e.variants.length).toBe(1);
        expect(e.variants[0].perLearner).toMatchObject({ learners: 1 });
        expect(e.sampleRatio).toMatchObject({ learners: 1 });
        expect(e.outcomes[0]).toMatchObject({ learners: 1 });
    });
});

describe('item difficulty calibration (T4.8)', () => {
    it('counts each answer once even when the ETL re-reads it, and feeds the mastery update', async () => {
        const testId = new mongoose.Types.ObjectId().toString();
        const answer = (u: string, correct: boolean) =>
            eventService.emitManyAsync(u, [
                {
                    type: 'question_answered',
                    props: {
                        skillKey: 'p5.wordform',
                        correct,
                        difficulty: 'beginner',
                        testId,
                        questionNumber: 101,
                        origin: 'test',
                    },
                },
            ]);
        // a question labelled "beginner" that almost everyone gets wrong
        for (let i = 0; i < MIN_ITEM_ANSWERS + 5; i++)
            await answer(new mongoose.Types.ObjectId().toString(), i === 0);
        await pipelineService.runOnce();
        const key = `${testId}:101`;
        const first = await ItemDifficulty.findById(key).lean<{
            n: number;
            correct: number;
        }>();
        expect(first).toMatchObject({ n: MIN_ITEM_ANSWERS + 5, correct: 1 });

        // force the same bronze rows through the ETL again: silver upserts are no-ops
        await LearningEvent.updateMany(
            {},
            { $set: { 'processing.status': 'pending' } }
        );
        await pipelineService.runOnce();
        const again = await ItemDifficulty.findById(key).lean<{ n: number }>();
        expect(again!.n).toBe(MIN_ITEM_ANSWERS + 5);

        // two learners answer correctly: one this hard question, one an unmeasured beginner item
        const onHard = new mongoose.Types.ObjectId().toString();
        const onPlain = new mongoose.Types.ObjectId().toString();
        await answer(onHard, true);
        await eventService.emitManyAsync(onPlain, [
            {
                type: 'question_answered',
                props: {
                    skillKey: 'p5.wordform',
                    correct: true,
                    difficulty: 'beginner',
                    origin: 'test',
                },
            },
        ]);
        await pipelineService.runOnce();
        await featureBuilder.updateMastery(onHard);
        await featureBuilder.updateMastery(onPlain);
        const theta = async (u: string) =>
            (await SkillMastery.findOne({ userId: u }).lean<{
                theta: number;
            }>())!.theta;
        expect(await theta(onHard)).toBeGreaterThan(await theta(onPlain));
    });
});

describe('index-backed retrieval (T4.7)', () => {
    it('finds an old resource that matches a weak-skill topic, beyond the newest slice', async () => {
        const day = 86_400_000;
        await Resource.insertMany([
            ...Array.from({ length: 130 }, (_, i) => ({
                type: 'article',
                title: `Recent ${i}`,
                suitableForLearners: true,
                publishedAt: new Date(Date.now() - i * 3_600_000),
                labels: { cefr: 'C2', topic: ['sports'] },
            })),
            {
                type: 'article',
                title: 'Old but exactly right',
                suitableForLearners: true,
                publishedAt: new Date(Date.now() - 900 * day),
                labels: { cefr: 'C2', topic: ['Word Form'] },
            },
            {
                type: 'article',
                title: 'Old and unsuitable',
                suitableForLearners: false,
                publishedAt: new Date(Date.now() - 900 * day),
                labels: { cefr: 'C2', topic: ['word form'] },
            },
        ]);
        const profile = { interests: [], studyMinutesPerDay: 30 };
        const blind = await mongoDeps.loadResources(profile);
        expect(blind.map((r) => r.title)).not.toContain(
            'Old but exactly right'
        );
        expect(blind.length).toBe(100);

        const found = await mongoDeps.loadResources(profile, {
            cefr: [],
            topics: ['word form'],
            popularIds: [],
        });
        const titles = found.map((r) => r.title);
        expect(titles).toContain('Old but exactly right');
        expect(titles).not.toContain('Old and unsuitable');
    });

    it('the retrieval queries are served by the new indexes', async () => {
        const plan = await Resource.find({
            suitableForLearners: true,
            'labels.topic': { $in: ['grammar'] },
        })
            .sort({ publishedAt: -1 })
            .limit(10)
            .explain('queryPlanner');
        expect(JSON.stringify(plan)).toMatch(/IXSCAN/);
        expect(JSON.stringify(plan)).not.toMatch(/COLLSCAN/);
    });
});
