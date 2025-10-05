import { model, Schema } from 'mongoose';
import { setBaseOptions } from './baseEntity.js';

interface IUserAnswer {
    questionNumber: number;
    selectedAnswer: string; // A, B, C, D
    isCorrect: boolean;
    correctAnswer: string;
}

interface ITestResult {
    userId: Schema.Types.ObjectId;
    testId: Schema.Types.ObjectId;
    testTitle: string;
    testType: string; // 'listening-reading', 'speaking', 'writing'
    duration: number; // in milliseconds
    completedAt: Date;
    score: number; // number of correct answers
    totalQuestions: number;
    userAnswers: IUserAnswer[];
    parts: string[]; // which parts were included in this test
    partsKey?: string; // key for selected parts (sorted, joined by '-')
}

const userAnswerSchema = new Schema<IUserAnswer>({
    questionNumber: {
        type: Number,
        required: true,
    },
    selectedAnswer: {
        type: String,
        required: true,
    },
    isCorrect: {
        type: Boolean,
        required: true,
    },
    correctAnswer: {
        type: String,
        required: true,
    },
});

const testResultSchema = new Schema<ITestResult>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        testId: {
            type: Schema.Types.ObjectId,
            required: true,
        },
        testTitle: {
            type: String,
            required: true,
        },
        testType: {
            type: String,
            required: true,
            enum: ['listening-reading', 'speaking', 'writing'],
        },
        duration: {
            type: Number,
            required: true,
        },
        completedAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
        score: {
            type: Number,
            required: true,
        },
        totalQuestions: {
            type: Number,
            required: true,
        },
        userAnswers: [userAnswerSchema],
        parts: [
            {
                type: String,
                required: true,
            },
        ],
        partsKey: {
            type: String,
            required: false,
        },
    },
    {
        collection: 'test_results',
    }
);

// Index for efficient queries
testResultSchema.index({ userId: 1, completedAt: -1 });
testResultSchema.index({ testId: 1 });

setBaseOptions(testResultSchema);

export const TestResult = model<ITestResult>('TestResult', testResultSchema);
export type { ITestResult, IUserAnswer };
