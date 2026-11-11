/**
 * Offline content-embedding job (Phase 3). Never runs on the request path.
 *   MONGO_URI=... GENAI_API_KEY=... npx tsx scripts/ops/recsys-embed.ts
 *   RECSYS_EMBEDDINGS_PROVIDER=hash ...   # free lexical baseline, no API call
 * Re-runnable: unchanged resources are skipped by content hash, so cost tracks change not size.
 * Cost is reported per run (≈chars/4 tokens) — it is job-level, not attributable to a learner.
 */
import mongoose from 'mongoose';
import { providerFromEnv } from '../../src/recsys/embeddings/provider.js';
import { indexResources } from '../../src/recsys/embeddings/indexer.js';

const uri = process.env.MONGO_URI;
if (!uri) {
    console.error('MONGO_URI is required');
    process.exit(2);
}
await mongoose.connect(uri);
const provider = await providerFromEnv();
const report = await indexResources(provider);
console.log(JSON.stringify({ provider: provider.name, ...report }, null, 2));
await mongoose.disconnect();
process.exit(report.failedBatches > 0 ? 1 : 0);
