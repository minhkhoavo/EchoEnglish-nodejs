export interface SubmitTestResultRequest {
    testId: string;
    testTitle: string;
    testType: string;
    duration: number; // in milliseconds
    startedAt?: number; // Timestamp when test started (milliseconds)
    userAnswers: Array<{
        questionNumber: number;
        selectedAnswer: string;
        // Timeline of answer changes
        answerTimeline?: Array<{
            answer: string; // 'A', 'B', 'C', 'D'
            timestamp: number; // milliseconds from test start
        }>;
    }>;
    parts: string[];
}

export interface TestResultSummary {
    score: number;
    totalQuestions: number;
    correctAnswers: number;
    incorrectAnswers: number;
    percentage: number;
}
