import mongoose, { Schema, model } from 'mongoose';
import { recsysConfig } from '../config.js';

/**
 * Offline store: append-only snapshots of a learner's features. Each row is "what we knew at
 * `asOf`", so training joins never see the future. The online store stays `learner_features`.
 */
const schema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, required: true },
        asOf: { type: Date, required: true },
        registryVersion: { type: Number, required: true },
        values: { type: Schema.Types.Mixed, required: true },
    },
    { collection: 'learner_feature_snapshots', versionKey: false }
);
schema.index({ userId: 1, asOf: -1 });
schema.index(
    { asOf: 1 },
    { expireAfterSeconds: recsysConfig.featureStore.retentionDays() * 86400 }
);

export const FeatureSnapshot =
    mongoose.models.RecsysFeatureSnapshot ||
    model('RecsysFeatureSnapshot', schema);
