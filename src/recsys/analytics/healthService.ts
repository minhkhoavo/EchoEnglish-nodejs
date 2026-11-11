import { LearningEvent } from '../events/eventModel.js';
import { PipelineRun } from '../etl/models.js';
import { recsysConfig } from '../config.js';
import { CleanEvent } from '../etl/models.js';
import { StreamState } from '../stream/exporter.js';
import { ErasureTombstone } from '../stream/erasure.js';
import { modelRegistry } from '../learning/registry.js';

export interface HealthReport {
    status: 'ok' | 'degraded' | 'down';
    checkedAt: string;
    pendingEvents: number;
    freshnessLagMinutes: number;
    lastRun: {
        status: string;
        finishedAt?: Date;
        counts?: Record<string, number>;
    } | null;
    minutesSinceLastRun: number | null;
    failedDqChecks: string[];
    rejectRate24h: number | null;
    problems: string[];
    /** Present only when a Phase 3 flag is on. */
    phase3?: {
        stream?: {
            backlog: number;
            minutesSinceCursorUpdate: number | null;
            lastError: string | null;
        };
        erasure?: {
            pendingWarehouseDeletes: number;
            oldestPendingMinutes: number | null;
        };
        liveModel?: { version: number; allocationPct: number } | null;
    };
}

/** Thresholds used by alerts. A stalled scheduler is "down"; bad data quality is "degraded". */
export const HEALTH_THRESHOLDS = {
    maxMinutesSinceRun: 15, // tick is every 2 min; 15 = 7 missed ticks
    maxFreshnessLagMinutes: recsysConfig.dq.maxFreshnessLagMinutes,
    maxRejectRate24h: 0.05,
    /** Phase 3 */
    maxStreamStallMinutes: 15,
    maxPendingEraseMinutes: 10,
};

type Phase3 = NonNullable<HealthReport['phase3']>;

/** Only inspects what is switched on, so a default deployment pays nothing and reports nothing. */
async function checkPhase3(
    now: Date,
    problems: string[]
): Promise<{ phase3?: Phase3; degraded: boolean }> {
    const out: Phase3 = {};
    let degraded = false;
    if (recsysConfig.stream.enabled()) {
        const st = await StreamState.findById('silver').lean<{
            cursorId?: import('mongoose').Types.ObjectId;
            updatedAt?: Date;
            lastError?: string;
        } | null>();
        const backlog = await CleanEvent.countDocuments(
            st?.cursorId ? { _id: { $gt: st.cursorId } } : {}
        );
        const minutes = st?.updatedAt
            ? (now.getTime() - st.updatedAt.getTime()) / 60_000
            : null;
        out.stream = {
            backlog,
            minutesSinceCursorUpdate:
                minutes === null ? null : Math.round(minutes * 10) / 10,
            lastError: st?.lastError ?? null,
        };
        if (st?.lastError) {
            degraded = true;
            problems.push(
                `stream exporter error: ${st.lastError.slice(0, 120)}`
            );
        }
        if (
            backlog > 0 &&
            (minutes === null ||
                minutes > HEALTH_THRESHOLDS.maxStreamStallMinutes)
        ) {
            degraded = true;
            problems.push(
                `stream exporter stalled: ${backlog} silver events waiting, cursor ${minutes === null ? 'never advanced' : `idle ${Math.round(minutes)} min`}`
            );
        }
    }
    if (recsysConfig.clickhouse.enabled()) {
        const pending = await ErasureTombstone.find({ warehousePending: true })
            .sort({ at: 1 })
            .select('at')
            .lean<Array<{ at: Date }>>();
        const oldest = pending[0]
            ? (now.getTime() - pending[0].at.getTime()) / 60_000
            : null;
        out.erasure = {
            pendingWarehouseDeletes: pending.length,
            oldestPendingMinutes:
                oldest === null ? null : Math.round(oldest * 10) / 10,
        };
        if (
            oldest !== null &&
            oldest > HEALTH_THRESHOLDS.maxPendingEraseMinutes
        ) {
            degraded = true;
            problems.push(
                `${pending.length} warehouse erasure(s) pending for up to ${Math.round(oldest)} min (a data-subject request is not complete until deleted)`
            );
        }
    }
    if (recsysConfig.retrain.enabled()) {
        const m = await modelRegistry.fetchActive();
        out.liveModel = m
            ? { version: m.version, allocationPct: m.allocationPct }
            : null;
    }
    return { phase3: Object.keys(out).length ? out : undefined, degraded };
}

