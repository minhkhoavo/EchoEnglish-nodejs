/**
 * Central, env-driven configuration for the recommendation platform.
 * Everything tunable lives here so ops can change behaviour without code edits.
 */
const num = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};

export const recsysConfig = {
    /** Master switch. When false: no scheduler, emit() is a no-op. */
    enabled: () => process.env.RECSYS_ENABLED === 'true',
    /** Version stamped on every derived row for lineage. Bump on logic change. */
    pipelineVersion: '1.0.0',
    schemaVersion: 1,
    /** Raw/clean retention (days) – enforced by TTL index. */
    eventRetentionDays: () => num(process.env.RECSYS_EVENT_RETENTION_DAYS, 400),
    /** Max events accepted per client batch. */
    maxBatchSize: 100,
    /** Upper bound on a single dwell/duration value (seconds) – outlier clamp. */
    maxDurationSec: 4 * 60 * 60,
    /** Events older than this at ingest time are rejected as stale (days). */
    maxEventAgeDays: 7,
    /** Events further in the future than this are rejected (clock skew), ms. */
    maxFutureSkewMs: 5 * 60 * 1000,
    /** Pipeline micro-batch size and lease TTL. */
    pipelineBatchSize: () => num(process.env.RECSYS_PIPELINE_BATCH, 2000),
    leaseTtlMs: 4 * 60 * 1000,
    /** Vietnam has no DST; day buckets are computed at UTC+7. */
    tzOffsetMinutes: 7 * 60,
    /** Salt for pseudonymised analytics exports. */
    pseudonymSalt: () => process.env.RECSYS_PSEUDONYM_SALT ?? 'dev-only-salt',
    /** Smallest cohort that analytics endpoints will return (k-anonymity). */
    minCohortSize: 5,
    /** Data-quality thresholds (see etl/dataQuality.ts). */
    dq: {
        maxRejectRate: 0.05,
        maxDuplicateRate: 0.2,
        maxUnknownSkillRate: 0.3,
        maxFreshnessLagMinutes: 30,
    },
};

export type RecsysConfig = typeof recsysConfig;
