export interface SubmitTestResultRequest {
  testId: string;
  testTitle: string;
  testType: string;
  duration: number; // in milliseconds
  userAnswers: Array<{
    questionNumber: number;
    selectedAnswer: string;
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
