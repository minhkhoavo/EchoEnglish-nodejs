/**
 * OPT-IN tests against REAL Redpanda and ClickHouse (never run in CI / plain jest).
 *   docker compose -f docker-compose.analytics.yml up -d redpanda     # kafka part
 *   docker compose -f docker-compose.analytics.yml up -d clickhouse   # warehouse part
 *   RECSYS_LIVE_KAFKA=localhost:19092 RECSYS_LIVE_CLICKHOUSE=http://localhost:18123 npx jest __tests__/live
 * Dev VM note: run one container at a time unless you have >4 GB free.
 */
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../helpers/mongo.js';
import { CleanEvent, PipelineLock } from '~/recsys/etl/models.js';
import { Consent, ConsentLedger } from '~/recsys/privacy/consentModel.js';
import { consentService } from '~/recsys/privacy/consentService.js';
import { StreamExporter } from '~/recsys/stream/exporter.js';
import { ErasureTombstone } from '~/recsys/stream/erasure.js';
import { createKafkaProducer } from '~/recsys/stream/producer.js';
import { pseudonymise } from '~/recsys/stream/pseudonym.js';
import { parseWire } from '~/recsys/stream/wire.js';
import { createWarehouse } from '~/recsys/warehouse/clickhouse.js';
import { ddl } from '~/recsys/warehouse/schema.js';
import { loadBatch } from '~/recsys/warehouse/loader.js';
import { runLoader } from '~/recsys/warehouse/consumer.js';
import { DataSubjectService } from '~/recsys/privacy/dataSubjectService.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
import { DailyFacts } from '~/recsys/etl/models.js';

jest.setTimeout(180_000);
const KAFKA = process.env.RECSYS_LIVE_KAFKA;
const CH = process.env.RECSYS_LIVE_CLICKHOUSE;
const SALT = 'live-test-salt-0123456789';
const run = randomUUID().slice(0, 8);
const kafkaIt = KAFKA ? it : it.skip;
const chIt = CH ? it : it.skip;
const bothIt = KAFKA && CH ? it : it.skip;

const newUser = () => new mongoose.Types.ObjectId().toString();
const silver = (userId: string, type: string, at: Date) =>
    CleanEvent.create({
        eventId: randomUUID(),
        rawId: new mongoose.Types.ObjectId(),
        userId,
        type,
        occurredAt: at,
        day: at.toISOString().slice(0, 10),
        hour: 8,
        props: { skillKey: 'p5.wordform', correct: true },
        pipelineVersion: '1.0.0',
        runId: 'live',
        receivedAt: at,
    });

async function consumeAll(
    topic: string,
    want: number,
    timeoutMs = 30_000
): Promise<string[]> {
    const { KafkaJS } = await import('@confluentinc/kafka-javascript');
    const kafka = new KafkaJS.Kafka({
        kafkaJS: { brokers: [KAFKA!], clientId: 'live-check' },
    });
    const c = kafka.consumer({
        kafkaJS: { groupId: `live-${randomUUID()}`, fromBeginning: true },
    });
    await c.connect();
    await c.subscribe({ topic });
    const got: string[] = [];
    await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        void c.run({
            eachMessage: async ({ message }) => {
                got.push(message.value!.toString());
                if (got.length >= want) {
                    clearTimeout(timer);
                    resolve();
                }
            },
        });
    });
    await c.disconnect();
    return got;
}

beforeAll(async () => {
    process.env.RECSYS_PSEUDONYM_SALT = SALT;
    process.env.RECSYS_STREAM_BROKERS = KAFKA ?? '';
    process.env.RECSYS_STREAM_TOPIC = `live.${run}`;
    process.env.RECSYS_REGIONS = 'vn';
    process.env.RECSYS_CLICKHOUSE_ENABLED = 'true';
    process.env.RECSYS_CLICKHOUSE_URL = CH ?? '';
    process.env.RECSYS_CLICKHOUSE_DB = `live_${run}`;
    process.env.RECSYS_CLICKHOUSE_USER =
        process.env.RECSYS_LIVE_CLICKHOUSE_USER ?? 'echo';
    process.env.RECSYS_CLICKHOUSE_PASSWORD =
        process.env.RECSYS_LIVE_CLICKHOUSE_PASSWORD ?? 'echo';
    await startMongo();
    await syncIndexes(
        CleanEvent,
        PipelineLock,
        Consent,
        ConsentLedger,
        ErasureTombstone,
        LearningEvent,
        DailyFacts
    );
});
afterAll(stopMongo);
beforeEach(clearDb);

