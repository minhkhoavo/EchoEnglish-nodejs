import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { CleanEvent, PipelineLock } from '~/recsys/etl/models.js';
import { Consent, ConsentLedger } from '~/recsys/privacy/consentModel.js';
import { consentService } from '~/recsys/privacy/consentService.js';
import { StreamExporter } from '~/recsys/stream/exporter.js';
import { ErasureTombstone } from '~/recsys/stream/erasure.js';
import {
    LearnerRegion,
    RegionError,
    knownRegions,
    regionService,
} from '~/recsys/stream/regions.js';
import { StreamProducer } from '~/recsys/stream/producer.js';
import { pseudonymise } from '~/recsys/stream/pseudonym.js';
import { parseWire } from '~/recsys/stream/wire.js';
import { loadBatch } from '~/recsys/warehouse/loader.js';
import { dataSubjectService } from '~/recsys/privacy/dataSubjectService.js';
import recsysRouter from '~/recsys/http/routes.js';
import ErrorMiddleware from '~/middleware/errorMiddleware.js';

jest.setTimeout(120_000);
const SALT = 'residency-test-salt-0123456789';
const newUser = () => new mongoose.Types.ObjectId().toString();

class Capture implements StreamProducer {
    sent: Array<{ topic: string; key: string; value: string }> = [];
    async send(topic: string, m: Array<{ key: string; value: string }>) {
        for (const x of m) this.sent.push({ topic, ...x });
    }
    async disconnect() {}
}
const silver = (userId: string) =>
    CleanEvent.create({
        eventId: randomUUID(),
        rawId: new mongoose.Types.ObjectId(),
        userId,
        type: 'question_answered',
        occurredAt: new Date(),
        day: '2026-03-10',
        hour: 9,
        props: { skillKey: 'p5.wordform', correct: true },
        pipelineVersion: '1.0.0',
        runId: 'r',
        receivedAt: new Date(),
    });

beforeAll(async () => {
    process.env.RECSYS_PSEUDONYM_SALT = SALT;
    await startMongo();
    await syncIndexes(
        LearnerRegion,
        CleanEvent,
        PipelineLock,
        Consent,
        ConsentLedger,
        ErasureTombstone
    );
});
afterAll(stopMongo);
beforeEach(async () => {
    await clearDb();
    process.env.RECSYS_REGIONS = 'vn,sg';
});
afterEach(() => {
    delete process.env.RECSYS_REGIONS;
    delete process.env.RECSYS_DEFAULT_REGION;
});

describe('region tag', () => {
    it('defaults to the default region and honours a stored tag', async () => {
        const [a, b] = [newUser(), newUser()];
        await regionService.set(b, 'SG'); // case-insensitive
        const m = await regionService.resolve([a, b]);
        expect(m.get(a)).toBe('vn');
        expect(m.get(b)).toBe('sg');
    });
    it('rejects an unknown region and an invalid user id', async () => {
        await expect(regionService.set(newUser(), 'eu')).rejects.toBeInstanceOf(
            RegionError
        );
        await expect(regionService.set('nope', 'vn')).rejects.toBeInstanceOf(
            RegionError
        );
        expect(await LearnerRegion.countDocuments()).toBe(0);
    });
    it('a stored tag for a region that is no longer configured falls back to the default (never routes to a stale sink)', async () => {
        const u = newUser();
        await regionService.set(u, 'sg');
        process.env.RECSYS_REGIONS = 'vn';
        expect((await regionService.resolve([u])).get(u)).toBe('vn');
    });
    it('knownRegions defaults to the default region alone', () => {
        delete process.env.RECSYS_REGIONS;
        process.env.RECSYS_DEFAULT_REGION = 'vn';
        expect(knownRegions()).toEqual(['vn']);
    });
});

