import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { CleanEvent, PipelineLock } from '~/recsys/etl/models.js';
import { consentService } from '~/recsys/privacy/consentService.js';
import { Consent, ConsentLedger } from '~/recsys/privacy/consentModel.js';
import { StreamExporter, StreamState } from '~/recsys/stream/exporter.js';
import { ErasureTombstone, recordTombstones } from '~/recsys/stream/erasure.js';
import {
    pseudonymise,
    requirePseudonymSalt,
} from '~/recsys/stream/pseudonym.js';
import { StreamProducer } from '~/recsys/stream/producer.js';
import { parseWire } from '~/recsys/stream/wire.js';

jest.setTimeout(120_000);
const SALT = 'unit-test-salt-0123456789';
const newUser = () => new mongoose.Types.ObjectId().toString();

class FakeProducer implements StreamProducer {
    sent: Array<{ topic: string; key: string; value: string }> = [];
    failNext = false;
    async send(topic: string, messages: Array<{ key: string; value: string }>) {
        if (this.failNext) {
            this.failNext = false;
            throw new Error('broker unavailable');
        }
        for (const m of messages) this.sent.push({ topic, ...m });
    }
    async disconnect() {}
}

async function silver(
    userId: string,
    type: string,
    occurredAt = new Date(),
    props: Record<string, unknown> = {}
) {
    return CleanEvent.create({
        eventId: randomUUID(),
        rawId: new mongoose.Types.ObjectId(),
        userId,
        type,
        occurredAt,
        day: occurredAt.toISOString().slice(0, 10),
        hour: 12,
        props,
        pipelineVersion: '1.0.0',
        runId: 'r',
        receivedAt: occurredAt,
    });
}

beforeAll(async () => {
    await startMongo();
    await syncIndexes(
        CleanEvent,
        PipelineLock,
        ErasureTombstone,
        Consent,
        ConsentLedger
    );
});
afterAll(stopMongo);
beforeEach(clearDb);

describe('stream exporter', () => {
    it('exports pseudonymised events keyed by pseudonym and never leaks the raw user id', async () => {
        const u = newUser();
        await consentService.update(u, { analytics: true });
        await silver(u, 'resource_viewed', new Date(), { resourceId: 'r1' });
        const producer = new FakeProducer();
        const res = await new StreamExporter({
            producer,
            salt: SALT,
        }).runOnce();
        expect(res).toMatchObject({ status: 'ok', exported: 1 });
        const m = producer.sent[0];
        expect(m.topic).toBe('echo.learning_events.v1.vn');
        expect(m.key).toBe(pseudonymise(u, 'vn', SALT));
        expect(m.value).not.toContain(u);
        expect(parseWire(m.value)).toMatchObject({
            type: 'resource_viewed',
            region: 'vn',
        });
    });

    it('skips behavioural events without analytics consent but exports service events', async () => {
        const u = newUser();
        await silver(u, 'resource_viewed');
        await silver(u, 'question_answered', new Date(), {
            skillKey: 'p5.wordform',
            correct: true,
        });
        const producer = new FakeProducer();
        const res = await new StreamExporter({
            producer,
            salt: SALT,
        }).runOnce();
        expect(res.exported).toBe(1);
        expect(res.skippedConsent).toBe(1);
        expect(producer.sent.map((s) => parseWire(s.value)!.type)).toEqual([
            'question_answered',
        ]);
    });

    it('is resumable and at-least-once: broker failure keeps the cursor, retry re-sends', async () => {
        const u = newUser();
        await consentService.update(u, { analytics: true });
        for (let i = 0; i < 3; i++) await silver(u, 'session_started');
        const producer = new FakeProducer();
        const exporter = new StreamExporter({ producer, salt: SALT });
        producer.failNext = true;
        const failed = await exporter.runOnce();
        expect(failed.status).toBe('failed');
        expect(failed.error).toMatch(/broker unavailable/);
        expect(producer.sent).toHaveLength(0);
        const ok = await exporter.runOnce();
        expect(ok.exported).toBe(3);
        const again = await exporter.runOnce();
        expect(again.status).toBe('idle');
        expect(producer.sent).toHaveLength(3); // nothing re-sent once acknowledged
        const st = await StreamState.findById('silver').lean<{
            lastError?: string;
        }>();
        expect(st?.lastError).toBeUndefined();
    });

    it('never exports events at or before an erasure, and later service events need fresh consent', async () => {
        const u = newUser();
        await consentService.update(u, { analytics: true });
        const erasedAt = new Date('2026-03-10T00:00:00Z');
        await silver(u, 'question_answered', new Date('2026-03-09T00:00:00Z'));
        await recordTombstones(
            [{ pseudonym: pseudonymise(u, 'vn', SALT), region: 'vn' }],
            erasedAt
        );
        await silver(u, 'credit_spent', new Date('2026-03-11T00:00:00Z'), {});
        const producer = new FakeProducer();
        // analytics still consented in this scenario → post-erasure events flow, pre-erasure do not
        const res = await new StreamExporter({
            producer,
            salt: SALT,
        }).runOnce();
        expect(res.skippedErased).toBe(1);
        expect(res.exported).toBe(1);
        // consent withdrawn: post-erasure service events are skipped too
        await consentService.update(u, { analytics: false });
        await silver(u, 'credit_spent', new Date('2026-03-12T00:00:00Z'), {});
        const res2 = await new StreamExporter({
            producer,
            salt: SALT,
        }).runOnce();
        expect(res2.exported).toBe(0);
        expect(res2.skippedConsent).toBe(1);
    });

    it('two concurrent runs never both export (lease)', async () => {
        const u = newUser();
        await consentService.update(u, { analytics: true });
        await silver(u, 'session_started');
        const producer = new FakeProducer();
        const a = new StreamExporter({ producer, salt: SALT });
        const results = await Promise.all([a.runOnce(), a.runOnce()]);
        expect(results.map((r) => r.status)).not.toContain('failed');
        expect(producer.sent).toHaveLength(1); // exactly once, never duplicated by the race
    });
});

describe('pseudonym guard', () => {
    it('fails closed without a real secret', () => {
        expect(() => requirePseudonymSalt(undefined)).toThrow(
            /RECSYS_PSEUDONYM_SALT/
        );
        expect(() => requirePseudonymSalt('dev-only-salt')).toThrow();
        expect(() => requirePseudonymSalt('short')).toThrow();
        expect(requirePseudonymSalt(SALT)).toBe(SALT);
    });
    it('is stable, keyed and region-scoped', () => {
        const u = newUser();
        expect(pseudonymise(u, 'vn', SALT)).toBe(pseudonymise(u, 'vn', SALT));
        expect(pseudonymise(u, 'vn', SALT)).not.toBe(
            pseudonymise(u, 'sg', SALT)
        );
        expect(pseudonymise(u, 'vn', SALT)).not.toBe(
            pseudonymise(u, 'vn', SALT + 'x')
        );
        expect(pseudonymise(u, 'vn', SALT)).toHaveLength(32);
    });
});
