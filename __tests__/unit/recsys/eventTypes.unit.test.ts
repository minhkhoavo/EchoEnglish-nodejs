import { randomUUID } from 'node:crypto';
import {
    validateEvent,
    CLIENT_ALLOWED_TYPES,
    EVENT_CATEGORY,
    EVENT_TYPES,
} from '~/recsys/events/eventTypes.js';

const base = () => ({
    eventId: randomUUID(),
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
});

describe('event contract v1', () => {
    it('accepts a valid resource_viewed event and applies defaults', () => {
        const r = validateEvent({
            ...base(),
            type: 'resource_viewed',
            props: { resourceId: 'a'.repeat(24), dwellSec: 42 },
        });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.event.props.completed).toBe(false);
    });

    it('rejects unknown envelope keys (e.g. a client-supplied userId)', () => {
        const r = validateEvent({
            ...base(),
            type: 'session_started',
            userId: 'x',
            props: {},
        });
        expect(r.ok).toBe(false);
    });

    it('rejects non-uuid eventId, bad type and bad props with a reason', () => {
        expect(
            validateEvent({
                ...base(),
                eventId: 'nope',
                type: 'session_started',
                props: {},
            }).ok
        ).toBe(false);
        expect(validateEvent({ ...base(), type: 'hack', props: {} }).ok).toBe(
            false
        );
        const r = validateEvent({
            ...base(),
            type: 'question_answered',
            props: { skillKey: 'p5.wordForm', correct: 'yes' },
        });
        expect(r).toMatchObject({ ok: false });
        if (!r.ok) expect(r.reason).toContain('correct');
    });

    it('rejects NaN/Infinity and out-of-range scores', () => {
        expect(
            validateEvent({
                ...base(),
                type: 'pronunciation_scored',
                props: { accuracy: 101 },
            }).ok
        ).toBe(false);
        expect(
            validateEvent({
                ...base(),
                type: 'session_ended',
                props: { durationSec: Infinity },
            }).ok
        ).toBe(false);
    });

    it('every event type has a category and client-allowed types are all behavioural', () => {
        for (const t of EVENT_TYPES) expect(EVENT_CATEGORY[t]).toBeDefined();
        for (const t of CLIENT_ALLOWED_TYPES)
            expect(EVENT_CATEGORY[t]).toBe('behavioral');
    });

    it('server-authoritative types (scores, billing) are not client-allowed', () => {
        for (const t of [
            'test_submitted',
            'credit_spent',
            'ai_usage',
            'flashcard_reviewed',
        ] as const) {
            expect(CLIENT_ALLOWED_TYPES.has(t)).toBe(false);
        }
    });

    it('rec feedback events must echo the variant so A/B read-outs never lose outcomes', () => {
        for (const type of [
            'rec_click',
            'rec_complete',
            'rec_dismiss',
        ] as const) {
            const props = { recId: 'r1', itemType: 'resource', itemRef: 'x' };
            expect(validateEvent({ ...base(), type, props }).ok).toBe(false);
            expect(
                validateEvent({
                    ...base(),
                    type,
                    props: { ...props, variant: 'control' },
                }).ok
            ).toBe(true);
        }
    });

    it('test_submitted defaults to full and accepts an explicit partial flag; rec events accept mode', () => {
        const props = { testId: 'a'.repeat(24), correct: 1, total: 2 };
        const d = validateEvent({ ...base(), type: 'test_submitted', props });
        expect(d.ok && d.event.props.full).toBe(true);
        const p = validateEvent({
            ...base(),
            type: 'test_submitted',
            props: { ...props, full: false },
        });
        expect(p.ok && p.event.props.full).toBe(false);
        const ok = validateEvent({
            ...base(),
            type: 'rec_click',
            props: {
                recId: 'r',
                itemType: 'resource',
                variant: 'control',
                mode: 'cold_start',
            },
        });
        expect(ok.ok).toBe(true);
        const bad = validateEvent({
            ...base(),
            type: 'rec_click',
            props: {
                recId: 'r',
                itemType: 'resource',
                variant: 'control',
                mode: 'x',
            },
        });
        expect(bad.ok).toBe(false);
    });
});

describe('rec_impression signals (training field)', () => {
    const imp = (extra: Record<string, unknown>) =>
        validateEvent({
            ...base(),
            type: 'rec_impression',
            props: {
                recId: 'r',
                itemType: 'resource',
                position: 0,
                variant: 'control',
                ...extra,
            },
        });
    it('is optional (legacy events stay valid)', () => {
        expect(imp({}).ok).toBe(true);
    });
    it('accepts in-range signals and rejects out-of-range or oversized maps', () => {
        expect(imp({ signals: { need: 0.4, srs: 1 } }).ok).toBe(true);
        expect(imp({ signals: { need: 1.5 } }).ok).toBe(false);
        expect(imp({ signals: { need: -0.1 } }).ok).toBe(false);
        const big = Object.fromEntries(
            Array.from({ length: 13 }, (_, i) => [`s${i}`, 0.1])
        );
        expect(imp({ signals: big }).ok).toBe(false);
    });
});
