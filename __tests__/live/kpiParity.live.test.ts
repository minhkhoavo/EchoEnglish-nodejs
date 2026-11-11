/**
 * OPT-IN: proves the ClickHouse/dbt KPI path equals the Mongo path on identical events.
 *   docker compose -f docker-compose.analytics.yml up -d clickhouse
 *   RECSYS_LIVE_CLICKHOUSE=http://localhost:18123 npx jest __tests__/live/kpiParity
 * Requires Docker (dbt runs in a pinned container: scripts/ops/run-dbt.sh).
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../helpers/mongo.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
import {
    CleanEvent,
    DailyFacts,
    PipelineLock,
    PipelineRun,
} from '~/recsys/etl/models.js';
import { Consent, ConsentLedger } from '~/recsys/privacy/consentModel.js';
import { consentService } from '~/recsys/privacy/consentService.js';
import { eventService } from '~/recsys/events/eventService.js';
import { pipelineService } from '~/recsys/etl/pipeline.js';
import { StreamExporter } from '~/recsys/stream/exporter.js';
import { ErasureTombstone } from '~/recsys/stream/erasure.js';
import { StreamProducer } from '~/recsys/stream/producer.js';
import { createWarehouse } from '~/recsys/warehouse/clickhouse.js';
import { ddl } from '~/recsys/warehouse/schema.js';
import { loadBatch } from '~/recsys/warehouse/loader.js';
import { KpiService } from '~/recsys/analytics/kpiService.js';
import { clickhouseSource, mongoSource } from '~/recsys/analytics/sources.js';
import { User } from '~/models/userModel.js';

jest.setTimeout(600_000);
const CH = process.env.RECSYS_LIVE_CLICKHOUSE;
const maybe = CH ? describe : describe.skip;
const SALT = 'parity-test-salt-0123456789';
const db = `parity_${randomUUID().slice(0, 8)}`;
const DAY = 86_400_000;

class Capture implements StreamProducer {
    values: string[] = [];
    async send(_t: string, m: Array<{ key: string; value: string }>) {
        this.values.push(...m.map((x) => x.value));
    }
    async disconnect() {}
}

beforeAll(async () => {
    Object.assign(process.env, {
        RECSYS_ENABLED: 'true',
        RECSYS_PSEUDONYM_SALT: SALT,
        RECSYS_REGIONS: 'vn',
        RECSYS_CLICKHOUSE_URL: CH ?? '',
        RECSYS_CLICKHOUSE_DB: db,
        RECSYS_CLICKHOUSE_USER:
            process.env.RECSYS_LIVE_CLICKHOUSE_USER ?? 'echo',
        RECSYS_CLICKHOUSE_PASSWORD:
            process.env.RECSYS_LIVE_CLICKHOUSE_PASSWORD ?? 'echo',
    });
    await startMongo();
    await syncIndexes(
        LearningEvent,
        CleanEvent,
        DailyFacts,
        PipelineRun,
        PipelineLock,
        Consent,
        ConsentLedger,
        ErasureTombstone
    );
});
afterAll(async () => {
    if (CH) {
        const boot = await createWarehouse({ bootstrap: true });
        await boot.command(`DROP DATABASE IF EXISTS ${db}`);
        await boot.close();
    }
    await stopMongo();
});

maybe('LIVE KPI parity (Mongo vs ClickHouse+dbt)', () => {
    it('produces identical overview and experiment read-outs from the same events', async () => {
        await clearDb();
        const now = new Date();
        const at = (daysAgo: number) =>
            new Date(now.getTime() - daysAgo * DAY - 60_000);
        const users = Array.from({ length: 6 }, () =>
            new mongoose.Types.ObjectId().toString()
        );

        for (const [i, u] of users.entries()) {
            // signed up 7 days ago → eligible for D1 / D7 retention and 7-day activation
            await User.collection.insertOne({
                _id: new mongoose.Types.ObjectId(u),
                email: `${u}@parity.test`,
                createdAt: at(7),
            });
            await consentService.update(u, { analytics: true });
            const ev = [
                // day 1 after signup: a drill question + a flashcard + AI usage
                {
                    type: 'question_answered' as const,
                    occurredAt: at(6),
                    props: {
                        skillKey: 'p5.wordform',
                        correct: i % 2 === 0,
                        origin: 'drill' as const,
                        timeMs: 8_000 + i * 500,
                    },
                },
                {
                    type: 'flashcard_reviewed' as const,
                    occurredAt: at(6),
                    props: {
                        flashcardId: 'c'.repeat(24),
                        remembered: true,
                        prevLevel: 1,
                        newLevel: 2,
                        latencyMs: 3_300,
                    },
                },
                {
                    type: 'ai_usage' as const,
                    occurredAt: at(6),
                    props: {
                        feature: 'chat',
                        model: 'm',
                        promptTokens: 10,
                        completionTokens: 20,
                        costUsd: 0.0001234 * (i + 1),
                    },
                },
                // full test 6 days ago and again today → score gain; in-test question must not add study time
                {
                    type: 'test_submitted' as const,
                    occurredAt: at(6),
                    props: {
                        testId: 'a'.repeat(24),
                        full: true,
                        totalScore: 500 + i * 10,
                        correct: 100,
                        total: 200,
                        durationSec: 7_000,
                    },
                },
                {
                    type: 'question_answered' as const,
                    occurredAt: at(6),
                    props: {
                        skillKey: 'p5.wordform',
                        correct: true,
                        origin: 'test' as const,
                        timeMs: 60_000,
                    },
                },
                {
                    type: 'test_submitted' as const,
                    occurredAt: at(0),
                    props: {
                        testId: 'a'.repeat(24),
                        full: true,
                        totalScore: 560 + i * 10,
                        correct: 120,
                        total: 200,
                        durationSec: 6_500,
                    },
                },
                // a partial test must never become a score
                {
                    type: 'test_submitted' as const,
                    occurredAt: at(0),
                    props: {
                        testId: 'b'.repeat(24),
                        full: false,
                        totalScore: 100,
                        correct: 5,
                        total: 10,
                        durationSec: 300,
                    },
                },
                {
                    type: 'credit_spent' as const,
                    occurredAt: at(0),
                    props: { feature: 'chat', credits: 3 },
                },
                // the remaining study-time branches (fractional values exercise Math.round parity)
                {
                    type: 'resource_viewed' as const,
                    occurredAt: at(0),
                    props: {
                        resourceId: 'd'.repeat(24),
                        dwellSec: 40.5 + i,
                        completed: i % 2 === 0,
                    },
                },
                {
                    type: 'pronunciation_scored' as const,
                    occurredAt: at(0),
                    props: { accuracy: 80, durationSec: 12.5 },
                },
                {
                    type: 'writing_scored' as const,
                    occurredAt: at(0),
                    props: { score: 70, durationSec: 90.25 },
                },
                {
                    type: 'vocab_captured' as const,
                    occurredAt: at(0),
                    props: { source: 'manual' as const, termCount: 2 },
                },
                // recommendation funnel (behavioural, consented)
                ...Array.from({ length: 3 }, () => ({
                    type: 'rec_impression' as const,
                    occurredAt: at(0),
                    props: {
                        recId: 'r',
                        itemType: 'resource',
                        position: 0,
                        variant: i < 3 ? 'control' : 'srs_heavy',
                        mode: 'personalized' as const,
                    },
                })),
                ...(i % 2 === 0
                    ? [
                          {
                              type: 'rec_click' as const,
                              occurredAt: at(0),
                              props: {
                                  recId: 'r',
                                  itemType: 'resource',
                                  variant: i < 3 ? 'control' : 'srs_heavy',
                                  mode: 'personalized' as const,
                              },
                          },
                      ]
                    : []),
            ];
            await eventService.emitManyAsync(u, ev);
        }
        const run = await pipelineService.runOnce();
        expect(run?.status).toBe('ok');

        // Mongo silver → exporter → (captured) → real ClickHouse
        const boot = await createWarehouse({ bootstrap: true });
        for (const s of ddl(db, 400)) await boot.command(s);
        await boot.close();
        const cap = new Capture();
        expect(
            (await new StreamExporter({ producer: cap }).runOnce()).exported
        ).toBeGreaterThan(40);
        const wh = await createWarehouse();
        await loadBatch(cap.values, wh, { region: 'vn' });
        await wh.close();

        const dbt = spawnSync('scripts/ops/run-dbt.sh', ['build'], {
            env: {
                ...process.env,
                DBT_CH_HOST: new URL(CH!).hostname,
                DBT_CH_PORT: new URL(CH!).port,
                DBT_CH_USER: process.env.RECSYS_CLICKHOUSE_USER,
                DBT_CH_PASSWORD: process.env.RECSYS_CLICKHOUSE_PASSWORD,
                DBT_CH_DATABASE: db,
            },
            encoding: 'utf8',
        });
        expect(dbt.stdout + dbt.stderr).toMatch(/ERROR=0/);

        const viaMongo = new KpiService(() => mongoSource);
        const viaCh = new KpiService(() => clickhouseSource());
        const a = await viaMongo.overview({ now });
        const b = await viaCh.overview({ now });
        expect(b.backend).toBe('clickhouse');
        expect(b.fallbackReason).toBeUndefined();
        // sanity: the data is rich enough that equality is meaningful
        expect(a.studyTime).toBeTruthy();
        expect(JSON.stringify(a.scoreGain)).not.toContain('null');
        const strip = (o: typeof a) => ({ ...o, backend: undefined });
        expect(strip(b)).toEqual(strip(a));

        const ea = await viaMongo.experiments({ now });
        const eb = await viaCh.experiments({ now });
        expect(ea.variants.length).toBeGreaterThanOrEqual(2);
        expect(eb.variants).toEqual(ea.variants);
    });

    it('reports a fallback (never fails, never silently mixes) when the warehouse is unreachable', async () => {
        const bad = new KpiService(() =>
            clickhouseSource(async () => {
                throw new Error('connect ECONNREFUSED');
            })
        );
        const out = await bad.overview();
        expect(out.backend).toBe('mongo');
        expect(out.fallbackReason).toMatch(/ECONNREFUSED/);
    });
});
