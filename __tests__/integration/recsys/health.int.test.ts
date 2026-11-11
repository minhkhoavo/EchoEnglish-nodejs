import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
import { PipelineRun } from '~/recsys/etl/models.js';
import { checkHealth } from '~/recsys/analytics/healthService.js';

jest.setTimeout(120_000);
const uid = new mongoose.Types.ObjectId();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

const raw = (status: string, receivedAt: Date) => ({
    eventId: randomUUID(),
    schemaVersion: 1,
    type: 'credit_spent',
    userId: uid,
    source: 'server',
    occurredAt: receivedAt,
    receivedAt,
    props: { feature: 'x', credits: 1 },
    processing: { status },
});
const run = (
    status: string,
    finishedMinAgo: number,
    dq: Array<{ name: string; passed: boolean }> = []
) =>
    PipelineRun.create({
        runId: randomUUID(),
        pipelineVersion: '1',
        startedAt: minutesAgo(finishedMinAgo + 1),
        finishedAt: minutesAgo(finishedMinAgo),
        status,
        dq,
        counts: { read: 1 },
    });

beforeAll(async () => {
    await startMongo();
    await syncIndexes(LearningEvent, PipelineRun);
});
afterAll(stopMongo);
beforeEach(clearDb);

it('ok on an empty system and on a fresh healthy run', async () => {
    expect((await checkHealth()).status).toBe('ok');
    await run('ok', 1);
    await LearningEvent.create(raw('processed', minutesAgo(2)));
    const h = await checkHealth();
    expect(h.status).toBe('ok');
    expect(h.problems).toEqual([]);
});

it('down when events are pending and the pipeline has never run', async () => {
    await LearningEvent.create(raw('pending', minutesAgo(1)));
    const h = await checkHealth();
    expect(h.status).toBe('down');
    expect(h.problems[0]).toContain('never run');
});

it('down when the scheduler stalled with events waiting', async () => {
    await run('ok', 60);
    await LearningEvent.create(raw('pending', minutesAgo(50)));
    const h = await checkHealth();
    expect(h.status).toBe('down');
    expect(h.problems.join(' ')).toMatch(/no pipeline run/);
});

it('down when the last run failed', async () => {
    await run('failed', 1);
    expect((await checkHealth()).status).toBe('down');
});

it('degraded on failing DQ checks, stale backlog or high reject rate', async () => {
    await run('degraded', 1, [{ name: 'reject_rate', passed: false }]);
    expect(await checkHealth()).toMatchObject({
        status: 'degraded',
        failedDqChecks: ['reject_rate'],
    });

    await clearDb();
    await run('ok', 1);
    await LearningEvent.create(raw('pending', minutesAgo(45)));
    const stale = await checkHealth();
    expect(stale.status).toBe('degraded');
    expect(stale.freshnessLagMinutes).toBeGreaterThan(30);

    await clearDb();
    await run('ok', 1);
    await LearningEvent.insertMany([
        ...Array.from({ length: 10 }, () => raw('rejected', minutesAgo(5))),
        ...Array.from({ length: 30 }, () => raw('processed', minutesAgo(5))),
    ]);
    const rej = await checkHealth();
    expect(rej.status).toBe('degraded');
    expect(rej.rejectRate24h).toBeCloseTo(0.25, 2);
});

