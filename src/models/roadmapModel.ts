import mongoose, { Schema, model, Types, InferSchemaType } from 'mongoose';
import { setBaseOptions } from './baseEntity.js';

const dailyFocusSchema = new Schema(
    {
        dayNumber: { type: Number, required: true, min: 1 },
        dayOfWeek: { type: Number, required: true, min: 1, max: 7 },

        focus: { type: String, required: true },

        targetSkills: [{ type: String }],

        suggestedDomains: [{ type: String }],

        foundationWeight: { type: Number, min: 0, max: 100, default: 50 },

        estimatedMinutes: { type: Number, required: true },

        status: {
            type: String,
            enum: [
                'pending',
                'generated',
                'in-progress',
                'completed',
                'skipped',
            ],
            default: 'pending',
        },

        scheduledDate: { type: Date },
    },
    { _id: true }
);

const weeklyFocusSchema = new Schema(
    {
        weekNumber: { type: Number, required: true, min: 1 },

        title: { type: String, required: true },
        summary: { type: String, required: true },

        focusSkills: [{ type: String, required: true }],

        targetWeaknesses: [
            {
                skillKey: { type: String, required: true },
                skillName: { type: String, required: true },
                severity: {
                    type: String,
                    enum: ['critical', 'high', 'medium', 'low'],
                    required: true,
                },
                category: { type: String, required: true },
                userAccuracy: { type: Number },
            },
        ],

        recommendedDomains: [{ type: String }],

        foundationWeight: { type: Number, min: 0, max: 100, default: 50 },

        expectedProgress: { type: Number, min: 0, max: 100 },

        dailyFocuses: [dailyFocusSchema],

        sessionsCompleted: { type: Number, default: 0 },
        totalSessions: { type: Number, default: 7 },
        status: {
            type: String,
            enum: ['upcoming', 'in-progress', 'completed'],
            default: 'upcoming',
        },
    },
    { _id: true }
);

export const roadmapSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },

        roadmapId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },

        userPrompt: { type: String },
        currentLevel: { type: String },
        currentScore: { type: Number },
        targetScore: { type: Number },

        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
        totalWeeks: { type: Number, required: true },

        studyTimePerDay: { type: Number, required: true },
        studyDaysPerWeek: { type: Number, required: true },

        learningStrategy: {
            foundationFocus: { type: Number, min: 0, max: 100 },
            domainFocus: { type: Number, min: 0, max: 100 },
        },

        weeklyFocuses: [weeklyFocusSchema],

        currentWeek: { type: Number, default: 1 },
        overallProgress: { type: Number, default: 0, min: 0, max: 100 },
        sessionsCompleted: { type: Number, default: 0 },
        totalSessions: { type: Number },

        status: {
            type: String,
            enum: ['draft', 'active', 'completed', 'archived', 'paused'],
            default: 'draft',
            index: true,
        },

        needsRecalibration: { type: Boolean, default: false },
        lastRecalibrated: { type: Date },
        recalibrationCount: { type: Number, default: 0 },

        testResultId: {
            type: Schema.Types.ObjectId,
            ref: 'TestResult',
        },
    },
    {
        collection: 'roadmaps',
        timestamps: true,
    }
);

// Indexes
roadmapSchema.index({ userId: 1, status: 1 });
roadmapSchema.index({ roadmapId: 1 }, { unique: true });
roadmapSchema.index({ userId: 1, currentWeek: 1 });

roadmapSchema.virtual('activeWeek').get(function () {
    return this.weeklyFocuses.find((w) => w.weekNumber === this.currentWeek);
});

setBaseOptions(roadmapSchema);

export type RoadmapType = InferSchemaType<typeof roadmapSchema> & {
    _id: Types.ObjectId;
};

export const Roadmap =
    mongoose.models.Roadmap || model<RoadmapType>('Roadmap', roadmapSchema);
