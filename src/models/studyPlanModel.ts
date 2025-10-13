import mongoose, { Schema, model, Types, InferSchemaType } from 'mongoose';
import { setBaseOptions } from './baseEntity.js';

// Learning Activity Schema (for daily sessions)
const learningResourceSchema = new Schema(
    {
        type: {
            type: String,
            enum: [
                'video',
                'article',
                'vocabulary_set',
                'personalized_guide',
                'flashcard',
            ],
            required: true,
        },
        title: { type: String, required: true },
        description: { type: String },
        estimatedTime: { type: Number, required: true }, // in minutes

        resourceId: {
            type: Schema.Types.ObjectId,
            ref: 'Resource',
        },
        url: { type: String },

        generatedContent: {
            type: Schema.Types.Mixed,
        },

        practiceConfig: {
            skillTags: {
                skillCategory: String,
                specificSkills: [String],
            },
            partNumbers: [Number],
            difficulty: {
                type: String,
                enum: ['beginner', 'intermediate', 'advanced'],
            },
            totalQuestions: Number,
        },

        completed: { type: Boolean, default: false },
        completedAt: { type: Date },
    },
    { _id: true }
);

// Practice Drill Schema
const practiceDrillSchema = new Schema(
    {
        title: { type: String, required: true },
        description: { type: String, required: true },
        totalQuestions: { type: Number, required: true },
        estimatedTime: { type: Number, required: true },

        skillTags: {
            skillCategory: { type: String, required: true },
            specificSkills: [{ type: String }],
        },

        partNumbers: [{ type: Number }],
        difficulty: {
            type: String,
            enum: ['beginner', 'intermediate', 'advanced'],
        },

        completed: { type: Boolean, default: false },
        completedAt: { type: Date },
        score: { type: Number },
        attempts: { type: Number, default: 0 },
    },
    { _id: true }
);

// Study Plan Item Schema
const studyPlanItemSchema = new Schema(
    {
        priority: { type: Number, required: true },
        title: { type: String, required: true },
        description: { type: String, required: true },

        targetWeakness: {
            skillKey: { type: String, required: true },
            skillName: { type: String, required: true },
            severity: { type: String, required: true },
        },
        skillsToImprove: [{ type: String, required: true }],

        resources: [learningResourceSchema],

        practiceDrills: [practiceDrillSchema],

        progress: { type: Number, default: 0, min: 0, max: 100 },
        estimatedWeeks: { type: Number, required: true },

        startedAt: { type: Date },
        completedAt: { type: Date },

        // Minimal fields for daily activities
        activityType: {
            type: String,
            enum: ['learn', 'practice', 'review', 'drill'],
        },
        resourceType: { type: String },
        order: { type: Number },
        status: {
            type: String,
            enum: ['pending', 'in-progress', 'completed', 'skipped'],
            default: 'pending',
        },
        result: { type: Schema.Types.Mixed },
    },
    { _id: true }
);

export const studyPlanSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },

        roadmapRef: {
            type: Schema.Types.ObjectId,
            ref: 'Roadmap',
            required: true,
            index: true,
        },

        testResultId: {
            type: Schema.Types.ObjectId,
            ref: 'TestResult',
            required: true,
            index: true,
        },

        planItems: [studyPlanItemSchema],

        dayNumber: { type: Number, min: 1 },
        weekNumber: { type: Number, min: 1 },
        scheduledDate: { type: Date, index: true },

        title: { type: String },
        description: { type: String },
        targetSkills: [String],
        targetDomains: [String],
        targetWeaknesses: [
            {
                skillKey: String,
                skillName: String,
                severity: String,
                category: String,
                userAccuracy: Number,
            },
        ],

        totalEstimatedTime: { type: Number },
        totalTimeSpent: { type: Number, default: 0 },
        progress: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },

        status: {
            type: String,
            enum: ['upcoming', 'in-progress', 'completed', 'skipped', 'active'],
            default: 'upcoming',
        },
        startedAt: Date,
        completedAt: Date,
    },
    {
        collection: 'study_plans',
        timestamps: true,
    }
);

setBaseOptions(studyPlanSchema);

export type StudyPlanType = InferSchemaType<typeof studyPlanSchema> & {
    _id: Types.ObjectId;
};

export const StudyPlan =
    mongoose.models.StudyPlan ||
    model<StudyPlanType>('StudyPlan', studyPlanSchema);