describe('Phase 3 health (only when the flags are on)', () => {
    const { CleanEvent } = jest.requireActual('~/recsys/etl/models.js');
    const { StreamState } = jest.requireActual('~/recsys/stream/exporter.js');
    const { ErasureTombstone } = jest.requireActual(
        '~/recsys/stream/erasure.js'
    );
    const { RecModel } = jest.requireActual('~/recsys/learning/registry.js');
    const silver = () =>
        CleanEvent.create({
            eventId: randomUUID(),
            rawId: new mongoose.Types.ObjectId(),
            userId: uid,
            type: 'session_started',
            occurredAt: new Date(),
            day: '2026-03-10',
            hour: 9,
            props: {},
            pipelineVersion: '1',
            runId: 'r',
            receivedAt: new Date(),
        });
    afterEach(() => {
        delete process.env.RECSYS_STREAM_ENABLED;
        delete process.env.RECSYS_CLICKHOUSE_ENABLED;
        delete process.env.RECSYS_RETRAIN_ENABLED;
    });

    it('reports nothing about Phase 3 by default', async () => {
        await silver();
        const h = await checkHealth();
        expect(h.phase3).toBeUndefined();
        expect(h.status).toBe('ok');
    });

    it('stream: a recorded exporter error degrades health', async () => {
        process.env.RECSYS_STREAM_ENABLED = 'true';
        await StreamState.create({
            _id: 'silver',
            updatedAt: new Date(),
            lastError: 'broker unavailable',
        });
        const h = await checkHealth();
        expect(h.status).toBe('degraded');
        expect(h.problems.join()).toMatch(
            /stream exporter error: broker unavailable/
        );
        expect(h.phase3!.stream!.lastError).toBe('broker unavailable');
    });

    it('stream: a backlog with an idle cursor is a stall; a fresh cursor is fine', async () => {
        process.env.RECSYS_STREAM_ENABLED = 'true';
        const first = await silver();
        await StreamState.create({
            _id: 'silver',
            cursorId: first._id,
            updatedAt: minutesAgo(40),
        });
        await silver(); // one event past the cursor
        let h = await checkHealth();
        expect(h.status).toBe('degraded');
        expect(h.problems.join()).toMatch(/stalled: 1 silver events waiting/);
        await StreamState.updateOne(
            { _id: 'silver' },
            { $set: { updatedAt: new Date() } }
        );
        h = await checkHealth();
        expect(h.problems.join()).not.toMatch(/stalled/);
        expect(h.phase3!.stream!.backlog).toBe(1);
    });

    it('stream: an exporter that has never run but has events waiting is a stall', async () => {
        process.env.RECSYS_STREAM_ENABLED = 'true';
        await silver();
        const h = await checkHealth();
        expect(h.problems.join()).toMatch(/never advanced/);
    });

    it('erasure: a warehouse delete pending too long degrades health and says why it matters', async () => {
        process.env.RECSYS_CLICKHOUSE_ENABLED = 'true';
        await ErasureTombstone.create({
            pseudonym: 'p1',
            region: 'vn',
            at: minutesAgo(30),
            warehousePending: true,
        });
        await ErasureTombstone.create({
            pseudonym: 'p2',
            region: 'vn',
            at: minutesAgo(1),
            warehousePending: false,
        });
        const h = await checkHealth();
        expect(h.status).toBe('degraded');
        expect(h.problems.join()).toMatch(
            /1 warehouse erasure\(s\) pending .* not complete until deleted/
        );
        expect(h.phase3!.erasure!.pendingWarehouseDeletes).toBe(1);
    });

    it('erasure: a pending delete that is still young is not yet a problem', async () => {
        process.env.RECSYS_CLICKHOUSE_ENABLED = 'true';
        await ErasureTombstone.create({
            pseudonym: 'p1',
            region: 'vn',
            at: minutesAgo(2),
            warehousePending: true,
        });
        expect((await checkHealth()).status).toBe('ok');
    });

    it('retraining: reports the live model (informational)', async () => {
        process.env.RECSYS_RETRAIN_ENABLED = 'true';
        expect((await checkHealth()).phase3!.liveModel).toBeNull();
        await RecModel.create({
            version: 3,
            algo: 'logreg-v1',
            status: 'active',
            dataSource: 'production',
            trainedAt: new Date(),
            allocationPct: 5,
        });
        expect((await checkHealth()).phase3!.liveModel).toEqual({
            version: 3,
            allocationPct: 5,
        });
    });
});
