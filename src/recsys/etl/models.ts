import mongoose, { Schema, model } from 'mongoose';
import { EVENT_TYPES } from '../events/eventTypes.js';
import { recsysConfig } from '../config.js';

/** Silver: validated, normalised, deduplicated events. Rebuildable from bronze. */
const cleanSchema = new Schema(
    {
        eventId: { type: String, required: true },
        rawId: { type: Schema.Types.ObjectId, required: true },
        userId: { type: Schema.Types.ObjectId, required: true },
        type: { type: String, enum: EVENT_TYPES, required: true },
        occurredAt: { type: Date, required: true },
        day: { type: String, required: true }, // YYYY-MM-DD at UTC+7
        hour: { type: Number, required: true, min: 0, max: 23 },
        props: { type: Schema.Types.Mixed, required: true },
        clamped: [{ type: String }],
        pipelineVersion: { type: String, required: true },
        runId: { type: String, required: true },
        receivedAt: { type: Date, required: true },
    },
    { collection: 'learning_events_clean', versionKey: false }
);
cleanSchema.index({ eventId: 1 }, { unique: true });
cleanSchema.index({ userId: 1, day: 1 });
cleanSchema.index(
    { receivedAt: 1 },
    { expireAfterSeconds: recsysConfig.eventRetentionDays() * 86400 }
);

const skillCountSchema = new Schema(
    { skillKey: String, n: Number, c: Number },
    { _id: false }
);

/** Gold: one row per learner per day. Recomputed (not incremented) → idempotent. */
const factsSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, required: true },
        day: { type: String, required: true },
        studySeconds: { type: Number, default: 0 },
        sessions: { type: Number, default: 0 },
        questionsAnswered: { type: Number, default: 0 },
        questionsCorrect: { type: Number, default: 0 },
        bySkill: [skillCountSchema],
        flashcardsReviewed: { type: Number, default: 0 },
        flashcardsRemembered: { type: Number, default: 0 },
        vocabCaptured: { type: Number, default: 0 },
        resourcesViewed: { type: Number, default: 0 },
        resourcesCompleted: { type: Number, default: 0 },
        pronunciationAttempts: { type: Number, default: 0 },
        pronunciationAccuracySum: { type: Number, default: 0 },
        writingAttempts: { type: Number, default: 0 },
        testsSubmitted: { type: Number, default: 0 },
        lastTestScore: { type: Number },
        creditsSpent: { type: Number, default: 0 },
        aiCostUsd: { type: Number, default: 0 },
        aiTokens: { type: Number, default: 0 },
        recImpressions: { type: Number, default: 0 },
        recClicks: { type: Number, default: 0 },
        recCompletes: { type: Number, default: 0 },
        recDismisses: { type: Number, default: 0 },
        activeHours: { type: [Number], default: () => new Array(24).fill(0) },
        learningActions: { type: Number, default: 0 },
        lineage: {
            pipelineVersion: String,
            runId: String,
            sourceEventCount: Number,
            minOccurredAt: Date,
            maxOccurredAt: Date,
            computedAt: Date,
        },
    },
    { collection: 'learner_daily_facts', versionKey: false }
);
factsSchema.index({ userId: 1, day: 1 }, { unique: true });
factsSchema.index({ day: 1 });

const dqCheckSchema = new Schema(
    {
        name: String,
        value: Number,
        threshold: Number,
        passed: Boolean,
        severity: String,
    },
    { _id: false }
);

const runSchema = new Schema(
    {
        runId: { type: String, required: true, unique: true },
        pipelineVersion: { type: String, required: true },
        startedAt: { type: Date, required: true },
        finishedAt: { type: Date },
        status: {
            type: String,
            enum: ['running', 'ok', 'degraded', 'failed'],
            required: true,
        },
        counts: {
            read: { type: Number, default: 0 },
            cleaned: { type: Number, default: 0 },
            rejected: { type: Number, default: 0 },
            alreadyClean: { type: Number, default: 0 },
            factsUpserted: { type: Number, default: 0 },
            usersTouched: { type: Number, default: 0 },
        },
        range: { minReceivedAt: Date, maxReceivedAt: Date },
        dq: [dqCheckSchema],
        error: { type: String },
    },
    { collection: 'recsys_pipeline_runs', versionKey: false }
);
runSchema.index({ startedAt: -1 });

const lockSchema = new Schema(
    {
        _id: { type: String },
        owner: { type: String, required: true },
        expiresAt: { type: Date, required: true },
    },
    { collection: 'recsys_locks', versionKey: false }
);

export const CleanEvent =
    mongoose.models.CleanEvent || model('CleanEvent', cleanSchema);
export const DailyFacts =
    mongoose.models.LearnerDailyFacts ||
    model('LearnerDailyFacts', factsSchema);
export const PipelineRun =
    mongoose.models.RecsysPipelineRun || model('RecsysPipelineRun', runSchema);
export const PipelineLock =
    mongoose.models.RecsysLock || model('RecsysLock', lockSchema);

export interface SkillCount {
    skillKey: string;
    n: number;
    c: number;
}

export interface DailyFactsData {
    userId: string;
    day: string;
    studySeconds: number;
    sessions: number;
    questionsAnswered: number;
    questionsCorrect: number;
    bySkill: SkillCount[];
    flashcardsReviewed: number;
    flashcardsRemembered: number;
    vocabCaptured: number;
    resourcesViewed: number;
    resourcesCompleted: number;
    pronunciationAttempts: number;
    pronunciationAccuracySum: number;
    writingAttempts: number;
    testsSubmitted: number;
    lastTestScore?: number;
    creditsSpent: number;
    aiCostUsd: number;
    aiTokens: number;
    recImpressions: number;
    recClicks: number;
    recCompletes: number;
    recDismisses: number;
    activeHours: number[];
    learningActions: number;
}
