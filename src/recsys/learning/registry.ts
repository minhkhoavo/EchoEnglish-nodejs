import mongoose, { Schema, model } from 'mongoose';
import { recsysConfig } from '../config.js';
import { LearnedModelPayload } from './model.js';
import { TrainReport } from './train.js';

export type ModelStatus = 'candidate' | 'rejected' | 'active' | 'retired';
export type DataSource = 'production' | 'synthetic';

const schema = new Schema(
    {
        version: { type: Number, required: true },
        algo: { type: String, required: true },
        status: {
            type: String,
            enum: ['candidate', 'rejected', 'active', 'retired'],
            required: true,
        },
        dataSource: {
            type: String,
            enum: ['production', 'synthetic'],
            required: true,
        },
        payload: { type: Schema.Types.Mixed },
        metrics: { type: Schema.Types.Mixed },
        counts: { type: Schema.Types.Mixed },
        reasons: [{ type: String }],
        trainedAt: { type: Date, required: true },
        allocationPct: { type: Number, default: 0 },
        activatedAt: { type: Date },
        activatedBy: { type: String, enum: ['auto', 'admin'] },
        retiredAt: { type: Date },
        retiredReason: { type: String },
    },
    { collection: 'rec_models', versionKey: false, minimize: false }
);
schema.index({ version: 1 }, { unique: true });
schema.index({ status: 1 });

export const RecModel =
    mongoose.models.RecsysModel || model('RecsysModel', schema);

export interface ModelDoc {
    version: number;
    algo: string;
    status: ModelStatus;
    dataSource: DataSource;
    payload: LearnedModelPayload | null;
    metrics: TrainReport['metrics'];
    counts: TrainReport['counts'];
    reasons: string[];
    trainedAt: Date;
    allocationPct: number;
}

export class ModelError extends Error {
    constructor(
        readonly code:
            'not_found' | 'not_servable' | 'synthetic' | 'bad_allocation',
        message: string
    ) {
        super(message);
    }
}

const TTL_MS = 60_000;
let cache: { exp: number; value: ModelDoc | null } | null = null;

export class ModelRegistry {
    async register(
        report: TrainReport,
        opts: { dataSource: DataSource; now?: Date }
    ): Promise<ModelDoc> {
        const last = await RecModel.findOne()
            .sort({ version: -1 })
            .select('version')
            .lean<{ version: number } | null>();
        const synthetic = opts.dataSource !== 'production';
        const reasons = [...report.reasons];
        if (synthetic)
            reasons.push('trained on synthetic data: never servable');
        const doc = await RecModel.create({
            version: (last?.version ?? 0) + 1,
            algo: report.payload?.algo ?? 'logreg-v1',
            status: report.gatePassed && !synthetic ? 'candidate' : 'rejected',
            dataSource: opts.dataSource,
            payload: report.payload,
            metrics: report.metrics,
            counts: report.counts,
            reasons,
            trainedAt: opts.now ?? new Date(),
        });
        return doc.toObject() as ModelDoc;
    }

    /**
     * Put a model live for `pct`% of users. Auto callers are capped at the challenger share;
     * only an admin may raise it (up to the hard maximum). Synthetic models never go live.
     */
    async activate(
        version: number,
        pct: number,
        by: 'auto' | 'admin',
        now = new Date()
    ): Promise<ModelDoc> {
        const m = await RecModel.findOne({ version }).lean<ModelDoc | null>();
        if (!m)
            throw new ModelError('not_found', `model v${version} not found`);
        if (m.dataSource !== 'production')
            throw new ModelError(
                'synthetic',
                'synthetic-data models cannot be served'
            );
        if (m.status !== 'candidate' && m.status !== 'active')
            throw new ModelError(
                'not_servable',
                `model v${version} is ${m.status}`
            );
        const cap =
            by === 'auto'
                ? recsysConfig.retrain.challengerPct()
                : recsysConfig.retrain.maxAllocationPct;
        if (!Number.isInteger(pct) || pct < 1 || pct > cap)
            throw new ModelError(
                'bad_allocation',
                `allocation must be an integer 1..${cap}`
            );
        await RecModel.updateMany(
            { status: 'active', version: { $ne: version } },
            {
                $set: {
                    status: 'retired',
                    retiredAt: now,
                    retiredReason: `replaced by v${version}`,
                    allocationPct: 0,
                },
            }
        );
        const updated = await RecModel.findOneAndUpdate(
            { version },
            {
                $set: {
                    status: 'active',
                    allocationPct: pct,
                    activatedAt: m.status === 'active' ? undefined : now,
                    activatedBy: by,
                },
            },
            { new: true }
        ).lean<ModelDoc>();
        this.clearCache();
        return updated!;
    }

    async retire(
        version: number,
        reason: string,
        now = new Date()
    ): Promise<void> {
        const r = await RecModel.updateOne(
            { version, status: { $in: ['active', 'candidate'] } },
            {
                $set: {
                    status: 'retired',
                    retiredAt: now,
                    retiredReason: reason.slice(0, 200),
                    allocationPct: 0,
                },
            }
        );
        if (r.matchedCount === 0)
            throw new ModelError(
                'not_found',
                `model v${version} is not active/candidate`
            );
        this.clearCache();
    }

    async list(limit = 20): Promise<ModelDoc[]> {
        return RecModel.find()
            .sort({ version: -1 })
            .limit(limit)
            .select('-_id')
            .lean<ModelDoc[]>();
    }

    /** Cached lookup used on the request path: at most one DB read per TTL, never per request. */
    async getActive(now = Date.now()): Promise<ModelDoc | null> {
        if (cache && cache.exp > now) return cache.value;
        const value = await this.fetchActive();
        cache = { exp: now + TTL_MS, value };
        return value;
    }

    /**
     * Uncached read for background jobs. It must NOT touch the cache: a job that needs the truth
     * (retrain, guard) must not extend or poison what the request path sees.
     */
    fetchActive(): Promise<ModelDoc | null> {
        return RecModel.findOne({ status: 'active' }).lean<ModelDoc | null>();
    }

    clearCache() {
        cache = null;
    }
}

export const modelRegistry = new ModelRegistry();
