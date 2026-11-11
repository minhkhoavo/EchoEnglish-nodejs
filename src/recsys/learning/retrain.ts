import { randomUUID } from 'node:crypto';
import { PipelineLock } from '../etl/models.js';
import { recsysConfig } from '../config.js';
import { kpiService } from '../analytics/kpiService.js';
import { ModelDoc, ModelError, modelRegistry } from './registry.js';
import { TrainReport, TrainingRow, trainRanker } from './train.js';
import { loadExploreLogs, loadTrainingRows } from './dataset.js';
import { replayEstimate } from '../eval/counterfactual.js';
import { VARIANTS } from '../engine/ranker.js';

const LEASE_ID = 'retrain';
const DAY_MS = 86_400_000;

export interface RetrainResult {
    status: 'disabled' | 'locked' | 'skipped' | 'trained';
    version?: number;
    activated: boolean;
    reason?: string;
    report?: TrainReport;
}

export interface RetrainOptions {
    now?: Date;
    /** Ignore the RECSYS_RETRAIN_ENABLED flag (admin / CLI invocation). */
    force?: boolean;
    /** Train and evaluate but persist nothing. */
    dryRun?: boolean;
    /** Test / tooling hook: supply rows instead of reading production logs. */
    rows?: TrainingRow[];
    dataSource?: 'production' | 'synthetic';
}

export class RetrainService {
    private async lease(owner: string, now: Date) {
        try {
            const d = await PipelineLock.findOneAndUpdate(
                {
                    _id: LEASE_ID,
                    $or: [{ expiresAt: { $lte: now } }, { owner }],
                },
                {
                    $set: {
                        owner,
                        expiresAt: new Date(now.getTime() + 30 * 60_000),
                    },
                },
                { upsert: true, new: true }
            ).lean<{ owner: string } | null>();
            return d?.owner === owner;
        } catch (err) {
            if ((err as { code?: number }).code === 11000) return false;
            throw err;
        }
    }

    /**
     * Train → evaluate → register. A model that passes the gate goes live ONLY as a small
     * challenger (hard-capped share of users) and only if it beats the model already live;
     * raising its share is an explicit admin action. Synthetic-data models are never servable.
     */
    async run(opts: RetrainOptions = {}): Promise<RetrainResult> {
        const now = opts.now ?? new Date();
        if (!opts.force && !recsysConfig.retrain.enabled())
            return { status: 'disabled', activated: false };
        const owner = randomUUID();
        if (!(await this.lease(owner, now)))
            return { status: 'locked', activated: false };
        try {
            const dataSource = opts.dataSource ?? 'production';
            const since = new Date(
                now.getTime() -
                    recsysConfig.retrain.trainingWindowDays() * DAY_MS
            );
            const rows = opts.rows ?? (await loadTrainingRows(since));
            const report = await trainRanker(rows);
            // Real-log check next to the holdout AUC: what the randomised slot says each
            // policy is worth. Informational (it needs exploration traffic to mean anything).
            if (report.payload && !opts.rows) {
                const logs = await loadExploreLogs(since, rows);
                report.metrics.counterfactual = {
                    control: replayEstimate(logs, VARIANTS.control.weights),
                    learned: replayEstimate(logs, report.payload.global),
                };
            }
            if (opts.dryRun)
                return {
                    status: 'skipped',
                    activated: false,
                    report,
                    reason: 'dry run',
                };
            const doc = await modelRegistry.register(report, {
                dataSource,
                now,
            });
            let activated = false;
            let reason: string | undefined;
            if (doc.status === 'candidate') {
                const live = await modelRegistry.fetchActive();
                const liveLift = (live?.metrics?.lift ?? null) as number | null;
                if (
                    live &&
                    liveLift !== null &&
                    (report.metrics.lift ?? -1) <= liveLift
                ) {
                    reason = `does not beat live model v${live.version} (lift ${report.metrics.lift} <= ${liveLift})`;
                } else {
                    await modelRegistry.activate(
                        doc.version,
                        recsysConfig.retrain.challengerPct(),
                        'auto',
                        now
                    );
                    activated = true;
                }
            }
            return {
                status: 'trained',
                version: doc.version,
                activated,
                reason: reason ?? report.reasons.join('; '),
                report,
            };
        } finally {
            await PipelineLock.deleteOne({ _id: LEASE_ID, owner });
        }
    }

    /**
     * Automatic safety net (the only automatic action that REMOVES a model from service):
     * retire the live model if it is significantly worse than control with enough evidence.
     */
    async guard(
        now = new Date()
    ): Promise<{ retired: boolean; reason?: string }> {
        const live: ModelDoc | null = await modelRegistry.fetchActive();
        if (!live) return { retired: false };
        const { variants } = await kpiService.experiments({
            windowDays: 7,
            now,
        });
        const row = variants.find(
            (v) => v.variant === 'learned' && v.mode === 'personalized'
        );
        // Per-learner test: impressions from one learner are correlated, so an
        // impression-level z would retire (or keep) a model on overstated evidence.
        const t = row?.perLearner?.tCtrVsControl ?? null;
        if (!row || row.impressions < 1000 || t === null)
            return { retired: false };
        if (t <= -1.96) {
            const reason = `auto-retired: per-learner CTR t=${t} vs control over ${row.perLearner?.learners} learners / ${row.impressions} impressions`;
            try {
                await modelRegistry.retire(live.version, reason, now);
            } catch (e) {
                // Another instance (or an admin) retired it first: the goal is already met.
                if (e instanceof ModelError && e.code === 'not_found')
                    return { retired: false };
                throw e;
            }
            return { retired: true, reason };
        }
        return { retired: false };
    }
}

export const retrainService = new RetrainService();
