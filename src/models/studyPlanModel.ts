import mongoose, { Schema, model, Types, InferSchemaType } from 'mongoose';
import { setBaseOptions } from './baseEntity.js';

// Learning Resource Schema (embedded in study plan items)
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
        description: { type: String, required: true },
        estimatedTime: { type: Number, required: true }, // in minutes

        // For DB resources (video, article)
        resourceId: {
            type: Schema.Types.ObjectId,
            ref: 'Resource',
        },
        url: { type: String },

        // For AI-generated content (vocabulary_set, personalized_guide)
        generatedContent: {
            type: Schema.Types.Mixed, // Flexible structure for AI-generated content
        },

        completed: { type: Boolean, default: false },
        completedAt: { type: Date },
    },
    { _id: true }
);

// Practice Drill Schema (for targeted practice with skill tags)
const practiceDrillSchema = new Schema(
    {
        title: { type: String, required: true },
        description: { type: String, required: true },
        totalQuestions: { type: Number, required: true },
        estimatedTime: { type: Number, required: true }, // in minutes

        // Skill tags to query test questions
        skillTags: {
            skillCategory: { type: String, required: true }, // e.g., INFERENCE, GRAMMAR
            specificSkills: [{ type: String }], // e.g., ['infer_speaker_role', 'infer_implication']
        },

        // Content filters
        partNumbers: [{ type: Number }], // e.g., [3, 4] for listening parts
        difficulty: {
            type: String,
            enum: ['beginner', 'intermediate', 'advanced'],
        },

        // Progress tracking
        completed: { type: Boolean, default: false },
        completedAt: { type: Date },
        score: { type: Number }, // Score achieved if completed
        attempts: { type: Number, default: 0 },
    },
    { _id: true }
);

// Study Plan Item Schema
const studyPlanItemSchema = new Schema(
    {
        priority: { type: Number, required: true }, // 1, 2, 3
        title: { type: String, required: true },
        description: { type: String, required: true },

        // Target weakness information
        targetWeakness: {
            skillKey: { type: String, required: true },
            skillName: { type: String, required: true },
            severity: { type: String, required: true },
        },
        skillsToImprove: [{ type: String, required: true }],

        // Learning resources (videos, articles, AI-generated content)
        resources: [learningResourceSchema],

        // Targeted practice drills (queryable by skill tags)
        practiceDrills: [practiceDrillSchema],

        progress: { type: Number, default: 0, min: 0, max: 100 }, // 0-100%
        estimatedWeeks: { type: Number, required: true },

        startedAt: { type: Date },
        completedAt: { type: Date },
    },
    { _id: true }
);

// Main Study Plan Schema
export const studyPlanSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
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

        overallProgress: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },

        status: {
            type: String,
            enum: ['active', 'completed', 'abandoned'],
            default: 'active',
        },
    },
    {
        collection: 'study_plans',
    }
);

// Indexes
studyPlanSchema.index({ userId: 1, createdAt: -1 });
studyPlanSchema.index({ analysisResultId: 1 });
studyPlanSchema.index({ status: 1 });

setBaseOptions(studyPlanSchema);

export type StudyPlanType = InferSchemaType<typeof studyPlanSchema> & {
    _id: Types.ObjectId;
};

export const StudyPlan =
    mongoose.models.StudyPlan ||
    model<StudyPlanType>('StudyPlan', studyPlanSchema);
