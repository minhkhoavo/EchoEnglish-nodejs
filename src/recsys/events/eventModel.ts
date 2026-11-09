import mongoose, { Schema, model, InferSchemaType, Types } from 'mongoose';
import { EVENT_TYPES } from './eventTypes.js';
import { recsysConfig } from '../config.js';

/**
 * Bronze layer: immutable raw events. One row per event.
 * - `eventId` unique → idempotent ingest.
 * - `userId` indexed → fast export/erasure (deleteMany by user).
 * - `createdAt` TTL → retention without a cron.
 * - `processing` is the ONLY mutable part (ETL bookkeeping).
 */
const learningEventSchema = new Schema(
    {
        eventId: { type: String, required: true },
        schemaVersion: { type: Number, required: true },
        type: { type: String, enum: EVENT_TYPES, required: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        sessionId: { type: String },
        source: {
            type: String,
            enum: ['server', 'web', 'ios', 'android'],
            required: true,
        },
        occurredAt: { type: Date, required: true },
        receivedAt: { type: Date, required: true, default: Date.now },
        props: { type: Schema.Types.Mixed, required: true },
        processing: {
            status: {
                type: String,
                enum: ['pending', 'processed', 'rejected'],
                default: 'pending',
            },
            reason: { type: String },
            processedAt: { type: Date },
            pipelineVersion: { type: String },
        },
    },
    { collection: 'learning_events', versionKey: false }
);

learningEventSchema.index({ eventId: 1 }, { unique: true });
learningEventSchema.index({ userId: 1, occurredAt: -1 });
learningEventSchema.index({ 'processing.status': 1, receivedAt: 1 });
learningEventSchema.index({ type: 1, occurredAt: -1 });
learningEventSchema.index(
    { receivedAt: 1 },
    { expireAfterSeconds: recsysConfig.eventRetentionDays() * 86400 }
);

export type LearningEventDoc = InferSchemaType<typeof learningEventSchema> & {
    _id: Types.ObjectId;
};

export const LearningEvent =
    mongoose.models.LearningEvent ||
    model<LearningEventDoc>('LearningEvent', learningEventSchema);
