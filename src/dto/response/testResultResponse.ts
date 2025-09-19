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
  }>;
  parts: string[];
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
