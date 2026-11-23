/**
 * Standalone health probe for cron / uptime monitors / a scheduled GitHub Action.
 *   MONGO_URI=... npx tsx scripts/ops/recsys-health.ts
 * Exit code: 0 ok, 1 degraded, 2 down. Prints the JSON report.
 */
import mongoose from 'mongoose';
import { checkHealth } from '../../src/recsys/analytics/healthService.js';

const uri = process.env.MONGO_URI;
if (!uri) {
    console.error('MONGO_URI is required');
    process.exit(2);
}
await mongoose.connect(uri);
const report = await checkHealth();
console.log(JSON.stringify(report, null, 2));
await mongoose.disconnect();
process.exit(report.status === 'ok' ? 0 : report.status === 'degraded' ? 1 : 2);
