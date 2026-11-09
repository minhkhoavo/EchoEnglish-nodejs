/**
 * REHEARSAL of the whole learning loop through the REAL emission and storage path:
 *   RecommenderService → rec_impression{signals} (validated, consent-gated, stored) → simulated
 *   learners click → rec_click events → feature snapshots → retrainService.run() reading the logs
 * The learners' behaviour is SIMULATED (a hidden preference function) — this proves the plumbing
 * and that the trainer can recover a signal from logs produced by the production code path. It is
 * NOT evidence about real learners (T3.13 needs production data).
 */
import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
import { PipelineLock } from '~/recsys/etl/models.js';
import { Consent, ConsentLedger } from '~/recsys/privacy/consentModel.js';
import { consentService } from '~/recsys/privacy/consentService.js';
import { FeatureSnapshot } from '~/recsys/featurestore/snapshotModel.js';
import { featureStore } from '~/recsys/featurestore/store.js';
import { RecModel, modelRegistry } from '~/recsys/learning/registry.js';
import { retrainService } from '~/recsys/learning/retrain.js';
import { loadTrainingRows } from '~/recsys/learning/dataset.js';
import { RecDeps, RecommenderService } from '~/recsys/engine/recommender.js';
import { eventService } from '~/recsys/events/eventService.js';
import { rng } from '~/recsys/eval/simulator.js';
import { features, resource, skill } from '../../helpers/recFixtures.js';
import { ResourceLike } from '~/recsys/engine/types.js';

jest.setTimeout(600_000);
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const r = rng(2026);
const N_USERS = 200;
const ROUNDS = 6;
const SKILLS = [
    'p5.wordform',
    'p5.verbtensemood',
    'p6.conjunction',
    'p7.inference',
    'p3.detail',
    'p2.whquestion',
];
const DOMAINS = ['travel', 'business', 'technology', 'health'];

const users = Array.from({ length: N_USERS }, () =>
    new mongoose.Types.ObjectId().toString()
);
const feat = new Map(
    users.map((u) => {
        const q = Math.floor(5 + r() * 200);
        return [
            u,
            features({
                userId: u,
                computedAt: new Date(Date.now() - 2 * 3_600_000),
                performance: {
                    acc7: 0.6,
                    acc30: 0.6,
                    questions30: q,
                    lastTestScore: 600,
                    scoreTrend: 0,
                },
                srs: {
                    total: 40,
                    due: Math.floor(r() * 30),
                    newCards: 3,
                    avgRetrievability: 0.5 + r() * 0.4,
                    overdueMax: 2,
                },
                daysSince: {
                    test: Math.floor(r() * 40),
                    pronunciation: Math.floor(r() * 20),
                    vocab: Math.floor(r() * 20),
                },
                skills: SKILLS.map((s) =>
                    skill(s, 0.3 + r() * 0.65, 5 + Math.floor(r() * 40))
                ),
            }),
        ];
    })
);
const interests = new Map(
    users.map((u) => [
        u,
        [DOMAINS[Math.floor(r() * 4)], DOMAINS[Math.floor(r() * 4)]],
    ])
);
const resources: ResourceLike[] = Array.from({ length: 40 }, (_, i) =>
    resource(`${i.toString(16).padStart(24, '0')}`, {
        labels: {
            cefr: r() < 0.5 ? 'B1' : 'B2',
            domain: DOMAINS[Math.floor(r() * 4)],
            topic:
                r() < 0.5
                    ? ['grammar', 'word form']
                    : ['reading comprehension'],
        },
    })
);
const popularity = new Map(resources.map((x) => [x._id.toString(), r()]));

const deps: RecDeps = {
    loadFeatures: async (u) => feat.get(u) ?? null,
    loadProfile: async (u) => ({
        interests: interests.get(u) ?? [],
        studyMinutesPerDay: 60,
        level: 'intermediate',
    }),
    loadResources: async () => resources,
    loadExposure: async () => new Map(),
    loadPopularity: async () => popularity,
    hasPersonalizationConsent: async () => true,
};

