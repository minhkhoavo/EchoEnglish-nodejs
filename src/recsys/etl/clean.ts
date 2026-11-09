import { EventType, validateEvent } from '../events/eventTypes.js';
import { recsysConfig } from '../config.js';

export interface RawEventLike {
    _id: unknown;
    eventId: string;
    schemaVersion: number;
    type: string;
    userId: unknown;
    occurredAt: Date;
    receivedAt: Date;
    props: Record<string, unknown>;
}

export interface CleanedEvent {
    eventId: string;
    rawId: unknown;
    userId: unknown;
    type: EventType;
    occurredAt: Date;
    receivedAt: Date;
    day: string;
    hour: number;
    props: Record<string, unknown>;
    clamped: string[];
}

export type CleanOutcome =
    { ok: true; event: CleanedEvent } | { ok: false; reason: string };

/** Local (Vietnam, UTC+7, no DST) calendar day and hour for an instant. */
export function localDayHour(
    d: Date,
    offsetMinutes = recsysConfig.tzOffsetMinutes
): { day: string; hour: number } {
    const shifted = new Date(d.getTime() + offsetMinutes * 60_000);
    return {
        day: shifted.toISOString().slice(0, 10),
        hour: shifted.getUTCHours(),
    };
}

export function normalizeSkillKey(k: string): string {
    return k.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 80);
}

const DURATION_FIELDS = ['durationSec', 'dwellSec'] as const;
const MAX_QUESTION_MS = 10 * 60 * 1000;

/**
 * Pure transformation bronze → silver.
 * Re-validates (the contract may have evolved since ingest), clamps outliers and records
 * what it changed in `clamped` so the change is visible in lineage.
 */
export function cleanEvent(raw: RawEventLike): CleanOutcome {
    const v = validateEvent({
        eventId: raw.eventId,
        schemaVersion: raw.schemaVersion,
        type: raw.type,
        occurredAt: raw.occurredAt,
        props: raw.props,
    });
    if (!v.ok) return { ok: false, reason: v.reason };

    const props = { ...v.event.props };
    const clamped: string[] = [];

    for (const f of DURATION_FIELDS) {
        const val = props[f];
        if (typeof val === 'number' && val > recsysConfig.maxDurationSec) {
            props[f] = recsysConfig.maxDurationSec;
            clamped.push(f);
        }
    }
    if (typeof props.timeMs === 'number' && props.timeMs > MAX_QUESTION_MS) {
        props.timeMs = MAX_QUESTION_MS;
        clamped.push('timeMs');
    }
    if (typeof props.skillKey === 'string') {
        props.skillKey = normalizeSkillKey(props.skillKey);
    }

    const { day, hour } = localDayHour(v.event.occurredAt);
    return {
        ok: true,
        event: {
            eventId: v.event.eventId,
            rawId: raw._id,
            userId: raw.userId,
            type: v.event.type,
            occurredAt: v.event.occurredAt,
            receivedAt: raw.receivedAt,
            day,
            hour,
            props,
            clamped,
        },
    };
}
