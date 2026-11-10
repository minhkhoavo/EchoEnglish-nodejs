import mongoose, { Schema, model } from 'mongoose';

/**
 * Server-side record of every list that was served. It is the source of truth for
 * (a) attributing feedback — variant, mode and position come from here, never from the client —
 * and (b) training/evaluation logs (signals and the not-shown pool, analytics consent only).
 */
const servedSchema = new Schema(
    {
        recId: { type: String, required: true },
        userId: { type: Schema.Types.ObjectId, required: true },
        servedAt: { type: Date, required: true },
        variant: { type: String, required: true },
        mode: { type: String, required: true },
        algo: { type: String, required: true },
        /** Learner segment and feature timestamp the ranker actually used (no train/serve skew). */
        segment: { type: String },
        featuresAt: { type: Date },
        items: { type: [Schema.Types.Mixed], default: [] },
        /** Present only when this list had a randomised slot. */
        explore: { type: Schema.Types.Mixed },
        /** Eligible candidates that were NOT shown (analytics consent only). */
        pool: { type: [Schema.Types.Mixed], default: undefined },
        expireAt: { type: Date, required: true },
    },
    { collection: 'rec_served', versionKey: false, minimize: true }
);
servedSchema.index({ recId: 1 }, { unique: true });
servedSchema.index({ userId: 1, servedAt: -1 });
servedSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const RecServed =
    mongoose.models.RecServed || model('RecServed', servedSchema);
