import mongoose, { Schema, Types, model } from 'mongoose';
import { recsysConfig } from '../config.js';

/** Regions this deployment knows about (RECSYS_REGIONS, comma separated, lower-case). */
export function knownRegions(): string[] {
    const fromEnv = (process.env.RECSYS_REGIONS ?? '')
        .split(',')
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean);
    return fromEnv.length ? fromEnv : [recsysConfig.defaultRegion()];
}

/**
 * Which residency region a learner's analytics data belongs to. Sink routing (topic, consumer
 * group, warehouse, pseudonym scope) is keyed by this tag, and each regional loader refuses
 * messages tagged for another region. NOTE: this is the CODE half of residency only; separate
 * database clusters, regional deployments and traffic routing are infrastructure (design only,
 * see docs/recommendation/03-architecture.md §12).
 */
const schema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, required: true },
        region: { type: String, required: true },
        setAt: { type: Date, required: true },
        setBy: { type: String, enum: ['admin', 'system'], required: true },
    },
    { collection: 'learner_regions', versionKey: false }
);
schema.index({ userId: 1 }, { unique: true });

export const LearnerRegion =
    mongoose.models.RecsysLearnerRegion || model('RecsysLearnerRegion', schema);

export class RegionError extends Error {}

export interface RegionService {
    resolve(userIds: string[]): Promise<Map<string, string>>;
    set(
        userId: string,
        region: string,
        by?: 'admin' | 'system',
        now?: Date
    ): Promise<void>;
}

export const regionService: RegionService = {
    /** Stored tag if it is still a known region, otherwise the default region. */
    async resolve(userIds) {
        const def = recsysConfig.defaultRegion();
        const known = new Set(knownRegions());
        const out = new Map(userIds.map((u) => [u, def]));
        if (userIds.length === 0) return out;
        const rows = await LearnerRegion.find({
            userId: { $in: userIds.map((u) => new Types.ObjectId(u)) },
        }).lean<Array<{ userId: Types.ObjectId; region: string }>>();
        for (const r of rows)
            if (known.has(r.region)) out.set(r.userId.toString(), r.region);
        return out;
    },

    async set(userId, region, by = 'admin', now = new Date()) {
        const r = region.trim().toLowerCase();
        if (!Types.ObjectId.isValid(userId))
            throw new RegionError('invalid user id');
        if (!knownRegions().includes(r))
            throw new RegionError(
                `unknown region "${region}"; known: ${knownRegions().join(', ')}`
            );
        await LearnerRegion.updateOne(
            { userId: new Types.ObjectId(userId) },
            { $set: { region: r, setAt: now, setBy: by } },
            { upsert: true }
        );
    },
};
