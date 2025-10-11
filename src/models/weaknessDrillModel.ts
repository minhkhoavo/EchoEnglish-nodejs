import mongoose, { Schema, model, Types, InferSchemaType } from 'mongoose';
import { setBaseOptions } from './baseEntity.js';
import { PartNumber } from '../enum/partNumber.js';
import { Difficulty } from '../enum/difficulty.js';

// Question Filters Schema (criteria for selecting questions)
const questionFiltersSchema = new Schema(
    {
        skillTags: {
            part: {
                type: String,
                enum: ['1', '2', '3', '4', '5', '6', '7'],
            },
            skillCategory: {
                type: String,
                enum: [
                    'GIST',
                    'DETAIL',
                    'INFERENCE',
                    'SPECIFIC_ACTION',
                    'OTHERS',
                ],
            },
            skillDetail: { type: String },
            grammarPoint: { type: String },
            vocabPoint: { type: String },
            tagType: { type: String },
        },
        contentTags: {
            domain: [{ type: String }],
            difficulty: {
                type: String,
                enum: ['beginner', 'intermediate', 'advanced'],
            },
        },
    },
    { _id: false }
);

// Completion Record Schema
const completionRecordSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        completedAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
        score: { type: Number, required: true }, // Number of correct answers
        totalQuestions: { type: Number, required: true },
        accuracy: { type: Number, required: true }, // Percentage
        timeSpent: { type: Number }, // Total time in seconds
    },
    { _id: true }
);

// Main Weakness Drill Schema
const weaknessDrillSchema = new Schema(
    {
        title: { type: String, required: true },
        description: { type: String, required: true },
        targetSkill: { type: String, required: true, index: true },
        targetSkillCategory: { type: String, required: true },
        applicableParts: [
            {
                type: String,
                enum: Object.values(PartNumber),
            },
        ],

        difficulty: {
            type: String,
            enum: Object.values(Difficulty),
            required: true,
            index: true,
        },

        // Filters used to select questions for this drill
        questionFilters: {
            type: questionFiltersSchema,
            required: true,
        },

        totalQuestions: { type: Number, required: true },
        estimatedTime: { type: Number, required: true }, // in minutes

        // System-generated or user-created
        isSystemGenerated: { type: Boolean, default: true },

        // Track usage and effectiveness
        usageCount: { type: Number, default: 0 },
        averageScore: { type: Number }, // Average accuracy across all completions
        completionRecords: [completionRecordSchema],
    },
    {
        collection: 'weakness_drills',
    }
);

// Indexes for efficient queries
weaknessDrillSchema.index({ targetSkill: 1, difficulty: 1 });
weaknessDrillSchema.index({ targetSkillCategory: 1 });
weaknessDrillSchema.index({ applicableParts: 1 });
weaknessDrillSchema.index({ isSystemGenerated: 1 });

setBaseOptions(weaknessDrillSchema);

export type WeaknessDrillType = InferSchemaType<typeof weaknessDrillSchema> & {
    _id: Types.ObjectId;
};

export const WeaknessDrill =
    mongoose.models.WeaknessDrill ||
    model<WeaknessDrillType>('WeaknessDrill', weaknessDrillSchema);
