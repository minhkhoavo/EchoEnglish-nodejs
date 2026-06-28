import mongoose, { Schema, model, Types, InferSchemaType } from 'mongoose';
import { setBaseOptions } from './baseEntity.js';

const dailyFocusSchema = new Schema(
    {
        dayNumber: { type: Number, required: true, min: 1 },
        dayOfWeek: { type: Number, required: true, min: 0, max: 7 }, // 0 = null

        focus: { type: String, required: true },

        targetSkills: [{ type: String }],

        suggestedDomains: [{ type: String }],

        foundationWeight: { type: Number, min: 0, max: 100, default: 50 },

        estimatedMinutes: { type: Number, required: true },

        status: {
            type: String,
            enum: [
                'pending',
                'upcoming',
                'in-progress',
                'completed',
                'skipped',
            ],
            default: 'pending',
        },

        scheduledDate: { type: Date },

        isCritical: { type: Boolean, default: false },
        dailySessionCompleted: { type: Boolean, default: false },
    },
    { _id: true }
);

const mistakeQuestionSchema = new Schema(
    {
        questionId: { type: Schema.Types.ObjectId, required: true },
        questionText: { type: String, required: true },
        contentTags: [{ type: String }],
        skillTag: { type: String },
        partNumber: { type: Number },
        difficulty: { type: String },
        mistakeCount: { type: Number, default: 1 },
        addedDate: { type: Date, default: Date.now },
    },
    { _id: true }
);

// User-provided study material memo, embedded on the roadmap (no separate collection).
// Lets a learner attach existing materials (file/resource) to a day/week and have the
// daily plan generator build sessions around them, split across multiple days.
const studyMemoMaterialSchema = new Schema(
    {
        refType: {
            type: String,
            enum: ['file', 'resource'],
            required: true,
        },
        refId: { type: Schema.Types.ObjectId, required: true },
        title: { type: String },
    },
    { _id: false }
);

const studyMemoDayPlanSchema = new Schema(
    {
        order: { type: Number, required: true, min: 1 },
        focus: { type: String, required: true },
        status: {
            type: String,
            enum: ['pending', 'in-progress', 'done'],
            default: 'pending',
        },
    },
    { _id: true }
);

