/** Versioned wire format shared by the exporter (producer) and loader (consumer). */
export const WIRE_VERSION = 1;

export interface EventWire {
    v: number;
    eventId: string;
    /** Region-scoped keyed pseudonym; never the raw user id. */
    u: string;
    region: string;
    type: string;
    /** occurredAt, ISO-8601 UTC. */
    ts: string;
    /** Local (UTC+7) day bucket and hour, as computed by the ETL. */
    day: string;
    hour: number;
    receivedAt: string;
    pv: string;
    props: Record<string, unknown>;
}

export interface CleanRow {
    eventId: string;
    userId: { toString(): string };
    type: string;
    occurredAt: Date;
    receivedAt: Date;
    day: string;
    hour: number;
    pipelineVersion: string;
    props: Record<string, unknown>;
}

export function toWire(
    row: CleanRow,
    pseudonym: string,
    region: string
): EventWire {
    return {
        v: WIRE_VERSION,
        eventId: row.eventId,
        u: pseudonym,
        region,
        type: row.type,
        ts: row.occurredAt.toISOString(),
        day: row.day,
        hour: row.hour,
        receivedAt: row.receivedAt.toISOString(),
        pv: row.pipelineVersion,
        props: row.props,
    };
}

export function parseWire(raw: string): EventWire | null {
    try {
        const w = JSON.parse(raw) as Partial<EventWire>;
        if (
            w.v !== WIRE_VERSION ||
            typeof w.eventId !== 'string' ||
            typeof w.u !== 'string' ||
            typeof w.type !== 'string' ||
            typeof w.ts !== 'string' ||
            Number.isNaN(Date.parse(w.ts)) ||
            typeof w.day !== 'string'
        )
            return null;
        return w as EventWire;
    } catch {
        return null;
    }
}
