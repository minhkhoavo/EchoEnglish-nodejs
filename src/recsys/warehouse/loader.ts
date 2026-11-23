import { EVENT_COLUMNS } from './schema.js';
import { Warehouse } from './clickhouse.js';
import { parseWire } from '../stream/wire.js';
import { isErased, loadTombstones } from '../stream/erasure.js';

export interface LoadResult {
    received: number;
    inserted: number;
    invalid: number;
    erased: number;
    wrongRegion: number;
}

const toDate3 = (iso: string) => new Date(iso).toISOString();

/**
 * Pure-ish batch step (broker-agnostic, unit-testable): parse → drop foreign-region and
 * invalid messages → honour erasure tombstones → idempotent insert. The consumer wiring in
 * `runLoader` only feeds it batches and commits offsets after it returns.
 */
export async function loadBatch(
    values: string[],
    wh: Pick<Warehouse, 'insert'>,
    opts: { region: string; table?: string }
): Promise<LoadResult> {
    const res: LoadResult = {
        received: values.length,
        inserted: 0,
        invalid: 0,
        erased: 0,
        wrongRegion: 0,
    };
    const parsed = [];
    for (const v of values) {
        const w = parseWire(v);
        if (!w) res.invalid++;
        else if (w.region !== opts.region)
            // Residency guard: a regional warehouse never stores another region's data.
            res.wrongRegion++;
        else parsed.push(w);
    }
    const tombstones = await loadTombstones([
        ...new Set(parsed.map((w) => w.u)),
    ]);
    const rows: Array<Record<string, unknown>> = [];
    for (const w of parsed) {
        if (isErased(tombstones, w.u, new Date(w.ts))) {
            res.erased++;
            continue;
        }
        rows.push({
            event_id: w.eventId,
            user_pseudo: w.u,
            region: w.region,
            type: w.type,
            occurred_at: toDate3(w.ts),
            day: w.day,
            hour: w.hour,
            received_at: toDate3(w.receivedAt),
            props: JSON.stringify(w.props ?? {}),
            pipeline_version: w.pv ?? '',
        } satisfies Record<(typeof EVENT_COLUMNS)[number], unknown>);
    }
    await wh.insert(opts.table ?? 'events', rows);
    res.inserted = rows.length;
    return res;
}