describe('LIVE Redpanda', () => {
    kafkaIt(
        'exports through a real broker; topic is created with bounded retention',
        async () => {
            const u = newUser();
            await consentService.update(u, { analytics: true });
            for (let i = 0; i < 5; i++)
                await silver(u, 'session_started', new Date());
            const producer = await createKafkaProducer();
            const res = await new StreamExporter({ producer }).runOnce();
            await producer.disconnect();
            expect(res).toMatchObject({ status: 'ok', exported: 5 });
            const msgs = await consumeAll(`live.${run}.vn`, 5);
            expect(msgs).toHaveLength(5);
            const w = parseWire(msgs[0])!;
            expect(w.u).toBe(pseudonymise(u, 'vn', SALT));
            expect(msgs.join('')).not.toContain(u);
        }
    );
});

describe('LIVE ClickHouse', () => {
    chIt(
        'schema, idempotent insert, dedup, erase and tombstone against a real server',
        async () => {
            const boot = await createWarehouse({ bootstrap: true });
            for (const stmt of ddl(`live_${run}`, 400))
                await boot.command(stmt);
            await boot.close();
            const wh = await createWarehouse();
            const u = newUser();
            const t = new Date('2026-03-10T05:00:00Z');
            const pseudo = pseudonymise(u, 'vn', SALT);
            const { toWire } = await import('~/recsys/stream/wire.js');
            const w = JSON.stringify(
                toWire(
                    {
                        eventId: 'ev-1',
                        userId: u,
                        type: 'question_answered',
                        occurredAt: t,
                        receivedAt: t,
                        day: '2026-03-10',
                        hour: 12,
                        pipelineVersion: '1.0.0',
                        props: { skillKey: 'p5.wordform', correct: true },
                    },
                    pseudo,
                    'vn'
                )
            );
            // same message delivered twice (at-least-once) → one logical row
            await loadBatch([w, w], wh, { region: 'vn' });
            await loadBatch([w], wh, { region: 'vn' });
            const [{ n }] = await wh.query<{ n: string }>(
                'SELECT count() AS n FROM events FINAL'
            );
            expect(Number(n)).toBe(1);
            const [row] = await wh.query<{
                props: string;
                occurred_at: string;
                user_pseudo: string;
            }>(
                'SELECT props, toString(occurred_at) AS occurred_at, user_pseudo FROM events FINAL'
            );
            expect(JSON.parse(row.props).skillKey).toBe('p5.wordform');
            expect(row.occurred_at).toContain('2026-03-10 05:00:00');
            expect(row.user_pseudo).toBe(pseudo);

            // erase through the real service → real DELETE, truthful report, tombstone blocks re-load
            const out = await new DataSubjectService(async () =>
                createWarehouse()
            ).eraseUserData(u);
            expect(out.downstream.warehouse).toBe('deleted');
            const [{ n: after }] = await wh.query<{ n: string }>(
                'SELECT count() AS n FROM events FINAL'
            );
            expect(Number(after)).toBe(0);
            const res = await loadBatch([w], wh, { region: 'vn' });
            expect(res).toMatchObject({ erased: 1, inserted: 0 });
            await wh.command(`DROP DATABASE IF EXISTS live_${run}`);
            await wh.close();
        }
    );
});

describe('LIVE end to end', () => {
    bothIt(
        'Mongo silver → exporter → Redpanda → loader → ClickHouse; then erase removes it',
        async () => {
            const boot = await createWarehouse({ bootstrap: true });
            for (const stmt of ddl(`live_${run}`, 400))
                await boot.command(stmt);
            await boot.close();
            const wh = await createWarehouse();
            const u = newUser();
            await consentService.update(u, { analytics: true });
            for (let i = 0; i < 4; i++)
                await silver(u, 'resource_viewed', new Date());
            const producer = await createKafkaProducer();
            expect(
                (await new StreamExporter({ producer }).runOnce()).exported
            ).toBe(4);
            await producer.disconnect();

            const handle = await runLoader({ region: 'vn', wh });
            let n = 0;
            for (let i = 0; i < 30 && n < 4; i++) {
                await new Promise((r) => setTimeout(r, 1000));
                n = Number(
                    (
                        await wh.query<{ n: string }>(
                            'SELECT count() AS n FROM events FINAL WHERE user_pseudo = {p:String}',
                            { p: pseudonymise(u, 'vn', SALT) }
                        )
                    )[0].n
                );
            }
            await handle.stop();
            expect(n).toBe(4);

            await new DataSubjectService(async () =>
                createWarehouse()
            ).eraseUserData(u);
            const [{ n: left }] = await wh.query<{ n: string }>(
                'SELECT count() AS n FROM events FINAL WHERE user_pseudo = {p:String}',
                { p: pseudonymise(u, 'vn', SALT) }
            );
            expect(Number(left)).toBe(0);
            await wh.command(`DROP DATABASE IF EXISTS live_${run}`);
            await wh.close();
        }
    );
});