const studyMemoSchema = new Schema(
    {
        materials: [studyMemoMaterialSchema],
        note: { type: String },

        scope: {
            type: String,
            enum: ['date', 'week'],
            required: true,
        },
        targetDate: { type: Date },
        targetWeekNumber: { type: Number, min: 1 },

        suitability: {
            isSuitable: { type: Boolean, default: true },
            reason: { type: String },
            cefrFit: { type: String },
        },

        totalDays: { type: Number, min: 1, default: 1 },
        dayPlan: [studyMemoDayPlanSchema],

        status: {
            type: String,
            enum: ['active', 'completed'],
            default: 'active',
        },
    },
    { _id: true, timestamps: true }
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

        mistakes: [mistakeQuestionSchema],

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

        phaseSummary: [
            {
                weekRange: { type: String, required: true },
                phaseTitle: { type: String, required: true },
                targetScore: { type: Number },
                description: { type: String, required: true },
                keyFocusAreas: [{ type: String }],
                status: {
                    type: String,
                    enum: ['upcoming', 'in-progress', 'completed'],
                    default: 'upcoming',
                },
            },
        ],

        weeklyFocuses: [weeklyFocusSchema],

        // User-provided study material memos (personalisation layer over the daily plan)
        studyMemos: [studyMemoSchema],

        currentWeek: { type: Number, default: 1 },
        activeWeekNumber: { type: Number, default: 1 },
        lastActiveDate: { type: Date },
        overallProgress: { type: Number, default: 0, min: 0, max: 100 },
        sessionsCompleted: { type: Number, default: 0 },
        totalSessions: { type: Number },

        status: {
            type: String,
            enum: ['draft', 'active', 'completed', 'archived', 'paused'],
            default: 'draft',
            index: true,
        },

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
roadmapSchema.index({ userId: 1, currentWeek: 1 });

roadmapSchema.virtual('isBlocked').get(function () {
    const activeWeek = this.weeklyFocuses.find(
        (w) => w.weekNumber === this.activeWeekNumber
    );
    if (!activeWeek || !activeWeek.dailyFocuses) return false;

    return activeWeek.dailyFocuses.some(
        (daily) => daily.isCritical && !daily.dailySessionCompleted
    );
});

// Virtual để lấy daily focus hiện tại đang bị block
roadmapSchema.virtual('blockedDailyFocus').get(function () {
    const activeWeek = this.weeklyFocuses.find(
        (w) => w.weekNumber === this.activeWeekNumber
    );
    if (!activeWeek || !activeWeek.dailyFocuses) return null;

    return activeWeek.dailyFocuses.find(
        (daily) => daily.isCritical && !daily.dailySessionCompleted
    );
});

// Method để cập nhật dayOfWeek dựa trên studyDaysOfWeek của user
roadmapSchema.methods.updateDayOfWeekFromUserPreferences = function (
    userStudyDaysOfWeek: number[]
) {
    this.weeklyFocuses.forEach((week: WeeklyFocusType) => {
        if (week.dailyFocuses && week.dailyFocuses.length > 0) {
            week.dailyFocuses.forEach(
                (daily: DailyFocusType, index: number) => {
                    if (index < userStudyDaysOfWeek.length) {
                        daily.dayOfWeek = userStudyDaysOfWeek[index];
                    } else daily.dayOfWeek = 0;
                }
            );
        }
    });
};

// Method để hoàn thành daily session và mở khóa lộ trình
roadmapSchema.methods.completeDailySession = function (
    weekNumber: number,
    dayNumber: number
) {
    const week = this.weeklyFocuses.find(
        (w: WeeklyFocusType) => w.weekNumber === weekNumber
    );
    if (week && week.dailyFocuses) {
        const daily = week.dailyFocuses.find(
            (d: DailyFocusType) => d.dayNumber === dayNumber
        );
        if (daily) {
            daily.dailySessionCompleted = true;
            daily.status = 'completed';
        }
    }
};

// Method to check and update activeWeekNumber when all dailyFocus are completed
roadmapSchema.methods.checkAndUpdateActiveWeek = function () {
    const activeWeek = this.weeklyFocuses.find(
        (w: WeeklyFocusType) => w.weekNumber === this.activeWeekNumber
    );

    if (!activeWeek || !activeWeek.dailyFocuses) return false;

    const allCompleted = activeWeek.dailyFocuses.every(
        (d: DailyFocusType) =>
            d.status === 'completed' || d.status === 'skipped'
    );

    if (allCompleted && this.activeWeekNumber < this.totalWeeks) {
        this.activeWeekNumber += 1;
        this.lastActiveDate = new Date();
        activeWeek.status = 'completed';
        return true;
    }

    return false;
};

setBaseOptions(roadmapSchema);

// Define types first
export type MistakeQuestionType = InferSchemaType<
    typeof mistakeQuestionSchema
> & {
    _id: Types.ObjectId;
};

export type DailyFocusType = InferSchemaType<typeof dailyFocusSchema> & {
    _id: Types.ObjectId;
};

export type WeeklyFocusType = InferSchemaType<typeof weeklyFocusSchema> & {
    _id: Types.ObjectId;
};

export type StudyMemoDayPlanType = InferSchemaType<
    typeof studyMemoDayPlanSchema
> & {
    _id: Types.ObjectId;
};

export type StudyMemoType = InferSchemaType<typeof studyMemoSchema> & {
    _id: Types.ObjectId;
};

export type RoadmapType = InferSchemaType<typeof roadmapSchema> & {
    _id: Types.ObjectId;
};

export const Roadmap =
    mongoose.models.Roadmap || model<RoadmapType>('Roadmap', roadmapSchema);
