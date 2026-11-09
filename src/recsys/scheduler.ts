import cron from 'node-cron';
import { pipelineService } from './etl/pipeline.js';
import { featureBuilder } from './features/featureBuilder.js';
import { recsysConfig } from './config.js';
import { StreamExporter } from './stream/exporter.js';
import { createKafkaProducer, StreamProducer } from './stream/producer.js';
import { PseudonymConfigError } from './stream/pseudonym.js';

let started = false;

/**
 * Starts the ETL tick. Safe to call on every instance: the Mongo lease guarantees only one
 * instance runs a given tick; the others return immediately.
 * Disabled unless RECSYS_ENABLED=true (kill switch / staged rollout).
 */
export function startRecsysScheduler(): void {
    if (started || !recsysConfig.enabled()) return;
    started = true;
    cron.schedule('*/2 * * * *', async () => {
        try {
            const run = await pipelineService.runOnce({
                afterFacts: (ids) => featureBuilder.buildMany(ids),
            });
            if (run && (run.status !== 'ok' || run.counts.read > 0)) {
                console.log(
                    `[recsys] etl ${run.status} ${JSON.stringify(run.counts)}`
                );
                if (run.status !== 'ok') {
                    const failed = run.dq
                        .filter((c) => !c.passed)
                        .map((c) => c.name);
                    console.warn(
                        `[recsys] etl ${run.status}: ${run.error ?? failed.join(',')}`
                    );
                }
            }
        } catch (err) {
            console.error('[recsys] etl tick crashed:', (err as Error).message);
        }
    });
    startStreamExporter();
    console.log('[recsys] scheduler started');
}

let producerPromise: Promise<StreamProducer> | null = null;

/**
 * Phase 3: Mongo silver → Redpanda. Off unless RECSYS_STREAM_ENABLED=true. Failures never
 * affect the API or the ETL tick; the cursor only advances after the broker acknowledges.
 */
function startStreamExporter(): void {
    if (!recsysConfig.stream.enabled()) return;
    cron.schedule('* * * * *', async () => {
        try {
            producerPromise ??= createKafkaProducer();
            const producer = await producerPromise.catch((e) => {
                producerPromise = null; // reconnect on the next tick
                throw e;
            });
            const res = await new StreamExporter({ producer }).runOnce();
            if (res.status === 'failed')
                console.warn(`[recsys] stream export failed: ${res.error}`);
            else if (res.exported > 0)
                console.log(`[recsys] stream exported ${res.exported}`);
        } catch (err) {
            console.error(
                err instanceof PseudonymConfigError
                    ? `[recsys] stream export disabled: ${err.message}`
                    : `[recsys] stream tick crashed: ${(err as Error).message}`
            );
        }
    });
    console.log('[recsys] stream exporter scheduled');
}
