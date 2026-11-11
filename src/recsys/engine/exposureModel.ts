import mongoose, { Schema, model } from 'mongoose';

/**
 * Functional recommendation state ("what we already showed you / you dismissed").
 * It exists so the product does not repeat itself or re-show what the learner rejected —
 * a service function that must work WITHOUT analytics consent. It is therefore:
 *   - tiny (≤ 20 impression timestamps per item, no content),
 *   - short-lived (TTL 30 days after last touch),
 *   - deleted with the rest of the learner's data on erasure,
 *   - never used for analytics (analytics events remain consent-gated).
 */
const exposureSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, required: true },
        itemId: { type: String, required: true }, // `${type}:${ref}`
        impressions: { type: [Date], default: [] },
        clickedAt: { type: Date },
        completedAt: { type: Date },
        dismissedAt: { type: Date },
        dismissReason: { type: String },
        expireAt: { type: Date, required: true },
    },
    { collection: 'recsys_exposure', versionKey: false }
);
exposureSchema.index({ userId: 1, itemId: 1 }, { unique: true });
exposureSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const RecExposure =
    mongoose.models.RecExposure || model('RecExposure', exposureSchema);
