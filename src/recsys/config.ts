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
    /** Secret for pseudonymised analytics exports. No default: exports fail closed without it. */
    pseudonymSalt: () => process.env.RECSYS_PSEUDONYM_SALT,
    /** Smallest cohort that analytics endpoints will return (k-anonymity). */
    minCohortSize: 5,
    /**
     * Phase 3 (scale) paths. Every flag defaults to OFF; MongoDB stays the system of record.
     * See docs/recommendation/TASKS.md (T3.x) for scope and the status of each piece.
     */
    stream: {
        enabled: () => process.env.RECSYS_STREAM_ENABLED === 'true',
        brokers: () =>
            (process.env.RECSYS_STREAM_BROKERS ?? '')
                .split(',')
                .map((b) => b.trim())
                .filter(Boolean),
        /** Base topic; the data region is appended (`<base>.<region>`). */
        topicBase: () =>
            process.env.RECSYS_STREAM_TOPIC ?? 'echo.learning_events.v1',
        clientId: () => process.env.RECSYS_STREAM_CLIENT_ID ?? 'echo-recsys',
        batchSize: () => num(process.env.RECSYS_STREAM_BATCH, 1000),
        maxBatchesPerRun: 20,
        /** Topic retention the broker must be configured with (Kafka cannot delete single records). */
        topicRetentionHours: () =>
            num(process.env.RECSYS_STREAM_RETENTION_HOURS, 168),
    },
    clickhouse: {
        enabled: () => process.env.RECSYS_CLICKHOUSE_ENABLED === 'true',
        url: () => process.env.RECSYS_CLICKHOUSE_URL ?? 'http://localhost:8123',
        database: () => process.env.RECSYS_CLICKHOUSE_DB ?? 'echo',
        username: () => process.env.RECSYS_CLICKHOUSE_USER ?? 'default',
        password: () => process.env.RECSYS_CLICKHOUSE_PASSWORD ?? '',
        /** Event rows older than this are dropped by ClickHouse TTL (days). */
        retentionDays: () =>
            num(process.env.RECSYS_CLICKHOUSE_RETENTION_DAYS, 400),
        loaderBatchMs: 2000,
    },
    /** Default data region for learners without an explicit residency tag. */
    defaultRegion: () => process.env.RECSYS_DEFAULT_REGION ?? 'vn',

    /** Data-quality thresholds (see etl/dataQuality.ts). */
    dq: {
        maxRejectRate: 0.05,
        maxDuplicateRate: 0.2,
        maxUnknownSkillRate: 0.3,
        maxFreshnessLagMinutes: 30,
    },
};

export type RecsysConfig = typeof recsysConfig;
