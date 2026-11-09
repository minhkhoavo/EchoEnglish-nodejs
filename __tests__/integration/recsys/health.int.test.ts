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
