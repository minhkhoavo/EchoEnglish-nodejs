import cron from 'node-cron';
import { pipelineService } from './etl/pipeline.js';
import { featureBuilder } from './features/featureBuilder.js';
import { recsysConfig } from './config.js';

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
    console.log('[recsys] scheduler started');
}
