import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
import {
    CleanEvent,
    DailyFacts,
    PipelineRun,
    PipelineLock,
} from '~/recsys/etl/models.js';
import { pipelineService } from '~/recsys/etl/pipeline.js';
import { eventService } from '~/recsys/events/eventService.js';

jest.setTimeout(120_000);
const uid = new mongoose.Types.ObjectId().toString();

const q = (
    skillKey: string,
    correct: boolean,
    at: Date,
    over: Record<string, unknown> = {}
) => ({
    type: 'question_answered' as const,
    occurredAt: at,
    props: { skillKey, correct, origin: 'drill', timeMs: 10_000, ...over },
});

beforeAll(async () => {
    process.env.RECSYS_ENABLED = 'true';
    await startMongo();
    await syncIndexes(
        LearningEvent,
        CleanEvent,
        DailyFacts,
        PipelineRun,
        PipelineLock
    );
});
afterAll(stopMongo);
beforeEach(clearDb);

describe('pipeline end to end', () => {
    it('bronze → silver → gold with lineage and DQ', async () => {
        const now = new Date();
        await eventService.emitManyAsync(uid, [
            q('p5.wordform', true, now),
            q('p5.wordform', false, now),
            {
                type: 'flashcard_reviewed',
                occurredAt: now,
                props: {
                    flashcardId: 'c'.repeat(24),
                    remembered: true,
                    prevLevel: 1,
                    newLevel: 2,
                    latencyMs: 5000,
                },
            },
        ]);
        const run = await pipelineService.runOnce();
        expect(run).not.toBeNull();
        expect(run!.status).toBe('ok');
        expect(run!.counts.read).toBeGreaterThan(0);

        const facts = await DailyFacts.find({ userId: uid }).lean<
            Array<{
                questionsAnswered: number;
                questionsCorrect: number;
                lineage: { pipelineVersion: string; sourceEventCount: number };
            }>
        >();
        expect(facts).toHaveLength(1);
        expect(facts[0].questionsAnswered).toBe(2);
        expect(facts[0].questionsCorrect).toBe(1);
        expect(facts[0].lineage.pipelineVersion).toBeDefined();
        expect(
            await LearningEvent.countDocuments({
                'processing.status': 'pending',
            })
        ).toBe(0);
        expect(await PipelineRun.countDocuments({ status: 'ok' })).toBe(1);
        expect(await PipelineLock.countDocuments()).toBe(0); // lease released
    });

    it('replaying the same raw events is idempotent (no double counting)', async () => {
        const now = new Date();
        await eventService.emitManyAsync(uid, [
            q('a', true, now),
            q('a', true, now),
        ]);
        await pipelineService.runOnce();
        // simulate crash-before-ack: put raw back to pending
        await LearningEvent.updateMany(
            {},
            { $set: { 'processing.status': 'pending' } }
        );
        const second = await pipelineService.runOnce();
        expect(second!.counts.cleaned).toBe(0);
        expect(second!.counts.alreadyClean).toBe(2);
        const f = await DailyFacts.findOne({ userId: uid }).lean<{
            questionsAnswered: number;
        }>();
        expect(f!.questionsAnswered).toBe(2);
        expect(await CleanEvent.countDocuments()).toBe(2);
    });

    it('late-arriving events recompute the affected day correctly', async () => {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 3_600_000);
        await eventService.emitManyAsync(uid, [q('a', true, yesterday)]);
        await pipelineService.runOnce();
        await eventService.emitManyAsync(uid, [q('a', false, yesterday)]); // arrives late
        await pipelineService.runOnce();
        const rows = await DailyFacts.find({ userId: uid }).lean<
            Array<{ questionsAnswered: number; questionsCorrect: number }>
        >();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            questionsAnswered: 2,
            questionsCorrect: 1,
        });
    });

    it('rejects contract-violating raw rows without blocking good ones, and degrades DQ', async () => {
        const now = new Date();
        await LearningEvent.create({
            eventId: randomUUID(),
            schemaVersion: 1,
            type: 'pronunciation_scored',
            userId: uid,
            source: 'server',
            occurredAt: now,
            receivedAt: now,
            props: { accuracy: 'bad' },
            processing: { status: 'pending' },
        });
        await eventService.emitManyAsync(uid, [q('a', true, now)]);
        const run = await pipelineService.runOnce();
        expect(run!.counts.rejected).toBe(1);
        expect(run!.counts.cleaned).toBe(1);
        expect(run!.status).toBe('degraded');
        const bad = await LearningEvent.findOne({
            'processing.status': 'rejected',
        }).lean<{ processing: { reason: string } }>();
        expect(bad!.processing.reason).toContain('accuracy');
    });

    it('only one runner holds the lease; a stale lease can be taken over', async () => {
        expect(await pipelineService.acquireLease('A')).toBe(true);
        expect(await pipelineService.acquireLease('B')).toBe(false);
        expect(await pipelineService.runOnce({ owner: 'B' })).toBeNull();
        const future = new Date(Date.now() + 10 * 60_000);
        expect(await pipelineService.acquireLease('B', future)).toBe(true);
    });

    it('invokes the afterFacts hook with touched users only', async () => {
        await eventService.emitManyAsync(uid, [q('a', true, new Date())]);
        const seen: string[][] = [];
        await pipelineService.runOnce({
            afterFacts: async (u) => void seen.push(u),
        });
        expect(seen).toEqual([[uid]]);
    });
});
