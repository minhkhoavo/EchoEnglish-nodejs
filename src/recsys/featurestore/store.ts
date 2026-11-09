import { Types } from 'mongoose';
import { LearnerFeatureSet } from '../features/featureModels.js';
import { recsysConfig } from '../config.js';
import { FeatureSnapshot } from './snapshotModel.js';
import {
    FEATURE_NAMES,
    FeatureValues,
    REGISTRY_VERSION,
    flattenFeatures,
} from './registry.js';

export interface EntityRow {
    userId: string;
    /** The moment the feature values must be "as of" (e.g. the impression time). */
    t: Date;
}

export interface JoinedRow extends EntityRow {
    values: FeatureValues | null;
    /** asOf of the snapshot used (≤ t); null when none qualified. */
    snapshotAt: Date | null;
}

const MIN = 60_000;

export class FeatureStore {
    /** Append a snapshot unless the latest one is still fresh. Returns true if written. */
    async snapshot(f: LearnerFeatureSet, now = new Date()): Promise<boolean> {
        const uid = new Types.ObjectId(f.userId);
        const latest = await FeatureSnapshot.findOne({ userId: uid })
            .sort({ asOf: -1 })
            .select('asOf')
            .lean<{ asOf: Date } | null>();
        if (
            latest &&
            now.getTime() - latest.asOf.getTime() <
                recsysConfig.featureStore.snapshotMinIntervalMin * MIN
        )
            return false;
        await FeatureSnapshot.create({
            userId: uid,
            asOf: f.computedAt ?? now,
            registryVersion: REGISTRY_VERSION,
            values: flattenFeatures(f),
        });
        return true;
    }

    /**
     * Point-in-time join: for each (user, t) the newest snapshot with asOf ≤ t, and not older
     * than `maxAgeHours` (a stale value would describe a different learner). Never looks forward.
     */
    async getHistoricalFeatures(
        rows: EntityRow[],
        opts: { maxAgeHours?: number } = {}
    ): Promise<JoinedRow[]> {
        const maxAge = (opts.maxAgeHours ?? 72) * 60 * MIN;
        const ids = [...new Set(rows.map((r) => r.userId))];
        const snaps = await FeatureSnapshot.find({
            userId: { $in: ids.map((i) => new Types.ObjectId(i)) },
            registryVersion: REGISTRY_VERSION,
        })
            .sort({ asOf: 1 })
            .select('userId asOf values')
            .lean<
                Array<{
                    userId: Types.ObjectId;
                    asOf: Date;
                    values: FeatureValues;
                }>
            >();
        const byUser = new Map<string, typeof snaps>();
        for (const s of snaps) {
            const k = s.userId.toString();
            (byUser.get(k) ?? byUser.set(k, []).get(k)!).push(s);
        }
        return rows.map((r) => {
            const list = byUser.get(r.userId) ?? [];
            let pick: (typeof list)[number] | undefined;
            for (const s of list) {
                if (s.asOf.getTime() <= r.t.getTime()) pick = s;
                else break; // sorted ascending → everything after is the future
            }
            if (!pick || r.t.getTime() - pick.asOf.getTime() > maxAge)
                return { ...r, values: null, snapshotAt: null };
            return { ...r, values: pick.values, snapshotAt: pick.asOf };
        });
    }

    /** Names a consumer may request (guards typos in training code). */
    static readonly featureNames = FEATURE_NAMES;
}

export const featureStore = new FeatureStore();
