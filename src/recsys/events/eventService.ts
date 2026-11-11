import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { LearningEvent } from './eventModel.js';
import {
    CLIENT_ALLOWED_TYPES,
    EVENT_CATEGORY,
    EVENT_SCHEMA_VERSION,
    EventSource,
    EventType,
    validateEvent,
} from './eventTypes.js';
import { consentService } from '../privacy/consentService.js';
import { recsysConfig } from '../config.js';
import { servedItem, servedService } from '../engine/servedService.js';

const REC_FEEDBACK_TYPES: ReadonlySet<string> = new Set([
    'rec_impression',
    'rec_click',
    'rec_complete',
    'rec_dismiss',
]);

export interface IngestResult {
    accepted: number;
    duplicates: number;
    droppedNoConsent: number;
    rejected: Array<{ index: number; reason: string }>;
}

export interface IngestOptions {
    source: EventSource;
    /** Trusted = produced by our own server code; skips the client allow-list. */
    trusted?: boolean;
    now?: Date;
}

const MONGO_DUP = 11000;

export class EventService {
    /**
     * Validate → authorise → consent-gate → idempotent insert.
     * `userId` always comes from the authenticated principal, never from the payload.
     */
    async ingest(
        userId: string,
        rawEvents: unknown[],
        opts: IngestOptions
    ): Promise<IngestResult> {
        const now = opts.now ?? new Date();
        const result: IngestResult = {
            accepted: 0,
            duplicates: 0,
            droppedNoConsent: 0,
            rejected: [],
        };
        if (!Types.ObjectId.isValid(userId)) {
            rawEvents.forEach((_, index) =>
                result.rejected.push({ index, reason: 'invalid user' })
            );
            return result;
        }
        if (rawEvents.length > recsysConfig.maxBatchSize) {
            rawEvents.forEach((_, index) =>
                result.rejected.push({
                    index,
                    reason: `batch exceeds ${recsysConfig.maxBatchSize}`,
                })
            );
            return result;
        }

        const analyticsOk = await consentService.has(userId, 'analytics');
        const docs: Array<Record<string, unknown>> = [];
        const seen = new Set<string>();
        const oldest =
            now.getTime() - recsysConfig.maxEventAgeDays * 86_400_000;
        const newest = now.getTime() + recsysConfig.maxFutureSkewMs;

        const validated = rawEvents.map((raw) => validateEvent(raw));
        // Client-reported recommendation events must refer to a list the server served to this
        // user; experiment fields are then overwritten from that record (anti-forgery).
        const served = opts.trusted
            ? null
            : await servedService.findMany(
                  userId,
                  validated.flatMap((v) =>
                      v.ok && REC_FEEDBACK_TYPES.has(v.event.type)
                          ? [String(v.event.props.recId)]
                          : []
                  )
              );

        validated.forEach((v, index) => {
            if (!v.ok) {
                result.rejected.push({ index, reason: v.reason });
                return;
            }
            const e = v.event;
            if (!opts.trusted && !CLIENT_ALLOWED_TYPES.has(e.type)) {
                result.rejected.push({
                    index,
                    reason: `type ${e.type} is server-only`,
                });
                return;
            }
            const t = e.occurredAt.getTime();
            if (t < oldest || t > newest) {
                result.rejected.push({
                    index,
                    reason: 'occurredAt out of accepted window',
                });
                return;
            }
            if (served && REC_FEEDBACK_TYPES.has(e.type)) {
                const list = served.get(String(e.props.recId));
                const item = servedItem(
                    list,
                    String(e.props.itemType),
                    e.props.itemRef as string | undefined
                );
                if (!list || !item) {
                    result.rejected.push({
                        index,
                        reason: 'recId/item was not served to this user',
                    });
                    return;
                }
                e.props = {
                    ...e.props,
                    variant: list.variant,
                    mode: list.mode,
                    ...(e.type === 'rec_impression' || e.type === 'rec_click'
                        ? { position: item.position }
                        : {}),
                };
            }
            if (EVENT_CATEGORY[e.type] === 'behavioral' && !analyticsOk) {
                result.droppedNoConsent++;
                return;
            }
            if (seen.has(e.eventId)) {
                result.duplicates++;
                return;
            }
            seen.add(e.eventId);
            docs.push({
                ...e,
                userId: new Types.ObjectId(userId),
                source: opts.source,
                receivedAt: now,
                processing: { status: 'pending' },
            });
        });

        if (docs.length === 0) return result;
        try {
            await LearningEvent.insertMany(docs, { ordered: false });
            result.accepted = docs.length;
        } catch (err) {
            const e = err as {
                code?: number;
                writeErrors?: Array<{ err?: { code?: number } }>;
                insertedDocs?: unknown[];
                result?: { insertedCount?: number };
            };
            const writeErrors = e.writeErrors ?? [];
            const dupCount = writeErrors.filter(
                (w) => (w.err?.code ?? e.code) === MONGO_DUP
            ).length;
            if (
                e.code === MONGO_DUP ||
                (writeErrors.length > 0 && dupCount === writeErrors.length)
            ) {
                result.duplicates += dupCount || docs.length;
                result.accepted = docs.length - (dupCount || docs.length);
            } else {
                throw err;
            }
        }
        return result;
    }

