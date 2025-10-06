export interface TestResultResponse {
    id: string;
    testId: string;
    testTitle: string;
    testType: string;
    duration: number;
    completedAt: string;
    score: number;
    totalQuestions: number;
    percentage: number;
    userAnswers: Array<{
        questionNumber: number;
        selectedAnswer: string;
        isCorrect: boolean;
        correctAnswer: string;
        // Timing metrics
        timeToFirstAnswer?: number;
        totalTimeSpent?: number;
        // Duration for the specific attempt/answer timeline entries (ms)
        duration?: number;
        answerChanges?: number;
    }>;
    parts: string[];
    // === Timing & Metrics ===
    startedAt?: string;
    partMetrics?: Array<{
        partName: string;
        questionsCount: number;
        totalTime: number;
        averageTimePerQuestion: number;
        answerChangeRate: number;
        slowestQuestions: number[];
    }>;
    overallMetrics?: {
        totalActiveTime: number;
        averageTimePerQuestion: number;
        totalAnswerChanges: number;
        confidenceScore: number;
        timeDistribution: Record<string, number>;
    };
}

export interface TestHistoryResponse {
    id: string;
    testTitle: string;
    testType: string;
    completedAt: string;
    score: number;
    totalQuestions: number;
    duration: number;
    percentage: number;
    partsKey?: string;
}

export interface TestResultSummaryResponse {
    score: number;
    totalQuestions: number;
    correctAnswers: number;
    incorrectAnswers: number;
    percentage: number;
    message: string;
}
