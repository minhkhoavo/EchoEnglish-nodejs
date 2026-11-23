/**
 * ClickHouse DDL for the analytics sink. ReplacingMergeTree on the full sorting key (which
 * includes event_id) makes re-delivery harmless: at-least-once upstream ⇒ effectively-once here.
 * Read with FINAL (or the `events_dedup` view) until merges catch up.
 */
export function ddl(db: string, retentionDays: number): string[] {
    const d = `\`${db.replace(/[^a-zA-Z0-9_]/g, '')}\``;
    const days = Math.max(1, Math.floor(retentionDays));
    return [
        `CREATE DATABASE IF NOT EXISTS ${d}`,
        `CREATE TABLE IF NOT EXISTS ${d}.events (
            event_id String,
            user_pseudo String,
            region LowCardinality(String),
            type LowCardinality(String),
            occurred_at DateTime64(3, 'UTC'),
            day Date,
            hour UInt8,
            received_at DateTime64(3, 'UTC'),
            props String,
            pipeline_version LowCardinality(String),
            ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
        )
        ENGINE = ReplacingMergeTree(ingested_at)
        PARTITION BY toYYYYMM(day)
        ORDER BY (type, day, user_pseudo, event_id)
        TTL day + INTERVAL ${days} DAY`,
        `CREATE VIEW IF NOT EXISTS ${d}.events_dedup AS SELECT * FROM ${d}.events FINAL`,
    ];
}

export const EVENT_COLUMNS = [
    'event_id',
    'user_pseudo',
    'region',
    'type',
    'occurred_at',
    'day',
    'hour',
    'received_at',
    'props',
    'pipeline_version',
] as const;
