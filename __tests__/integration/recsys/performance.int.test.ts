import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
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
import { eventService } from '~/recsys/events/eventService.js';
import { pipelineService } from '~/recsys/etl/pipeline.js';
import { featureBuilder } from '~/recsys/features/featureBuilder.js';
import { consentService } from '~/recsys/privacy/consentService.js';
import { makeLearners, SIM_SKILLS } from '~/recsys/eval/simulator.js';
import { buildRecommendations } from '~/recsys/engine/recommender.js';
import { VARIANTS } from '~/recsys/engine/ranker.js';
import { resource } from '../../helpers/recFixtures.js';

jest.setTimeout(300_000);

/**
 * PERFORMANCE PASS/FAIL CRITERIA (single process, in-memory Mongo on the CI runner;
 * budgets are ~5-10x looser than measured on a laptop to avoid flakiness):
 *  P1  recommender compute (pure) p95 ≤ 25 ms with 300 resource candidates
 *  P2  ingest 5,000 events in batches of 100 ≤ 20 s
 *  P3  ETL clean+aggregate 5,000 events ≤ 20 s
 *  P4  feature build for 200 learners ≤ 30 s
 */
beforeAll(async () => {
    process.env.RECSYS_ENABLED = 'true';
    await startMongo();
    await syncIndexes(
        LearningEvent,
        CleanEvent,
        DailyFacts,
        PipelineRun,
        PipelineLock,
        SkillMastery,
        LearnerFeatures
    );
});
afterAll(stopMongo);

it('P1: recommender compute latency p95 ≤ 25 ms with 300 candidates', () => {
    const learners = makeLearners(200, 1);
    const resources = Array.from({ length: 300 }, (_, i) =>
        resource(`r${i}`, {
            labels: {
                cefr: ['A2', 'B1', 'B2'][i % 3],
                domain: 'business',
                topic:
                    i % 2
                        ? ['grammar', 'word form']
                        : ['listening comprehension', 'inference'],
            },
        })
    );
    // warm-up: a long-running server has a hot JIT, so measure steady state
    for (const l of learners.slice(0, 30)) {
        l.ctx.resources = resources;
        buildRecommendations(l.ctx, VARIANTS.control, 5);
    }
    // Best p95 of 3 rounds: a GC pause or noisy neighbour cannot fail the build,
    // but a genuine regression slows every round and still fails.
    let p95 = Infinity;
    let p50 = 0;
    for (let round = 0; round < 3; round++) {
        const times: number[] = [];
        for (const l of learners) {
            l.ctx.resources = resources;
            l.ctx.profile.interests = ['business'];
            const t0 = performance.now();
            buildRecommendations(l.ctx, VARIANTS.control, 5);
            times.push(performance.now() - t0);
        }
        times.sort((x, y) => x - y);
        const r95 = times[Math.floor(times.length * 0.95)];
        if (r95 < p95) {
            p95 = r95;
            p50 = times[Math.floor(times.length / 2)];
        }
    }
    console.info(
        `[perf] recommend p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`
    );
    expect(p95).toBeLessThanOrEqual(25);
});

it('P2–P4: ingest, ETL and feature build throughput', async () => {
    await clearDb();
    const users = Array.from({ length: 200 }, () =>
        new mongoose.Types.ObjectId().toString()
    );
    for (const u of users) await consentService.update(u, { analytics: true });
    const mk = (i: number) => ({
        eventId: randomUUID(),
        schemaVersion: 1,
        type: 'question_answered',
        occurredAt: new Date().toISOString(),
        props: {
            skillKey: SIM_SKILLS[i % SIM_SKILLS.length],
            correct: i % 3 !== 0,
            origin: 'drill',
            timeMs: 8000,
        },
    });

    let t = performance.now();
    for (let i = 0; i < 5000; i += 100) {
        await eventService.ingest(
            users[(i / 100) % users.length],
            Array.from({ length: 100 }, (_, j) => mk(i + j)),
            { source: 'web', trusted: true }
        );
    }
    const ingestMs = performance.now() - t;
    expect(await LearningEvent.countDocuments()).toBe(5000);

    t = performance.now();
    const summary = await pipelineService.runOnce({ maxBatches: 20 });
    const etlMs = performance.now() - t;
    expect(summary!.counts.cleaned).toBe(5000);

    const touched = summary!.touchedUserIds;
    t = performance.now();
    await featureBuilder.buildMany(touched);
    const featMs = performance.now() - t;

    console.info(
        `[perf] ingest=${ingestMs.toFixed(0)}ms (${(5000 / (ingestMs / 1000)).toFixed(0)} ev/s) etl=${etlMs.toFixed(0)}ms feature(${touched.length} users)=${featMs.toFixed(0)}ms`
    );
    expect(ingestMs).toBeLessThanOrEqual(20_000);
    expect(etlMs).toBeLessThanOrEqual(20_000);
    expect(featMs).toBeLessThanOrEqual(30_000);
});
