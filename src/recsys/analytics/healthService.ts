import { LearningEvent } from '../events/eventModel.js';
import { PipelineRun } from '../etl/models.js';
import { recsysConfig } from '../config.js';

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
}

/** Thresholds used by alerts. A stalled scheduler is "down"; bad data quality is "degraded". */
export const HEALTH_THRESHOLDS = {
    maxMinutesSinceRun: 15, // tick is every 2 min; 15 = 7 missed ticks
    maxFreshnessLagMinutes: recsysConfig.dq.maxFreshnessLagMinutes,
    maxRejectRate24h: 0.05,
};

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
    };
}
