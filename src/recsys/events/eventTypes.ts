import { z } from 'zod';

/**
 * Event contract v1.
 *
 * Rules:
 *  - `userId` is NEVER taken from the client; the HTTP layer injects it from the JWT.
 *  - `eventId` (UUID) is the idempotency key: retries and double-sends are harmless.
 *  - Props carry scores/ids only. No audio, no free-text user content, no PII.
 *  - Category decides which consent gate applies (see CONSENT_REQUIRED).
 */

export const EVENT_SCHEMA_VERSION = 1;

export type EventCategory = 'service' | 'behavioral';

const finite = z.number().finite();
const score = finite.min(0).max(100);
const oid = z
    .string()
    .regex(/^[a-f\d]{24}$/i, 'must be a 24-char hex ObjectId');
const skillKey = z.string().min(1).max(80);

export const eventPropsSchemas = {
    session_started: z.object({
        platform: z.enum(['web', 'ios', 'android']).optional(),
    }),
    session_ended: z.object({
        durationSec: finite.min(0),
    }),
    question_answered: z.object({
        skillKey,
        part: z.number().int().min(1).max(7).optional(),
        correct: z.boolean(),
        timeMs: finite.min(0).optional(),
        difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
        testId: oid.optional(),
        questionNumber: z.number().int().min(1).max(200).optional(),
        origin: z.enum(['test', 'drill', 'daily_session']).default('test'),
    }),
    test_submitted: z.object({
        testId: oid,
        /** true only for a full 7-part test; scores are present only then. */
        full: z.boolean().default(true),
        totalScore: finite.min(0).max(990).optional(),
        listeningScore: finite.min(0).max(495).optional(),
        readingScore: finite.min(0).max(495).optional(),
        correct: z.number().int().min(0),
        total: z.number().int().min(1),
        durationSec: finite.min(0).optional(),
    }),
    flashcard_reviewed: z.object({
        flashcardId: oid,
        remembered: z.boolean(),
        prevLevel: z.number().int().min(0).max(5),
        newLevel: z.number().int().min(0).max(5),
        latencyMs: finite.min(0).optional(),
    }),
    vocab_captured: z.object({
        source: z.enum([
            'object_detection',
            'manual',
            'dictionary',
            'resource',
            'ai_generated',
        ]),
        termCount: z.number().int().min(1).max(500).default(1),
    }),
    resource_viewed: z.object({
        resourceId: oid,
        resourceType: z
            .enum(['web_rss', 'youtube', 'article', 'xapi'])
            .optional(),
        dwellSec: finite.min(0),
        scrollDepth: finite.min(0).max(1).optional(),
        completed: z.boolean().default(false),
    }),
    pronunciation_scored: z.object({
        accuracy: score,
        fluency: score.optional(),
        completeness: score.optional(),
        prosody: score.optional(),
        durationSec: finite.min(0).optional(),
    }),
    writing_scored: z.object({
        score,
        durationSec: finite.min(0).optional(),
    }),
    credit_spent: z.object({
        feature: z.string().min(1).max(80),
        credits: finite.positive(),
    }),
    ai_usage: z.object({
        feature: z.string().min(1).max(80),
        model: z.string().min(1).max(80),
        promptTokens: z.number().int().min(0),
        completionTokens: z.number().int().min(0),
        costUsd: finite.min(0),
    }),
    rec_impression: z.object({
        recId: z.string().min(1).max(64),
        itemType: z.string().min(1).max(40),
        itemRef: z.string().max(80).optional(),
        position: z.number().int().min(0).max(50),
        variant: z.string().max(40),
        /** Cold-start lists ignore the variant; the read-out must split by mode. */
        mode: z.enum(['personalized', 'cold_start']).optional(),
        algo: z.string().max(40).optional(),
        skillKey: skillKey.optional(),
        /**
         * Ranking signals the item had when shown (each in [0,1]); the training set for the
         * learned ranker. Optional so legacy events and clients stay valid.
         */
        signals: z
            .record(z.number().min(0).max(1))
            .refine((o) => Object.keys(o).length <= 12, 'too many signals')
            .optional(),
        /** Learner segment the ranker used at serve time (training reads this, not a later value). */
        segment: z.enum(['new', 'established']).optional(),
        /** True when this item was placed by the randomised slot; propensity = 1 / pool size. */
        explored: z.boolean().optional(),
        propensity: z.number().gt(0).max(1).optional(),
    }),
    rec_click: z.object({
        recId: z.string().min(1).max(64),
        itemType: z.string().min(1).max(40),
        itemRef: z.string().max(80).optional(),
        position: z.number().int().min(0).max(50).optional(),
        /** Echo of the variant returned with the recommendation (needed for A/B read-outs). */
        variant: z.string().min(1).max(40),
        mode: z.enum(['personalized', 'cold_start']).optional(),
    }),
    rec_complete: z.object({
        recId: z.string().min(1).max(64),
        itemType: z.string().min(1).max(40),
        itemRef: z.string().max(80).optional(),
        variant: z.string().min(1).max(40),
        mode: z.enum(['personalized', 'cold_start']).optional(),
        outcome: score.optional(),
    }),
    rec_dismiss: z.object({
        recId: z.string().min(1).max(64),
        itemType: z.string().min(1).max(40),
        itemRef: z.string().max(80).optional(),
        variant: z.string().min(1).max(40),
        mode: z.enum(['personalized', 'cold_start']).optional(),
        reason: z
            .enum(['too_easy', 'too_hard', 'not_relevant', 'seen'])
            .optional(),
    }),
} as const;

