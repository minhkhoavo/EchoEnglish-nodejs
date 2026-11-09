import { recsysConfig } from '../config.js';

/** Narrow port over ClickHouse so loader/erasure are testable and the client stays lazy. */
export interface Warehouse {
    insert(table: string, rows: Array<Record<string, unknown>>): Promise<void>;
    command(sql: string, params?: Record<string, unknown>): Promise<void>;
    query<T>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
    close(): Promise<void>;
}

/**
 * `bootstrap: true` connects without a default database so the schema step can run
 * `CREATE DATABASE` before the database exists (the client sends the database on every request).
 */
export async function createWarehouse(
    opts: { bootstrap?: boolean } = {},
    cfg = recsysConfig.clickhouse
): Promise<Warehouse> {
    const { createClient } = await import('@clickhouse/client');
    const client = createClient({
        url: cfg.url(),
        username: cfg.username(),
        password: cfg.password(),
        ...(opts.bootstrap ? {} : { database: cfg.database() }),
        clickhouse_settings: { date_time_input_format: 'best_effort' },
    });
    return {
        async insert(table, rows) {
            if (rows.length === 0) return;
            await client.insert({ table, values: rows, format: 'JSONEachRow' });
        },
        async command(sql, params) {
            await client.command({ query: sql, query_params: params });
        },
        async query<T>(sql: string, params?: Record<string, unknown>) {
            const rs = await client.query({
                query: sql,
                query_params: params,
                format: 'JSONEachRow',
            });
            return (await rs.json()) as T[];
        },
        close: () => client.close(),
    };
}
