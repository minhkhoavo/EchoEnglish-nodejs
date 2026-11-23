/**
 * Warehouse loader process (Phase 3): Redpanda topic → ClickHouse.
 *   MONGO_URI=... RECSYS_STREAM_BROKERS=... RECSYS_CLICKHOUSE_URL=... RECSYS_LOADER_REGION=vn \
 *     npx tsx scripts/ops/recsys-loader.ts            (add --init to create the schema and exit)
 * Needs Mongo only to read erasure tombstones.
 */
import mongoose from 'mongoose';
import { recsysConfig } from '../../src/recsys/config.js';
import { createWarehouse } from '../../src/recsys/warehouse/clickhouse.js';
import { ddl } from '../../src/recsys/warehouse/schema.js';
import { runLoader } from '../../src/recsys/warehouse/consumer.js';
import { knownRegions } from '../../src/recsys/stream/regions.js';

const uri = process.env.MONGO_URI;
if (!uri) {
    console.error('MONGO_URI is required');
    process.exit(2);
}
const region = process.env.RECSYS_LOADER_REGION ?? knownRegions()[0];
const cfg = recsysConfig.clickhouse;
const boot = await createWarehouse({ bootstrap: true });
for (const stmt of ddl(cfg.database(), cfg.retentionDays()))
    await boot.command(stmt);
await boot.close();
const wh = await createWarehouse();
if (process.argv.includes('--init')) {
    console.log('schema ready');
    await wh.close();
    process.exit(0);
}
await mongoose.connect(uri);
const handle = await runLoader({ region, wh });
console.log(`[recsys] loader running for region ${region}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
    process.on(sig, async () => {
        await handle.stop();
        await wh.close();
        await mongoose.disconnect();
        process.exit(0);
    });
