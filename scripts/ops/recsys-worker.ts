/**
 * Dedicated recommendation worker: runs the ETL tick, stream exporter, retraining and the harm
 * guard OUTSIDE the API process.
 *   MONGO_URI=... RECSYS_ENABLED=true npx tsx scripts/ops/recsys-worker.ts
 * Set RECSYS_SCHEDULER_ENABLED=false on the API instances once this runs. Several workers are
 * safe: the Mongo lease lets only one run a given tick.
 */
import mongoose from 'mongoose';
import { startRecsysScheduler } from '../../src/recsys/scheduler.js';

const uri = process.env.MONGO_URI;
if (!uri) {
    console.error('MONGO_URI is required');
    process.exit(2);
}
await mongoose.connect(uri);
if (!startRecsysScheduler({ worker: true })) {
    console.error('RECSYS_ENABLED is not true: nothing to run');
    await mongoose.disconnect();
    process.exit(1);
}
const stop = async () => {
    await mongoose.disconnect();
    process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
