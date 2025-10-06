import { model, Schema } from 'mongoose';
import { setBaseOptions } from './baseEntity.js';

interface IAnswerTimeline {
    answer: string;
    timestamp: number; // milliseconds from test start
    duration?: number; // ms active until next change or end
}

interface IUserAnswer {
    questionNumber: number;
    selectedAnswer: string;
    isCorrect: boolean;
    correctAnswer: string;

    // timing
    answerTimeline?: IAnswerTimeline[];
    timeToFirstAnswer?: number; // ms
    totalTimeSpent?: number; // ms
    answerChanges?: number;
}

interface IPartMetrics {
    partName: string;
    questionsCount: number;
    totalTime: number; // ms
    averageTimePerQuestion: number;
    answerChangeRate: number;
    slowestQuestions: number[];
}

interface IOverallMetrics {
    totalActiveTime: number; // ms
    averageTimePerQuestion: number;
    totalAnswerChanges: number;
    confidenceScore: number; // 0-100
    timeDistribution: Map<string, number>;
}

interface ITestResult {
    userId: Schema.Types.ObjectId;
    testId: Schema.Types.ObjectId;
    testTitle: string;
    testType: string;
    duration: number; // ms
    completedAt: Date;
    score: number;
    totalQuestions: number;
    userAnswers: IUserAnswer[];
    parts: string[];
    partsKey?: string;

    startedAt?: Date;
    partMetrics?: IPartMetrics[];
    overallMetrics?: IOverallMetrics;
}

const answerTimelineSchema = new Schema<IAnswerTimeline>(
    {
        answer: { type: String, required: true },
        timestamp: { type: Number, required: true },
        duration: { type: Number, required: false },
    },
    { _id: false }
);

const userAnswerSchema = new Schema<IUserAnswer>({
    questionNumber: { type: Number, required: true },
    selectedAnswer: { type: String, required: true },
    isCorrect: { type: Boolean, required: true },
    correctAnswer: { type: String, required: true },
    answerTimeline: { type: [answerTimelineSchema], required: false },
    timeToFirstAnswer: { type: Number, required: false },
    totalTimeSpent: { type: Number, required: false },
    answerChanges: { type: Number, required: false, default: 0 },
});

const partMetricsSchema = new Schema<IPartMetrics>(
    {
        partName: { type: String, required: true },
        questionsCount: { type: Number, required: true },
        totalTime: { type: Number, required: true },
        averageTimePerQuestion: { type: Number, required: true },
        answerChangeRate: { type: Number, required: true },
        slowestQuestions: { type: [Number], required: false, default: [] },
    },
    { _id: false }
);

const overallMetricsSchema = new Schema<IOverallMetrics>(
    {
        totalActiveTime: { type: Number, required: true },
        averageTimePerQuestion: { type: Number, required: true },
        totalAnswerChanges: { type: Number, required: true },
        confidenceScore: { type: Number, required: true, min: 0, max: 100 },
        timeDistribution: { type: Map, of: Number, required: false },
    },
    { _id: false }
);

const testResultSchema = new Schema<ITestResult>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        testId: { type: Schema.Types.ObjectId, required: true },
        testTitle: { type: String, required: true },
        testType: {
            type: String,
            required: true,
            enum: ['listening-reading', 'speaking', 'writing'],
        },
        duration: { type: Number, required: true },
        completedAt: { type: Date, required: true, default: Date.now },
        score: { type: Number, required: true },
        totalQuestions: { type: Number, required: true },
        userAnswers: [userAnswerSchema],
        parts: [{ type: String, required: true }],
        partsKey: { type: String, required: false },
        startedAt: { type: Date, required: false },
        partMetrics: { type: [partMetricsSchema], required: false },
        overallMetrics: { type: overallMetricsSchema, required: false },
    },
    { collection: 'test_results' }
);

// Indexes
testResultSchema.index({ userId: 1, completedAt: -1 });
testResultSchema.index({ testId: 1 });

setBaseOptions(testResultSchema);

export const TestResult = model<ITestResult>('TestResult', testResultSchema);
export type {
    ITestResult,
    IUserAnswer,
    IAnswerTimeline,
    IPartMetrics,
    IOverallMetrics,
};
