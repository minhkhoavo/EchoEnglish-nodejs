import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
import { Consent, ConsentLedger } from '~/recsys/privacy/consentModel.js';
import { eventService } from '~/recsys/events/eventService.js';
import { consentService } from '~/recsys/privacy/consentService.js';

jest.setTimeout(120_000);
const userId = new mongoose.Types.ObjectId().toString();
const ev = (over: Record<string, unknown> = {}) => ({
    eventId: randomUUID(),
    schemaVersion: 1,
    type: 'resource_viewed',
    occurredAt: new Date().toISOString(),
    props: { resourceId: 'b'.repeat(24), dwellSec: 30 },
    ...over,
});

beforeAll(async () => {
    await startMongo();
    await syncIndexes(LearningEvent, Consent, ConsentLedger);
});
afterAll(stopMongo);
beforeEach(async () => {
    await clearDb();
    consentService.clearCache();
});

describe('eventService.ingest', () => {
    it('drops behavioural events without analytics consent, keeps nothing', async () => {
        const r = await eventService.ingest(userId, [ev()], { source: 'web' });
        expect(r).toMatchObject({ accepted: 0, droppedNoConsent: 1 });
        expect(await LearningEvent.countDocuments()).toBe(0);
    });

    it('stores behavioural events once consent is granted and is idempotent on eventId', async () => {
        await consentService.update(userId, { analytics: true });
        const e = ev();
        const first = await eventService.ingest(userId, [e], { source: 'web' });
        const second = await eventService.ingest(userId, [e], {
            source: 'web',
        });
        expect(first.accepted).toBe(1);
        expect(second).toMatchObject({ accepted: 0, duplicates: 1 });
        expect(await LearningEvent.countDocuments()).toBe(1);
    });

    it('handles a mixed batch: valid, duplicate-in-batch, invalid, server-only', async () => {
        await consentService.update(userId, { analytics: true });
        const dup = ev();
        const res = await eventService.ingest(
            userId,
            [
                dup,
                dup,
                ev({ props: { dwellSec: -1 } }),
                ev({
                    type: 'credit_spent',
                    props: { feature: 'x', credits: 5 },
                }),
            ],
            { source: 'web' }
        );
        expect(res.accepted).toBe(1);
        expect(res.duplicates).toBe(1);
        expect(res.rejected.map((r) => r.index).sort()).toEqual([2, 3]);
    });

    it('partial duplicates against stored events still insert the new ones', async () => {
        await consentService.update(userId, { analytics: true });
        const a = ev();
        await eventService.ingest(userId, [a], { source: 'web' });
        const res = await eventService.ingest(userId, [a, ev()], {
            source: 'web',
        });
        expect(res).toMatchObject({ accepted: 1, duplicates: 1 });
        expect(await LearningEvent.countDocuments()).toBe(2);
    });

    it('rejects stale and future-dated events', async () => {
        await consentService.update(userId, { analytics: true });
        const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
        const future = new Date(Date.now() + 3_600_000).toISOString();
        const res = await eventService.ingest(
            userId,
            [ev({ occurredAt: old }), ev({ occurredAt: future })],
            { source: 'web' }
        );
        expect(res.accepted).toBe(0);
        expect(res.rejected).toHaveLength(2);
    });

    it('server-trusted service events need no behavioural consent', async () => {
        const ok = await eventService.emitAsync(userId, 'credit_spent', {
            feature: 'speech',
            credits: 2,
        });
        expect(ok).toBe(true);
        expect(
            await LearningEvent.countDocuments({ type: 'credit_spent' })
        ).toBe(1);
    });
});

describe('eventService.emit contract', () => {
    const prev = process.env.RECSYS_ENABLED;
    afterEach(() => {
        process.env.RECSYS_ENABLED = prev;
    });

    it('never throws, even for an invalid user id, and stores valid service events', async () => {
        process.env.RECSYS_ENABLED = 'true';
        expect(() =>
            eventService.emit('not-an-object-id', 'credit_spent', {
                feature: 'x',
                credits: 1,
            })
        ).not.toThrow();
        const ok = await eventService.emitAsync(userId, 'credit_spent', {
            feature: 'speech',
            credits: 2,
        });
        expect(ok).toBe(true);
        const row = await LearningEvent.findOne().lean<{
            type: string;
            source: string;
            processing?: { status?: string };
        }>();
        expect(row).toMatchObject({ type: 'credit_spent', source: 'server' });
        expect(row?.processing?.status).toBe('pending');
    });
});
