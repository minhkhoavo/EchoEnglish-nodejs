/**
 * Throughput / storage benchmark for the Phase 3 pipeline against REAL services (dev sizing only —
 * it measures this machine, not production capacity).
 *   MONGO_URI=... RECSYS_PSEUDONYM_SALT=... RECSYS_STREAM_BROKERS=... RECSYS_CLICKHOUSE_URL=... \
 *   RECSYS_CLICKHOUSE_DB=bench npx tsx scripts/ops/recsys-bench.ts [events=150000] [users=5000]
 * Writes ONLY to the configured Mongo database, topic base and ClickHouse database: use throwaway ones.
 */
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { CleanEvent } from '../../src/recsys/etl/models.js';
import { Consent } from '../../src/recsys/privacy/consentModel.js';
import { StreamExporter } from '../../src/recsys/stream/exporter.js';
import { createKafkaProducer } from '../../src/recsys/stream/producer.js';
import { createWarehouse } from '../../src/recsys/warehouse/clickhouse.js';
import { ddl } from '../../src/recsys/warehouse/schema.js';
import { runLoader } from '../../src/recsys/warehouse/consumer.js';
import { recsysConfig } from '../../src/recsys/config.js';
import { rng } from '../../src/recsys/eval/simulator.js';

const N = Number(process.argv[2] ?? 150_000);
const USERS = Number(process.argv[3] ?? 5000);
const uri = process.env.MONGO_URI;
if (!uri) throw new Error('MONGO_URI is required');
const r = rng(42);
const ms = (t0: bigint) => Number(process.hrtime.bigint() - t0) / 1e6;
const rate = (n: number, t: number) => Math.round((n / t) * 1000);

await mongoose.connect(uri);
await Promise.all([CleanEvent.deleteMany({}), Consent.deleteMany({})]);
const users = Array.from(
    { length: USERS },
    () => new mongoose.Types.ObjectId()
);
await Consent.insertMany(
    users.map((userId) => ({
        userId,
        purposes: { analytics: true, personalization: true, research: false },
        policyVersion: '2026-01',
        updatedAt: new Date(),
    }))
);

const SKILLS = [
    'p5.wordform',
    'p5.verbtensemood',
    'p6.conjunction',
    'p7.inference',
    'p3.detail',
    'p2.whquestion',
];
const mk = () => {
    const u = users[Math.floor(r() * USERS)];
    const x = r();
    const at = new Date(Date.now() - Math.floor(r() * 6 * 86_400_000));
    let type = 'question_answered';
    let props: Record<string, unknown> = {
        skillKey: SKILLS[Math.floor(r() * SKILLS.length)],
        correct: r() < 0.6,
        origin: 'drill',
        timeMs: Math.floor(5000 + r() * 20_000),
    };
    if (x > 0.7 && x <= 0.8) {
        type = 'flashcard_reviewed';
        props = {
            flashcardId: 'c'.repeat(24),
            remembered: r() < 0.7,
            prevLevel: 1,
            newLevel: 2,
            latencyMs: Math.floor(1500 + r() * 4000),
        };
    } else if (x > 0.8 && x <= 0.9) {
        type = 'resource_viewed';
        props = {
            resourceId: 'd'.repeat(24),
            dwellSec: Math.floor(20 + r() * 300),
            completed: r() < 0.4,
        };
    } else if (x > 0.9 && x <= 0.95) {
        type = 'session_started';
        props = {};
    } else if (x > 0.95) {
        type = 'rec_impression';
        props = {
            recId: randomUUID().slice(0, 12),
            itemType: 'resource',
            itemRef: 'e'.repeat(24),
            position: Math.floor(r() * 5),
            variant: r() < 0.5 ? 'control' : 'srs_heavy',
            mode: 'personalized',
            algo: 'weighted-v1',
            signals: {
                need: Number(r().toFixed(3)),
                srs: Number(r().toFixed(3)),
                interest: 1,
            },
        };
    }
    return {
        eventId: randomUUID(),
        rawId: new mongoose.Types.ObjectId(),
        userId: u,
        type,
        occurredAt: at,
        day: at.toISOString().slice(0, 10),
        hour: at.getUTCHours(),
        props,
        clamped: [],
        pipelineVersion: '1.0.0',
        runId: 'bench',
        receivedAt: at,
    };
};

let t0 = process.hrtime.bigint();
for (let i = 0; i < N; i += 5000)
    await CleanEvent.insertMany(
        Array.from({ length: Math.min(5000, N - i) }, () => mk()),
        { ordered: false }
    );
const seedMs = ms(t0);

const cfg = recsysConfig.clickhouse;
const boot = await createWarehouse({ bootstrap: true });
await boot.command(`DROP DATABASE IF EXISTS ${cfg.database()}`);
for (const s of ddl(cfg.database(), cfg.retentionDays())) await boot.command(s);
await boot.close();
const wh = await createWarehouse();

const loader = await runLoader({ region: recsysConfig.defaultRegion(), wh });
const producer = await createKafkaProducer();
t0 = process.hrtime.bigint();
let exported = 0;
const exporter = new StreamExporter({ producer });
for (;;) {
    const res = await exporter.runOnce();
    exported += res.exported;
    if (res.status === 'idle' || res.status === 'failed') break;
}
const exportMs = ms(t0);
const tLoad = process.hrtime.bigint();
let rows = 0;
for (let i = 0; i < 600 && rows < exported; i++) {
    rows = Number(
        (await wh.query<{ n: string }>('SELECT count() AS n FROM events'))[0].n
    );
    if (rows < exported) await new Promise((res) => setTimeout(res, 500));
}
const endToEndMs = exportMs + ms(tLoad);
await loader.stop();
await producer.disconnect();

const [disk] = await wh.query<{ comp: string; raw: string; parts: string }>(
    `SELECT sum(data_compressed_bytes) AS comp, sum(data_uncompressed_bytes) AS raw, count() AS parts FROM system.parts WHERE active AND database = '${cfg.database()}' AND table = 'events'`
);
const [mongoSize] = (await mongoose.connection
    .db!.collection('learning_events_clean')
    .aggregate([{ $collStats: { storageStats: {} } }])
    .toArray()) as Array<{
    storageStats: { size: number; storageSize: number; totalIndexSize: number };
}>;
console.log(
    JSON.stringify(
        {
            events: N,
            users: USERS,
            seedMongoMs: Math.round(seedMs),
            exporter: {
                exported,
                ms: Math.round(exportMs),
                eventsPerSec: rate(exported, exportMs),
            },
            loaderEndToEnd: {
                rowsInClickHouse: rows,
                ms: Math.round(endToEndMs),
                eventsPerSec: rate(rows, endToEndMs),
            },
            clickhouse: {
                compressedBytes: Number(disk.comp),
                uncompressedBytes: Number(disk.raw),
                bytesPerEventCompressed: Math.round(
                    Number(disk.comp) / Math.max(rows, 1)
                ),
                compressionRatio: Number(
                    (Number(disk.raw) / Math.max(Number(disk.comp), 1)).toFixed(
                        2
                    )
                ),
                parts: Number(disk.parts),
            },
            mongoSilver: {
                bytesPerEvent: Math.round(
                    (mongoSize.storageStats.storageSize +
                        mongoSize.storageStats.totalIndexSize) /
                        N
                ),
            },
        },
        null,
        2
    )
);
await wh.close();
await mongoose.disconnect();
process.exit(rows === exported ? 0 : 1);