export type EventType = keyof typeof eventPropsSchemas;
export const EVENT_TYPES = Object.keys(eventPropsSchemas) as EventType[];

/** service = needed to deliver the product (progress, billing); behavioral = tracking. */
export const EVENT_CATEGORY: Record<EventType, EventCategory> = {
    session_started: 'behavioral',
    session_ended: 'behavioral',
    resource_viewed: 'behavioral',
    rec_impression: 'behavioral',
    rec_click: 'behavioral',
    rec_complete: 'behavioral',
    rec_dismiss: 'behavioral',
    question_answered: 'service',
    test_submitted: 'service',
    flashcard_reviewed: 'service',
    vocab_captured: 'service',
    pronunciation_scored: 'service',
    writing_scored: 'service',
    credit_spent: 'service',
    ai_usage: 'service',
};

/** Types a browser/app may send. Everything else is server-authoritative (anti-tampering). */
export const CLIENT_ALLOWED_TYPES: ReadonlySet<EventType> = new Set([
    'session_started',
    'session_ended',
    'resource_viewed',
    'rec_impression',
    'rec_click',
    'rec_complete',
    'rec_dismiss',
]);

const envelopeBase = {
    eventId: z.string().uuid(),
    schemaVersion: z
        .literal(EVENT_SCHEMA_VERSION)
        .default(EVENT_SCHEMA_VERSION),
    occurredAt: z.coerce.date(),
    sessionId: z.string().max(64).optional(),
};

/** Envelope as sent by clients (no userId, no source). */
export const clientEventSchema = z
    .object({
        ...envelopeBase,
        type: z.enum(EVENT_TYPES as [EventType, ...EventType[]]),
        props: z.record(z.unknown()),
    })
    .strict();

export type ClientEvent = z.infer<typeof clientEventSchema>;

export type EventSource = 'server' | 'web' | 'ios' | 'android';

export interface ValidatedEvent {
    eventId: string;
    schemaVersion: number;
    type: EventType;
    occurredAt: Date;
    sessionId?: string;
    props: Record<string, unknown>;
}

export type ValidationResult =
    { ok: true; event: ValidatedEvent } | { ok: false; reason: string };

/** Validate envelope + per-type props. Pure; no I/O. */
export function validateEvent(raw: unknown): ValidationResult {
    const env = clientEventSchema.safeParse(raw);
    if (!env.success) {
        return {
            ok: false,
            reason: `envelope: ${env.error.issues[0]?.message}`,
        };
    }
    const { type, props, ...rest } = env.data;
    const parsed = eventPropsSchemas[type].safeParse(props);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
            ok: false,
            reason: `props.${issue?.path.join('.') ?? ''}: ${issue?.message}`,
        };
    }
    return {
        ok: true,
        event: { ...rest, type, props: parsed.data as Record<string, unknown> },
    };
}