beforeAll(async () => {
    Object.assign(process.env, {
        RECSYS_ENABLED: 'true',
        RECSYS_RETRAIN_MIN_IMPRESSIONS: '4000',
        RECSYS_RETRAIN_MIN_CLICKS: '150',
    });
    await startMongo();
    await syncIndexes(
        LearningEvent,
        PipelineLock,
        Consent,
        ConsentLedger,
        FeatureSnapshot,
        RecModel
    );
});
afterAll(stopMongo);
beforeEach(async () => {
    await clearDb();
    modelRegistry.clearCache();
});

it('logs → features → training → registry works end to end on production-path data', async () => {
    // consent + point-in-time snapshots taken BEFORE the impressions
    for (const u of users) {
        await consentService.update(u, {
            analytics: true,
            personalization: true,
        });
        await featureStore.snapshot(feat.get(u)!, feat.get(u)!.computedAt);
    }

    // 1) real recommender + real event ingest
    const svc = new RecommenderService(deps);
    svc.clearCache();
    let shown = 0;
    for (let round = 0; round < ROUNDS; round++)
        for (const u of users) {
            const res = await svc.recommend(u, { limit: 5, refresh: true });
            expect(res.mode).toBe('personalized');
            shown += res.items.length;
        }
    for (let i = 0; i < 100; i++) {
        if (
            (await LearningEvent.countDocuments({ type: 'rec_impression' })) >=
            shown
        )
            break;
        await new Promise((x) => setTimeout(x, 100)); // impressions are fire-and-forget
    }
    const imps = await LearningEvent.find({ type: 'rec_impression' }).lean<
        Array<{
            userId: mongoose.Types.ObjectId;
            props: {
                recId: string;
                itemType: string;
                itemRef?: string;
                variant: string;
                mode: string;
                signals: Record<string, number>;
            };
        }>
    >();
    expect(imps).toHaveLength(shown);
    expect(
        imps.every(
            (i) => i.props.signals && typeof i.props.signals === 'object'
        )
    ).toBe(true);

    // 2) simulated learners react to a HIDDEN preference (different from control's weighting)
    const truth = (s: Record<string, number>) =>
        sigmoid(
            -2.4 +
                3.0 * (s.levelFit ?? 0) +
                2.6 * (s.interest ?? 0) +
                2.2 * (s.popularity ?? 0)
        );
    const byUser = new Map<
        string,
        Array<{ type: 'rec_click'; props: Record<string, unknown> }>
    >();
    for (const i of imps)
        if (r() < truth(i.props.signals)) {
            const k = i.userId.toString();
            (byUser.get(k) ?? byUser.set(k, []).get(k)!).push({
                type: 'rec_click',
                props: {
                    recId: i.props.recId,
                    itemType: i.props.itemType,
                    itemRef: i.props.itemRef,
                    variant: i.props.variant,
                    mode: i.props.mode,
                },
            });
        }
    for (const [u, evs] of byUser) await eventService.emitManyAsync(u, evs);
    const clicks = await LearningEvent.countDocuments({ type: 'rec_click' });
    expect(clicks).toBeGreaterThan(150);

    // 3) dataset: joined to clicks AND to as-of snapshots
    const rows = await loadTrainingRows(new Date(Date.now() - 86_400_000));
    expect(rows).toHaveLength(shown);
    expect(rows.filter((x) => x.clicked).length).toBe(clicks);
    expect(
        rows.filter((x) => x.segment !== null).length / rows.length
    ).toBeGreaterThan(0.99);
    expect(new Set(rows.map((x) => x.segment))).toEqual(
        new Set(['new', 'established'])
    );

    // 4) the real retraining entry point, reading production-path logs (no injected rows)
    const out = await retrainService.run({ force: true });
    expect(out.status).toBe('trained');
    expect(out.report!.counts.rows).toBe(shown);
    expect(out.report!.reasons).toEqual([]);
    expect(out.report!.metrics.lift!).toBeGreaterThan(0.01);
    expect(out.activated).toBe(true);

    const live = (await modelRegistry.getActive())!;
    expect(live.allocationPct).toBe(5); // challenger only
    const g = live.payload!.global;
    // it found the hidden preference rather than control's need/srs emphasis
    expect(g.levelFit + g.interest + g.popularity).toBeGreaterThan(0.6);
    console.log(
        'REHEARSAL',
        JSON.stringify({
            impressions: shown,
            clicks,
            lift: out.report!.metrics.lift,
            aucLearned: out.report!.metrics.aucLearned,
            aucControl: out.report!.metrics.aucControl,
            weights: g,
        })
    );
});
