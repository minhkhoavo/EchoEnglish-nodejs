import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { FeatureSnapshot } from '~/recsys/featurestore/snapshotModel.js';
import { featureStore } from '~/recsys/featurestore/store.js';
import { FEATURES, flattenFeatures } from '~/recsys/featurestore/registry.js';
import { dataSubjectService } from '~/recsys/privacy/dataSubjectService.js';
import { featureBuilder } from '~/recsys/features/featureBuilder.js';
import { features } from '../../helpers/recFixtures.js';

jest.setTimeout(120_000);
const H = 3_600_000;
const u = new mongoose.Types.ObjectId().toString();
const t0 = new Date('2026-03-10T00:00:00Z');
const at = (h: number) => new Date(t0.getTime() + h * H);
const feat = (streak: number, computedAt: Date) => ({
    ...features({ activity: { streak } as never }),
    userId: u,
    computedAt,
});

beforeAll(async () => {
    await startMongo();
    await syncIndexes(FeatureSnapshot);
});
afterAll(stopMongo);
beforeEach(clearDb);

describe('registry', () => {
    it('flattens every registered feature to a finite number or null', () => {
        const v = flattenFeatures(features());
        expect(Object.keys(v)).toEqual(FEATURES.map((f) => f.name));
        for (const x of Object.values(v))
            expect(x === null || Number.isFinite(x)).toBe(true);
    });
});

describe('snapshots', () => {
    it('writes at most one snapshot per interval', async () => {
        expect(await featureStore.snapshot(feat(1, at(0)), at(0))).toBe(true);
        expect(await featureStore.snapshot(feat(2, at(0.5)), at(0.5))).toBe(
            false
        );
        expect(await featureStore.snapshot(feat(3, at(2)), at(2))).toBe(true);
        expect(await FeatureSnapshot.countDocuments({ userId: u })).toBe(2);
    });
});

describe('point-in-time join', () => {
    beforeEach(async () => {
        await featureStore.snapshot(feat(1, at(0)), at(0));
        await featureStore.snapshot(feat(5, at(10)), at(10));
        await featureStore.snapshot(feat(9, at(20)), at(20));
    });

    it('returns the newest snapshot at or before t and never one from the future', async () => {
        const rows = await featureStore.getHistoricalFeatures([
            { userId: u, t: at(5) }, // → streak 1 (not 5, not 9)
            { userId: u, t: at(10) }, // boundary is inclusive → 5
            { userId: u, t: at(15) }, // → 5
            { userId: u, t: at(25) }, // → 9
        ]);
        expect(rows.map((r) => r.values?.streak)).toEqual([1, 5, 5, 9]);
        for (const r of rows)
            expect(r.snapshotAt!.getTime()).toBeLessThanOrEqual(r.t.getTime());
    });

    it('returns null before the first snapshot and when the snapshot is too stale', async () => {
        const [before, stale] = await featureStore.getHistoricalFeatures(
            [
                { userId: u, t: new Date(t0.getTime() - H) },
                { userId: u, t: at(20 + 100) }, // 100 h after the last snapshot
            ],
            { maxAgeHours: 72 }
        );
        expect(before.values).toBeNull();
        expect(stale.values).toBeNull();
    });

    it('does not cross users', async () => {
        const other = new mongoose.Types.ObjectId().toString();
        const [r] = await featureStore.getHistoricalFeatures([
            { userId: other, t: at(25) },
        ]);
        expect(r.values).toBeNull();
    });
});

describe('data-subject rights', () => {
    it('exports and erases snapshots', async () => {
        await featureStore.snapshot(feat(4, at(0)), at(0));
        const exp = await dataSubjectService.exportUserData(u);
        expect(exp.featureSnapshots).toHaveLength(1);
        const out = await dataSubjectService.eraseUserData(u);
        expect(out.deleted.featureSnapshots).toBe(1);
        expect(await FeatureSnapshot.countDocuments({ userId: u })).toBe(0);
    });
});

describe('builder hook', () => {
    afterEach(() => delete process.env.RECSYS_FEATURE_SNAPSHOTS);

    it('is off by default', async () => {
        await featureBuilder.build(u);
        expect(await FeatureSnapshot.countDocuments({ userId: u })).toBe(0);
    });

    it('appends a snapshot of the freshly built features when enabled', async () => {
        process.env.RECSYS_FEATURE_SNAPSHOTS = 'true';
        const built = await featureBuilder.build(u);
        const snaps = await FeatureSnapshot.find({ userId: u }).lean<
            Array<{ values: Record<string, number | null>; asOf: Date }>
        >();
        expect(snaps).toHaveLength(1);
        expect(snaps[0].values.streak).toBe(built.activity.streak);
        expect(snaps[0].asOf.getTime()).toBe(built.computedAt.getTime());
    });
});
