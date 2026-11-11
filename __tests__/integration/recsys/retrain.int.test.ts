import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
import { PipelineLock } from '~/recsys/etl/models.js';
import { FeatureSnapshot } from '~/recsys/featurestore/snapshotModel.js';
import {
    ModelError,
    RecModel,
    modelRegistry,
} from '~/recsys/learning/registry.js';
import { retrainService } from '~/recsys/learning/retrain.js';
import { loadTrainingRows } from '~/recsys/learning/dataset.js';
import { TrainingRow } from '~/recsys/learning/train.js';
import { rng } from '~/recsys/eval/simulator.js';
import { RecDeps, RecommenderService } from '~/recsys/engine/recommender.js';
import {
    assignVariant,
    bucket,
    LEARNED_LAYER,
} from '~/recsys/engine/experiments.js';
import { features } from '../../helpers/recFixtures.js';

jest.setTimeout(180_000);
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Rows where only explore/habit matter — very different from control, so a real lift exists. */
function rows(n: number, seed = 5): TrainingRow[] {
    const r = rng(seed);
    return Array.from({ length: n }, (_, i) => {
        const s = {
            need: r(),
            srs: r(),
            interest: r(),
            levelFit: r(),
            habit: r(),
            explore: r(),
            popularity: r(),
        };
        return {
            userId: `u${i % 500}`,
            recId: `r${i}`,
            signals: s,
            position: Math.floor(r() * 5),
            segment: 'established' as const,
            clicked: r() < sigmoid(-2.2 + 4 * s.explore + 2.5 * s.habit),
        };
    });
}
const GOOD = rows(15000);

beforeAll(async () => {
    process.env.RECSYS_RETRAIN_MIN_IMPRESSIONS = '5000';
    process.env.RECSYS_RETRAIN_MIN_CLICKS = '200';
    await startMongo();
    await syncIndexes(RecModel, LearningEvent, PipelineLock, FeatureSnapshot);
});
afterAll(stopMongo);
beforeEach(async () => {
    await clearDb();
    modelRegistry.clearCache();
    delete process.env.RECSYS_RETRAIN_ENABLED;
    delete process.env.RECSYS_FORCE_VARIANT;
});

describe('retraining service', () => {
    it('is disabled by default', async () => {
        expect((await retrainService.run({ rows: GOOD })).status).toBe(
            'disabled'
        );
        expect(await RecModel.countDocuments()).toBe(0);
    });

    it('trains, registers and goes live ONLY as a small challenger', async () => {
        const r = await retrainService.run({ force: true, rows: GOOD });
        expect(r).toMatchObject({
            status: 'trained',
            version: 1,
            activated: true,
        });
        const m = (await modelRegistry.getActive())!;
        expect(m.status).toBe('active');
        expect(m.allocationPct).toBe(5);
        expect(m.dataSource).toBe('production');
        expect(m.payload!.global.explore).toBeGreaterThan(0.3);
    });

    it('a dry run persists nothing', async () => {
        const r = await retrainService.run({
            force: true,
            dryRun: true,
            rows: GOOD,
        });
        expect(r.report!.gatePassed).toBe(true);
        expect(await RecModel.countDocuments()).toBe(0);
    });

    it('too little data → rejected and never activated', async () => {
        const r = await retrainService.run({ force: true, rows: rows(500) });
        expect(r.activated).toBe(false);
        expect(
            (await RecModel.findOne().lean<{ status: string }>())!.status
        ).toBe('rejected');
        expect(await modelRegistry.getActive()).toBeNull();
    });

    it('a model trained on synthetic data can never be served, even by an admin', async () => {
        const r = await retrainService.run({
            force: true,
            rows: GOOD,
            dataSource: 'synthetic',
        });
        expect(r.activated).toBe(false);
        const doc = await RecModel.findOne().lean<{
            status: string;
            version: number;
            reasons: string[];
        }>();
        expect(doc!.status).toBe('rejected');
        expect(doc!.reasons.join()).toMatch(/synthetic/);
        await expect(
            modelRegistry.activate(doc!.version, 5, 'admin')
        ).rejects.toMatchObject({ code: 'synthetic' });
    });

    it('a new model that does not beat the live one is not activated', async () => {
        await retrainService.run({ force: true, rows: GOOD });
        const again = await retrainService.run({ force: true, rows: GOOD }); // identical data → identical lift
        expect(again.status).toBe('trained');
        expect(again.activated).toBe(false);
        expect(again.reason).toMatch(/does not beat live model v1/);
        expect((await modelRegistry.getActive())!.version).toBe(1);
    });

    it('two concurrent runs never both train (lease)', async () => {
        const out = await Promise.all([
            retrainService.run({ force: true, rows: GOOD }),
            retrainService.run({ force: true, rows: GOOD }),
        ]);
        expect(out.map((o) => o.status).sort()).toContain('trained');
        expect(await RecModel.countDocuments()).toBeLessThanOrEqual(2);
        expect(await RecModel.countDocuments({ status: 'active' })).toBe(1);
    });
});