export async function checkHealth(now = new Date()): Promise<HealthReport> {
    const [pendingEvents, oldest, last, since24h] = await Promise.all([
        LearningEvent.countDocuments({ 'processing.status': 'pending' }),
        LearningEvent.findOne({ 'processing.status': 'pending' })
            .sort({ receivedAt: 1 })
            .select('receivedAt')
            .lean<{ receivedAt: Date } | null>(),
        PipelineRun.findOne({ status: { $ne: 'running' } })
            .sort({ startedAt: -1 })
            .lean<{
                status: string;
                finishedAt?: Date;
                startedAt: Date;
                counts?: Record<string, number>;
                dq?: Array<{ name: string; passed: boolean }>;
            } | null>(),
        LearningEvent.aggregate<{ _id: string; n: number }>([
            {
                $match: {
                    receivedAt: { $gte: new Date(now.getTime() - 86_400_000) },
                },
            },
            { $group: { _id: '$processing.status', n: { $sum: 1 } } },
        ]),
    ]);

    const lag = oldest
        ? Math.max(0, (now.getTime() - oldest.receivedAt.getTime()) / 60_000)
        : 0;
    const minutesSinceLastRun = last
        ? (now.getTime() - (last.finishedAt ?? last.startedAt).getTime()) /
          60_000
        : null;
    const total24 = since24h.reduce((a, r) => a + r.n, 0);
    const rejected24 = since24h.find((r) => r._id === 'rejected')?.n ?? 0;
    const rejectRate24h = total24 > 0 ? rejected24 / total24 : null;
    const failedDqChecks = (last?.dq ?? [])
        .filter((c) => !c.passed)
        .map((c) => c.name);

    const problems: string[] = [];
    let status: HealthReport['status'] = 'ok';
    if (last === null && pendingEvents > 0) {
        status = 'down';
        problems.push('pipeline has never run but events are pending');
    }
    if (
        minutesSinceLastRun !== null &&
        minutesSinceLastRun > HEALTH_THRESHOLDS.maxMinutesSinceRun &&
        pendingEvents > 0
    ) {
        status = 'down';
        problems.push(
            `no pipeline run for ${Math.round(minutesSinceLastRun)} min with ${pendingEvents} pending events`
        );
    }
    if (last?.status === 'failed') {
        status = 'down';
        problems.push('last pipeline run failed');
    }
    if (lag > HEALTH_THRESHOLDS.maxFreshnessLagMinutes) {
        if (status === 'ok') status = 'degraded';
        problems.push(`freshness lag ${Math.round(lag)} min`);
    }
    if (failedDqChecks.length > 0) {
        if (status === 'ok') status = 'degraded';
        problems.push(
            `data-quality checks failing: ${failedDqChecks.join(', ')}`
        );
    }
    if (
        rejectRate24h !== null &&
        rejectRate24h > HEALTH_THRESHOLDS.maxRejectRate24h
    ) {
        if (status === 'ok') status = 'degraded';
        problems.push(
            `reject rate ${(rejectRate24h * 100).toFixed(1)}% over 24h`
        );
    }

    const p3 = await checkPhase3(now, problems);
    if (p3.degraded && status === 'ok') status = 'degraded';

    return {
        status,
        checkedAt: now.toISOString(),
        pendingEvents,
        freshnessLagMinutes: Math.round(lag * 10) / 10,
        lastRun: last
            ? {
                  status: last.status,
                  finishedAt: last.finishedAt,
                  counts: last.counts,
              }
            : null,
        minutesSinceLastRun:
            minutesSinceLastRun === null
                ? null
                : Math.round(minutesSinceLastRun * 10) / 10,
        failedDqChecks,
        rejectRate24h:
            rejectRate24h === null
                ? null
                : Math.round(rejectRate24h * 10_000) / 10_000,
        problems,
        ...(p3.phase3 ? { phase3: p3.phase3 } : {}),
    };
}