    /**
     * Server-side emit used from business code. Contract: NEVER throws, NEVER blocks the
     * request for long. Failures are logged and swallowed so core features keep working.
     */
    emit(
        userId: string | Types.ObjectId | undefined,
        type: EventType,
        props: Record<string, unknown>,
        extra: { occurredAt?: Date; sessionId?: string; eventId?: string } = {}
    ): void {
        if (!userId || !recsysConfig.enabled()) return;
        void this.emitAsync(String(userId), type, props, extra);
    }

    /** Awaitable variant (tests, batch emits). Still never throws. */
    async emitAsync(
        userId: string,
        type: EventType,
        props: Record<string, unknown>,
        extra: { occurredAt?: Date; sessionId?: string; eventId?: string } = {}
    ): Promise<boolean> {
        try {
            const res = await this.ingest(
                userId,
                [
                    {
                        eventId: extra.eventId ?? randomUUID(),
                        schemaVersion: EVENT_SCHEMA_VERSION,
                        type,
                        occurredAt: extra.occurredAt ?? new Date(),
                        sessionId: extra.sessionId,
                        props,
                    },
                ],
                { source: 'server', trusted: true }
            );
            if (res.rejected.length > 0) {
                console.warn(
                    `[recsys] event ${type} rejected: ${res.rejected[0].reason}`
                );
            }
            return res.accepted > 0;
        } catch (err) {
            console.error(
                `[recsys] emit ${type} failed:`,
                (err as Error).message
            );
            return false;
        }
    }

    /** Emit many events for one user in one insert (e.g. one per answered question). */
    async emitManyAsync(
        userId: string,
        events: Array<{
            type: EventType;
            props: Record<string, unknown>;
            occurredAt?: Date;
        }>
    ): Promise<void> {
        if (!recsysConfig.enabled() || events.length === 0) return;
        try {
            const raw = events.map((e) => ({
                eventId: randomUUID(),
                schemaVersion: EVENT_SCHEMA_VERSION,
                type: e.type,
                occurredAt: e.occurredAt ?? new Date(),
                props: e.props,
            }));
            for (let i = 0; i < raw.length; i += recsysConfig.maxBatchSize) {
                await this.ingest(
                    userId,
                    raw.slice(i, i + recsysConfig.maxBatchSize),
                    {
                        source: 'server',
                        trusted: true,
                    }
                );
            }
        } catch (err) {
            console.error('[recsys] emitMany failed:', (err as Error).message);
        }
    }
}

export const eventService = new EventService();