describe('routing and isolation', () => {
    it('sends each learner to their own regional topic with a region-scoped pseudonym', async () => {
        const [vn, sg] = [newUser(), newUser()];
        await regionService.set(sg, 'sg');
        for (const u of [vn, sg]) {
            await consentService.update(u, { analytics: true });
            await silver(u);
        }
        const cap = new Capture();
        await new StreamExporter({ producer: cap, salt: SALT }).runOnce();
        const byTopic = Object.fromEntries(
            cap.sent.map((s) => [s.topic, parseWire(s.value)!])
        );
        expect(Object.keys(byTopic).sort()).toEqual([
            'echo.learning_events.v1.sg',
            'echo.learning_events.v1.vn',
        ]);
        expect(byTopic['echo.learning_events.v1.vn'].u).toBe(
            pseudonymise(vn, 'vn', SALT)
        );
        expect(byTopic['echo.learning_events.v1.sg'].u).toBe(
            pseudonymise(sg, 'sg', SALT)
        );
        // the same person would get unrelated identifiers in different regions
        expect(pseudonymise(vn, 'vn', SALT)).not.toBe(
            pseudonymise(vn, 'sg', SALT)
        );
    });

    it("a regional loader refuses another region's messages (cross-region write refused)", async () => {
        const [vn, sg] = [newUser(), newUser()];
        await regionService.set(sg, 'sg');
        for (const u of [vn, sg]) {
            await consentService.update(u, { analytics: true });
            await silver(u);
        }
        const cap = new Capture();
        await new StreamExporter({ producer: cap, salt: SALT }).runOnce();
        const rows: unknown[] = [];
        const wh = {
            insert: async (_t: string, r: unknown[]) => void rows.push(...r),
        };
        // misconfigured consumer: feed BOTH topics into the vn loader
        const res = await loadBatch(
            cap.sent.map((s) => s.value),
            wh,
            { region: 'vn' }
        );
        expect(res).toMatchObject({ inserted: 1, wrongRegion: 1 });
        expect((rows[0] as { region: string }).region).toBe('vn');
    });
});

describe('data-subject rights', () => {
    it('exports the tag, tombstones EVERY region on erase, and deletes the tag', async () => {
        const u = newUser();
        await regionService.set(u, 'sg');
        expect(
            (await dataSubjectService.exportUserData(u)).dataRegion
        ).toMatchObject({ region: 'sg' });
        const out = await dataSubjectService.eraseUserData(u);
        expect(out.downstream.tombstones).toBe(2); // vn + sg: a learner who moved regions is covered
        expect(await LearnerRegion.countDocuments({ userId: u })).toBe(0);
        const t =
            await ErasureTombstone.find().lean<Array<{ pseudonym: string }>>();
        expect(t.map((x) => x.pseudonym).sort()).toEqual(
            ['vn', 'sg'].map((r) => pseudonymise(u, r, SALT)).sort()
        );
    });
});

describe('admin endpoint', () => {
    const app = (scope: string) => {
        const a = express();
        a.use(express.json());
        a.use((req, _res, next) => {
            (req as unknown as { user: unknown }).user = {
                id: new mongoose.Types.ObjectId().toString(),
                scope,
            };
            next();
        });
        a.use(recsysRouter);
        a.use(ErrorMiddleware.handleError as never);
        return a;
    };
    it('is admin-only, validates the region, and persists the tag', async () => {
        const u = newUser();
        expect(
            (
                await request(app('USER'))
                    .put(`/admin/recsys/learners/${u}/region`)
                    .send({ region: 'sg' })
            ).status
        ).toBe(403);
        expect(
            (
                await request(app('ADMIN'))
                    .put(`/admin/recsys/learners/${u}/region`)
                    .send({ region: 'eu' })
            ).status
        ).toBe(400);
        expect(
            (
                await request(app('ADMIN'))
                    .put(`/admin/recsys/learners/${u}/region`)
                    .send({ region: 'sg' })
            ).status
        ).toBe(200);
        expect((await regionService.resolve([u])).get(u)).toBe('sg');
    });
});
