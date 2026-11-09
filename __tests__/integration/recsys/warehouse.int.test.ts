import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { CleanEvent, DailyFacts, PipelineLock } from '~/recsys/etl/models.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
import { Consent, ConsentLedger } from '~/recsys/privacy/consentModel.js';
import { DataSubjectService } from '~/recsys/privacy/dataSubjectService.js';
import { ErasureTombstone, recordTombstones } from '~/recsys/stream/erasure.js';
import { pseudonymise } from '~/recsys/stream/pseudonym.js';
import { toWire } from '~/recsys/stream/wire.js';
import { Warehouse } from '~/recsys/warehouse/clickhouse.js';
import { loadBatch } from '~/recsys/warehouse/loader.js';
import { sweepRecentTombstones } from '~/recsys/warehouse/erasure.js';
import { ddl } from '~/recsys/warehouse/schema.js';

jest.setTimeout(120_000);
const SALT = 'unit-test-salt-0123456789';

class FakeWarehouse implements Pick<Warehouse, 'insert' | 'command' | 'close'> {
    rows: Array<Record<string, unknown>> = [];
    commands: Array<{ sql: string; params?: Record<string, unknown> }> = [];
    failCommands = false;
    async insert(_t: string, rows: Array<Record<string, unknown>>) {
        this.rows.push(...rows);
    }
    async command(sql: string, params?: Record<string, unknown>) {
        if (this.failCommands) throw new Error('clickhouse down');
        this.commands.push({ sql, params });
    }
    async close() {}
}

const wire = (
    userId: string,
    region: string,
    ts: Date,
    type = 'question_answered'
) =>
    JSON.stringify(
        toWire(
            {
                eventId: `e-${Math.random()}`,
                userId,
                type,
                occurredAt: ts,
                receivedAt: ts,
                day: ts.toISOString().slice(0, 10),
                hour: 9,
                pipelineVersion: '1.0.0',
                props: { skillKey: 'p5.wordform', correct: true },
            },
            pseudonymise(userId, region, SALT),
            region
        )
    );

beforeAll(async () => {
    process.env.RECSYS_PSEUDONYM_SALT = SALT;
    await startMongo();
    await syncIndexes(
        ErasureTombstone,
        CleanEvent,
        LearningEvent,
        DailyFacts,
        PipelineLock,
        Consent,
        ConsentLedger
    );
});
afterAll(stopMongo);
beforeEach(async () => {
    await clearDb();
    process.env.RECSYS_REGIONS = 'vn,sg';
    process.env.RECSYS_CLICKHOUSE_ENABLED = 'true';
});
afterEach(() => {
    delete process.env.RECSYS_REGIONS;
    delete process.env.RECSYS_CLICKHOUSE_ENABLED;
});

describe('warehouse loader', () => {
    const u = new mongoose.Types.ObjectId().toString();
    const t = new Date('2026-03-10T05:00:00Z');

    it('maps wire messages to columns and drops invalid / foreign-region / erased ones', async () => {
        const wh = new FakeWarehouse();
        await recordTombstones(
            [
                {
                    pseudonym: pseudonymise('x'.repeat(24), 'vn', SALT),
                    region: 'vn',
                },
            ],
            new Date('2026-03-12T00:00:00Z')
        );
        const res = await loadBatch(
            [
                wire(u, 'vn', t),
                'not json',
                JSON.stringify({ v: 99 }),
                wire(u, 'sg', t), // foreign region
                wire('x'.repeat(24), 'vn', t), // erased subject
            ],
            wh,
            { region: 'vn' }
        );
        expect(res).toEqual({
            received: 5,
            inserted: 1,
            invalid: 2,
            erased: 1,
            wrongRegion: 1,
        });
        expect(wh.rows[0]).toMatchObject({
            user_pseudo: pseudonymise(u, 'vn', SALT),
            region: 'vn',
            type: 'question_answered',
            day: '2026-03-10',
            occurred_at: '2026-03-10T05:00:00.000Z',
        });
        expect(JSON.parse(wh.rows[0].props as string)).toEqual({
            skillKey: 'p5.wordform',
            correct: true,
        });
    });

    it('keeps events that occurred after an erasure (fresh consent era)', async () => {
        const wh = new FakeWarehouse();
        await recordTombstones(
            [{ pseudonym: pseudonymise(u, 'vn', SALT), region: 'vn' }],
            new Date('2026-03-09T00:00:00Z')
        );
        const res = await loadBatch([wire(u, 'vn', t)], wh, { region: 'vn' });
        expect(res.inserted).toBe(1);
    });
});

describe('erasure propagation', () => {
    it('tombstones every known region and deletes from the warehouse; reports truthfully', async () => {
        const wh = new FakeWarehouse();
        const svc = new DataSubjectService(
            async () => wh as unknown as Warehouse
        );
        const u = new mongoose.Types.ObjectId().toString();
        const out = await svc.eraseUserData(u);
        expect(out.downstream).toEqual({ tombstones: 2, warehouse: 'deleted' });
        const expected = ['vn', 'sg']
            .map((r) => pseudonymise(u, r, SALT))
            .sort();
        expect((wh.commands[0].params!.p as string[]).slice().sort()).toEqual(
            expected
        );
        const docs =
            await ErasureTombstone.find().lean<
                Array<{ pseudonym: string; warehousePending: boolean }>
            >();
        expect(docs).toHaveLength(2);
        expect(docs.every((d) => d.warehousePending === false)).toBe(true);
    });

    it('a failed warehouse delete is reported, stays pending, and is retried by the sweep', async () => {
        const wh = new FakeWarehouse();
        wh.failCommands = true;
        const svc = new DataSubjectService(
            async () => wh as unknown as Warehouse
        );
        const u = new mongoose.Types.ObjectId().toString();
        const out = await svc.eraseUserData(u);
        expect(out.downstream.warehouse).toBe('failed');
        expect(
            await ErasureTombstone.countDocuments({ warehousePending: true })
        ).toBe(2);
        wh.failCommands = false;
        // far in the future: outside the race window, so only the *pending* flag selects them
        const n = await sweepRecentTombstones(
            wh,
            new Date(Date.now() + 30 * 86_400_000)
        );
        expect(n).toBe(2);
        expect(wh.commands).toHaveLength(1);
        expect(
            await ErasureTombstone.countDocuments({ warehousePending: true })
        ).toBe(0);
    });

    it('does nothing downstream when no pseudonym secret is configured (nothing was ever exported)', async () => {
        const saved = process.env.RECSYS_PSEUDONYM_SALT;
        delete process.env.RECSYS_PSEUDONYM_SALT;
        try {
            const out = await new DataSubjectService().eraseUserData(
                new mongoose.Types.ObjectId().toString()
            );
            expect(out.downstream).toEqual({
                tombstones: 0,
                warehouse: 'not_enabled',
            });
        } finally {
            process.env.RECSYS_PSEUDONYM_SALT = saved;
        }
    });
});

describe('schema', () => {
    it('is idempotent, deduplicating and injection-safe', () => {
        const stmts = ddl('echo`; DROP TABLE x; --', 400);
        expect(stmts.join('\n')).toContain('ReplacingMergeTree');
        expect(stmts.join('\n')).toContain('IF NOT EXISTS');
        expect(stmts.join('\n')).not.toContain('DROP TABLE');
    });
});