describe('registry rules', () => {
    beforeEach(async () => {
        await retrainService.run({ force: true, rows: GOOD });
    });
    it('auto allocation is capped at the challenger share; admins may go to 50%, not beyond', async () => {
        await expect(
            modelRegistry.activate(1, 6, 'auto')
        ).rejects.toMatchObject({ code: 'bad_allocation' });
        expect(
            (await modelRegistry.activate(1, 40, 'admin')).allocationPct
        ).toBe(40);
        await expect(
            modelRegistry.activate(1, 51, 'admin')
        ).rejects.toBeInstanceOf(ModelError);
        await expect(
            modelRegistry.activate(1, 0, 'admin')
        ).rejects.toMatchObject({ code: 'bad_allocation' });
        await expect(
            modelRegistry.activate(99, 5, 'admin')
        ).rejects.toMatchObject({ code: 'not_found' });
    });
    it('caches the active model: one DB read per TTL, not per call', async () => {
        modelRegistry.clearCache();
        const spy = jest.spyOn(RecModel, 'findOne');
        await modelRegistry.getActive();
        await modelRegistry.getActive();
        await modelRegistry.getActive();
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
    it('retire removes it from service', async () => {
        await modelRegistry.retire(1, 'test');
        expect(await modelRegistry.getActive()).toBeNull();
    });
});

describe('training data comes from logs joined to the feature store AS OF impression time', () => {
    it('labels clicks, restricts to personalised lists, and never uses a later snapshot', async () => {
        const u = new mongoose.Types.ObjectId();
        const uid = u.toString();
        const mk = (
            type: string,
            at: Date,
            props: Record<string, unknown>
        ) => ({
            eventId: randomUUID(),
            schemaVersion: 1,
            type,
            userId: u,
            source: 'server',
            occurredAt: at,
            receivedAt: at,
            props,
            processing: { status: 'pending' },
        });
        const t = new Date('2026-03-10T10:00:00Z');
        await LearningEvent.insertMany([
            mk('rec_impression', t, {
                recId: 'A',
                itemType: 'resource',
                itemRef: 'x',
                position: 0,
                variant: 'control',
                mode: 'personalized',
                signals: { srs: 0.9 },
            }),
            mk('rec_impression', t, {
                recId: 'A',
                itemType: 'resource',
                itemRef: 'y',
                position: 1,
                variant: 'control',
                mode: 'personalized',
                signals: { need: 0.2 },
            }),
            mk('rec_impression', t, {
                recId: 'B',
                itemType: 'resource',
                itemRef: 'z',
                position: 0,
                variant: 'control',
                mode: 'cold_start',
                signals: { srs: 1 },
            }), // excluded
            mk('rec_impression', t, {
                recId: 'C',
                itemType: 'resource',
                itemRef: 'q',
                position: 0,
                variant: 'control',
                mode: 'personalized',
            }), // legacy: no signals → excluded
            mk('rec_click', new Date(t.getTime() + 1000), {
                recId: 'A',
                itemType: 'resource',
                itemRef: 'x',
                variant: 'control',
            }),
        ]);
        // snapshot BEFORE the impression says "new learner"; a later one says "established" (must not be used)
        const snap = (asOf: Date, q: number) =>
            FeatureSnapshot.create({
                userId: u,
                asOf,
                registryVersion: 1,
                values: { questions30: q },
            });
        await snap(new Date('2026-03-10T08:00:00Z'), 5);
        await snap(new Date('2026-03-10T18:00:00Z'), 500);

        const out = await loadTrainingRows(new Date('2026-03-01T00:00:00Z'));
        expect(out).toHaveLength(2);
        const x = out.find((r) => r.signals.srs === 0.9)!;
        const y = out.find((r) => r.signals.need === 0.2)!;
        expect([x.clicked, y.clicked]).toEqual([true, false]);
        expect(x.segment).toBe('new'); // from the 08:00 snapshot, not the later 'established' one
        expect(x.userId).toBe(uid);
    });
});

describe('click join is not fooled by identical itemRef across item types', () => {
    it('labels only the item type that was clicked (pronunciation vs vocab both use ref "daily")', async () => {
        const u = new mongoose.Types.ObjectId();
        const t = new Date('2026-03-10T10:00:00Z');
        const mk = (type: string, props: Record<string, unknown>) => ({
            eventId: randomUUID(),
            schemaVersion: 1,
            type,
            userId: u,
            source: 'server',
            occurredAt: t,
            receivedAt: t,
            props,
            processing: { status: 'pending' },
        });
        const base = {
            recId: 'R',
            itemRef: 'daily',
            variant: 'control',
            mode: 'personalized',
        };
        await LearningEvent.insertMany([
            mk('rec_impression', {
                ...base,
                itemType: 'pronunciation_practice',
                position: 0,
                signals: { habit: 0.5 },
            }),
            mk('rec_impression', {
                ...base,
                itemType: 'vocab_capture',
                position: 1,
                signals: { habit: 0.4 },
            }),
            mk('rec_click', { ...base, itemType: 'vocab_capture' }),
        ]);
        const rows = await loadTrainingRows(new Date('2026-03-01T00:00:00Z'));
        const by = Object.fromEntries(rows.map((x) => [x.position, x.clicked]));
        expect(by).toEqual({ 0: false, 1: true });
    });
});

describe('serving', () => {
    const deps: RecDeps = {
        loadFeatures: async () =>
            features({
                performance: {
                    acc7: 0.6,
                    acc30: 0.6,
                    questions30: 100,
                    lastTestScore: 600,
                    scoreTrend: 0,
                },
            }),
        loadProfile: async () => ({ interests: [], studyMinutesPerDay: 30 }),
        loadResources: async () => [],
        loadExposure: async () => new Map(),
        loadPopularity: async () => new Map(),
        hasPersonalizationConsent: async () => true,
    };
    const svc = () => {
        const s = new RecommenderService(deps);
        s.clearCache();
        return s;
    };
    const ids = Array.from({ length: 400 }, () =>
        new mongoose.Types.ObjectId().toString()
    );
    const variants = async (flag: boolean) => {
        if (flag) process.env.RECSYS_RETRAIN_ENABLED = 'true';
        const s = svc();
        return Promise.all(
            ids.map(
                async (id) =>
                    await s.recommend(id, {
                        logImpressions: false,
                        refresh: true,
                    })
            )
        );
    };

    it('flag off (default): the model is never consulted and nobody is served `learned`', async () => {
        await retrainService.run({ force: true, rows: GOOD });
        const spy = jest.spyOn(RecModel, 'findOne');
        const out = await variants(false);
        expect(out.some((r) => r.variant === 'learned')).toBe(false);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('serves `learned` to ~allocation% of users and leaves everyone else on their ORIGINAL assignment', async () => {
        await retrainService.run({ force: true, rows: GOOD });
        await modelRegistry.activate(1, 40, 'admin');
        const out = await variants(true);
        const learned = out.filter((r) => r.variant === 'learned');
        expect(learned.length / ids.length).toBeGreaterThan(0.3);
        expect(learned.length / ids.length).toBeLessThan(0.5);
        expect(learned[0].algo).toBe('logreg-v1:v1');
        out.forEach((r, i) => {
            const inLayer = bucket(ids[i], LEARNED_LAYER) * 100 < 40;
            expect(r.variant).toBe(inLayer ? 'learned' : assignVariant(ids[i])); // no reshuffling
        });
    });

    it('the kill switch RECSYS_FORCE_VARIANT overrides the learned model', async () => {
        await retrainService.run({ force: true, rows: GOOD });
        await modelRegistry.activate(1, 50, 'admin');
        process.env.RECSYS_FORCE_VARIANT = 'control';
        const out = await variants(true);
        expect(new Set(out.map((r) => r.variant))).toEqual(
            new Set(['control'])
        );
    });

    it('a registry failure degrades to the default path instead of failing the request', async () => {
        process.env.RECSYS_RETRAIN_ENABLED = 'true';
        const spy = jest
            .spyOn(modelRegistry, 'getActive')
            .mockRejectedValue(new Error('db down'));
        const err = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const r = await svc().recommend(ids[0], {
            logImpressions: false,
            refresh: true,
        });
        expect(['control', 'srs_heavy']).toContain(r.variant);
        spy.mockRestore();
        err.mockRestore();
    });
});

describe('registry cache is not poisoned by background jobs', () => {
    it('after guard(), a retire done elsewhere is visible within one TTL (not decades later)', async () => {
        await retrainService.run({ force: true, rows: GOOD });
        await modelRegistry.getActive(); // warm the cache with the live model
        await retrainService.guard(); // background read must not extend the cache
        // another instance retires the model directly in the database
        await RecModel.updateOne(
            { version: 1 },
            { $set: { status: 'retired' } }
        );
        expect(await modelRegistry.getActive(Date.now() + 61_000)).toBeNull();
    });

    it('retrain() reads the live model fresh and leaves the cache TTL alone', async () => {
        await retrainService.run({ force: true, rows: GOOD });
        await RecModel.updateOne(
            { version: 1 },
            { $set: { status: 'retired' } }
        );
        await retrainService.run({ force: true, rows: GOOD }); // would otherwise compare against a ghost
        modelRegistry.clearCache();
        expect(
            await modelRegistry.getActive(Date.now() + 61_000)
        ).not.toBeNull(); // v2 went live
    });

    it('guard() treats a model already retired by someone else as done, not as a crash', async () => {
        await retrainService.run({ force: true, rows: GOOD });
        const spy = jest
            .spyOn(modelRegistry, 'retire')
            .mockRejectedValue(new ModelError('not_found', 'gone'));
        const evidence = async (variant: string, ctr: number) => {
            const docs: Array<Record<string, unknown>> = [];
            const r = rng(variant.length * 31);
            for (let i = 0; i < 1500; i++) {
                const u = new mongoose.Types.ObjectId();
                const base = {
                    schemaVersion: 1,
                    userId: u,
                    source: 'server',
                    occurredAt: new Date(),
                    receivedAt: new Date(),
                    processing: { status: 'pending' },
                };
                const props = {
                    recId: `${variant}${i}`,
                    itemType: 'resource',
                    variant,
                    mode: 'personalized',
                };
                docs.push({
                    ...base,
                    eventId: randomUUID(),
                    type: 'rec_impression',
                    props: { ...props, position: 0 },
                });
                if (r() < ctr)
                    docs.push({
                        ...base,
                        eventId: randomUUID(),
                        type: 'rec_click',
                        props,
                    });
            }
            await LearningEvent.insertMany(docs);
        };
        await evidence('control', 0.25);
        await evidence('learned', 0.08);
        await expect(retrainService.guard()).resolves.toEqual({
            retired: false,
        });
        spy.mockRestore();
    });
});

describe('harm guard', () => {
    const seed = async (variant: string, ctr: number, n: number) => {
        const docs: Array<Record<string, unknown>> = [];
        const r = rng(variant.length * 17);
        for (let i = 0; i < n; i++) {
            const u = new mongoose.Types.ObjectId();
            const base = {
                schemaVersion: 1,
                userId: u,
                source: 'server',
                occurredAt: new Date(),
                receivedAt: new Date(),
                processing: { status: 'pending' },
            };
            const props = {
                recId: `${variant}${i}`,
                itemType: 'resource',
                variant,
                mode: 'personalized',
            };
            docs.push({
                ...base,
                eventId: randomUUID(),
                type: 'rec_impression',
                props: { ...props, position: 0 },
            });
            if (r() < ctr)
                docs.push({
                    ...base,
                    eventId: randomUUID(),
                    type: 'rec_click',
                    props,
                });
        }
        await LearningEvent.insertMany(docs);
    };

    it('retires a live model that is significantly worse than control, with enough evidence', async () => {
        await retrainService.run({ force: true, rows: GOOD });
        await seed('control', 0.25, 1500);
        await seed('learned', 0.1, 1500);
        const g = await retrainService.guard();
        expect(g.retired).toBe(true);
        expect(g.reason).toMatch(/auto-retired/);
        expect(await modelRegistry.getActive()).toBeNull();
    });

    it('does nothing with too little evidence or when the model is not worse', async () => {
        await retrainService.run({ force: true, rows: GOOD });
        await seed('control', 0.25, 300);
        await seed('learned', 0.05, 300); // bad, but < 1000 impressions
        expect((await retrainService.guard()).retired).toBe(false);
        await LearningEvent.deleteMany({}); // fresh evidence window
        await seed('learned', 0.25, 1500);
        await seed('control', 0.25, 1500);
        expect((await retrainService.guard()).retired).toBe(false);
        expect((await modelRegistry.getActive())!.version).toBe(1);
    });
});
