import mongoose, { Schema, model } from 'mongoose';

const skillMasterySchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, required: true },
        skillKey: { type: String, required: true },
        theta: { type: Number, default: 0 },
        n: { type: Number, default: 0 },
        correct: { type: Number, default: 0 },
        lastPracticedAt: { type: Date },
    },
    { collection: 'skill_mastery', versionKey: false }
);
skillMasterySchema.index({ userId: 1, skillKey: 1 }, { unique: true });

const featureSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, required: true, unique: true },
        computedAt: { type: Date, required: true },
        pipelineVersion: { type: String, required: true },
        /** receivedAt of the newest clean event already folded into mastery. */
        masteryCursorId: { type: Schema.Types.ObjectId },
        activity: { type: Schema.Types.Mixed },
        performance: { type: Schema.Types.Mixed },
        srs: { type: Schema.Types.Mixed },
        timing: { type: Schema.Types.Mixed },
        engagement: { type: Schema.Types.Mixed },
        skills: { type: Schema.Types.Mixed },
        daysSince: { type: Schema.Types.Mixed },
    },
    { collection: 'learner_features', versionKey: false }
);

export const SkillMastery =
    mongoose.models.SkillMastery || model('SkillMastery', skillMasterySchema);
export const LearnerFeatures =
    mongoose.models.LearnerFeatures || model('LearnerFeatures', featureSchema);

export interface SkillFeature {
    skillKey: string;
    mastery: number;
    confidence: number;
    n: number;
    daysSincePractice: number | null;
}

export interface LearnerFeatureSet {
    userId: string;
    computedAt: Date;
    activity: {
        activeDays7: number;
        activeDays30: number;
        studyMin7: number;
        studyMin30: number;
        streak: number;
        daysSinceActive: number | null;
    };
    performance: {
        acc7: number | null;
        acc30: number | null;
        questions30: number;
        lastTestScore: number | null;
        scoreTrend: number | null;
    };
    srs: {
        total: number;
        due: number;
        newCards: number;
        avgRetrievability: number | null;
        overdueMax: number;
    };
    timing: { bestHours: number[] };
    /** Days since last test / pronunciation / vocab capture; null = none in the 30-day window. */
    daysSince: {
        test: number | null;
        pronunciation: number | null;
        vocab: number | null;
    };
    engagement: {
        recImpressions30: number;
        recCtr30: number | null;
        dismissRate30: number | null;
        resourceCompletionRate30: number | null;
    };
    skills: SkillFeature[];
}
