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

interface IHesitationQuestion {
    questionNumber: number;
    answerChanges: number;
    timeToFirstAnswer: number;
    totalTimeSpent: number;
    finalAnswer: string;
    isCorrect: boolean;
    changeHistory: string[];
}

interface IHesitationAnalysis {
    topHesitationQuestions: IHesitationQuestion[];
    averageChangesPerQuestion: number;
    questionsWithMultipleChanges: number;
}

interface IAnswerChangePatterns {
    correctToIncorrect: number;
    incorrectToCorrect: number;
    incorrectToIncorrect: number;
}

interface ISkillPerformance {
    skillName: string;
    skillKey: string;
    total: number;
    correct: number;
    incorrect: number;
    accuracy: number;
    avgTime?: number;
}

interface IPartAnalysis {
    partNumber: string;
    totalQuestions: number;
    correctAnswers: number;
    accuracy: number;
    avgTimePerQuestion?: number;
    skillBreakdown: ISkillPerformance[];
    contextualAnalysis?: string;
}

interface IDiagnosisInsight {
    id: string;
    severity: string;
    skillKey: string;
    skillName: string;
    category: string;
    title: string;
    description: string;
    affectedParts: string[];
    userAccuracy: number;
    benchmarkAccuracy?: number;
    impactScore: number;
    incorrectCount?: number;
    totalCount?: number;
    relatedPattern?: string;
}

interface ITestResult {
    _id?: Schema.Types.ObjectId;
    userId: Schema.Types.ObjectId;
    testId: Schema.Types.ObjectId;
    testTitle: string;
    testType: string;
    duration: number; // ms
    completedAt: Date;
    score: number;
    listeningScore?: number;
    readingScore?: number;
    totalQuestions: number;
    userAnswers: IUserAnswer[];
    parts: string[];
    partsKey?: string;
    startedAt?: Date;

    analysis?: {
        timeAnalysis?: {
            partMetrics?: IPartMetrics[];
            overallMetrics?: IOverallMetrics;
            hesitationAnalysis?: IHesitationAnalysis;
            answerChangePatterns?: IAnswerChangePatterns;
        };
        examAnalysis?: {
            overallSkills?: Map<string, number>;
            partAnalyses?: IPartAnalysis[];
            weaknesses?: IDiagnosisInsight[];
            strengths?: string[];
        };
    };
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

const hesitationQuestionSchema = new Schema<IHesitationQuestion>(
    {
        questionNumber: { type: Number, required: true },
        answerChanges: { type: Number, required: true },
        timeToFirstAnswer: { type: Number, required: true },
        totalTimeSpent: { type: Number, required: true },
        finalAnswer: { type: String, required: true },
        isCorrect: { type: Boolean, required: true },
        changeHistory: { type: [String], required: true },
    },
    { _id: false }
);

const hesitationAnalysisSchema = new Schema<IHesitationAnalysis>(
    {
        topHesitationQuestions: {
            type: [hesitationQuestionSchema],
            required: true,
        },
        averageChangesPerQuestion: { type: Number, required: true },
        questionsWithMultipleChanges: { type: Number, required: true },
    },
    { _id: false }
);

const answerChangePatternsSchema = new Schema<IAnswerChangePatterns>(
    {
        correctToIncorrect: { type: Number, required: true },
        incorrectToCorrect: { type: Number, required: true },
        incorrectToIncorrect: { type: Number, required: true },
    },
    { _id: false }
);

const skillPerformanceSchema = new Schema<ISkillPerformance>(
    {
        skillName: { type: String, required: true },
        skillKey: { type: String, required: true },
        total: { type: Number, required: true },
        correct: { type: Number, required: true },
        incorrect: { type: Number, required: true },
        accuracy: { type: Number, required: true },
        avgTime: { type: Number },
    },
    { _id: false }
);

const partAnalysisSchema = new Schema<IPartAnalysis>(
    {
        partNumber: { type: String, required: true },
        totalQuestions: { type: Number, required: true },
        correctAnswers: { type: Number, required: true },
        accuracy: { type: Number, required: true },
        avgTimePerQuestion: { type: Number },
        skillBreakdown: [skillPerformanceSchema],
        contextualAnalysis: { type: String },
    },
    { _id: false }
);

const diagnosisInsightSchema = new Schema<IDiagnosisInsight>(
    {
        id: { type: String, required: true },
        severity: { type: String, required: true },
        category: { type: String, required: true },
        title: { type: String, required: true },
        description: { type: String, required: true },
        affectedParts: [{ type: String }],
        userAccuracy: { type: Number, required: true },
        benchmarkAccuracy: { type: Number },
        impactScore: { type: Number, required: true, min: 0, max: 100 },
        relatedPattern: { type: String },
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
        listeningScore: { type: Number },
        readingScore: { type: Number },
        totalQuestions: { type: Number, required: true },
        userAnswers: [userAnswerSchema],
        parts: [{ type: String, required: true }],
        partsKey: { type: String, required: false },
        startedAt: { type: Date, required: false },
        analysis: {
            type: new Schema(
                {
                    timeAnalysis: {
                        type: new Schema(
                            {
                                partMetrics: {
                                    type: [partMetricsSchema],
                                    required: false,
                                },
                                overallMetrics: {
                                    type: overallMetricsSchema,
                                    required: false,
                                },
                                hesitationAnalysis: {
                                    type: hesitationAnalysisSchema,
                                    required: false,
                                },
                                answerChangePatterns: {
                                    type: answerChangePatternsSchema,
                                    required: false,
                                },
                            },
                            { _id: false }
                        ),
                        required: false,
                    },
                    examAnalysis: {
                        type: new Schema(
                            {
                                overallSkills: {
                                    type: Map,
                                    of: Number,
                                    required: false,
                                },
                                partAnalyses: {
                                    type: [partAnalysisSchema],
                                    required: false,
                                },
                                weaknesses: {
                                    type: [diagnosisInsightSchema],
                                    required: false,
                                },
                                strengths: {
                                    type: [String],
                                    required: false,
                                },
                            },
                            { _id: false }
                        ),
                        required: false,
                    },
                },
                { _id: false }
            ),
            required: false,
        },
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
    IHesitationQuestion,
    IHesitationAnalysis,
    IAnswerChangePatterns,
    ISkillPerformance,
    IPartAnalysis,
    IDiagnosisInsight,
};
