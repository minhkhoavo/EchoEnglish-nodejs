import {
  TestResult,
  ITestResult,
  IUserAnswer,
} from '../models/testResultModel';
import {
  SubmitTestResultRequest,
  TestResultSummary,
} from '../dto/request/testResultRequest';
import {
  TestResultResponse,
  TestHistoryResponse,
  TestResultSummaryResponse,
} from '../dto/response/testResultResponse';
import testService from './testService';

class TestResultService {
  async submitTestResult(
    userId: string,
    requestData: SubmitTestResultRequest
  ): Promise<TestResultSummaryResponse> {
    try {
      // Get test data to validate answers
      const testData = await testService.getTestById(requestData.testId);
      if (!testData) {
        throw new Error('Test not found');
      }

      // Calculate scores and validate answers
      const processedAnswers = this.processUserAnswers(
        requestData.userAnswers,
        testData
      );
      const score = processedAnswers.filter(
        (answer) => answer.isCorrect
      ).length;
      const totalQuestions = processedAnswers.length;

      // Create test result
      const testResult = new TestResult({
        userId,
        testId: requestData.testId,
        testTitle: requestData.testTitle,
        testType: requestData.testType,
        duration: requestData.duration,
        score,
        totalQuestions,
        userAnswers: processedAnswers,
        parts: requestData.parts,
        completedAt: new Date(),
      });

      await testResult.save();

      const percentage = Math.round((score / totalQuestions) * 100);

      return {
        score,
        totalQuestions,
        correctAnswers: score,
        incorrectAnswers: totalQuestions - score,
        percentage,
        message: `Bạn đã làm đúng ${score}/${totalQuestions} câu (${percentage}%)`,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to submit test result: ${errorMessage}`);
    }
  }

  private processUserAnswers(
    userAnswers: Array<{ questionNumber: number; selectedAnswer: string }>,
    testData: any
  ): IUserAnswer[] {
    const processedAnswers: IUserAnswer[] = [];

    // Create a map of correct answers from test data
    const correctAnswersMap = this.extractCorrectAnswers(testData);

    userAnswers.forEach((userAnswer) => {
      const correctAnswer = correctAnswersMap[userAnswer.questionNumber];
      if (correctAnswer === undefined) {
        console.error(
          '[processUserAnswers] No correct answer for questionNumber:',
          userAnswer.questionNumber,
          'userAnswer:',
          userAnswer
        );
      }
      const isCorrect = userAnswer.selectedAnswer === correctAnswer;

      processedAnswers.push({
        questionNumber: userAnswer.questionNumber,
        selectedAnswer: userAnswer.selectedAnswer,
        isCorrect,
        correctAnswer: correctAnswer || 'N/A',
      });
    });

    return processedAnswers;
  }

  private extractCorrectAnswers(testData: any): Record<number, string> {
    const correctAnswers: Record<number, string> = {};
    let questionNumber = 1;

    testData.parts.forEach((part: any, partIdx: number) => {
      if (part.questions) {
        // For parts with direct questions (Part 1, 2, 5)
        part.questions.forEach((question: any, qIdx: number) => {
          if (!('correctAnswer' in question)) {
            console.error(
              '[extractCorrectAnswers] Missing correctAnswer in question:',
              { partIdx, qIdx, question }
            );
          }
          correctAnswers[questionNumber] = question.correctAnswer;
          questionNumber++;
        });
      } else if (part.questionGroups) {
        // For parts with question groups (Part 3, 4, 6, 7)
        part.questionGroups.forEach((group: any, gIdx: number) => {
          group.questions.forEach((question: any, qIdx: number) => {
            if (!('correctAnswer' in question)) {
              console.error(
                '[extractCorrectAnswers] Missing correctAnswer in group question:',
                { partIdx, gIdx, qIdx, question }
              );
            }
            correctAnswers[questionNumber] = question.correctAnswer;
            questionNumber++;
          });
        });
      } else {
        console.error(
          '[extractCorrectAnswers] Part missing questions or questionGroups:',
          { partIdx, part }
        );
      }
    });

    return correctAnswers;
  }

  async getTestHistory(
    userId: string,
    page: number = 1,
    limit: number = 10,
    testId?: string
  ): Promise<{ results: TestHistoryResponse[]; total: number }> {
    try {
      const skip = (page - 1) * limit;
      const query: any = { userId };
      if (testId) {
        query.testId = testId;
      }

      const [results, total] = await Promise.all([
        TestResult.find(query)
          .sort({ completedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        TestResult.countDocuments(query),
      ]);

      const formattedResults: TestHistoryResponse[] = results.map((result) => ({
        id: result._id.toString(),
        testTitle: result.testTitle,
        testType: result.testType,
        completedAt: result.completedAt.toISOString(),
        score: result.score,
        totalQuestions: result.totalQuestions,
        duration: result.duration,
        percentage: Math.round((result.score / result.totalQuestions) * 100),
      }));

      return {
        results: formattedResults,
        total,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get test history: ${errorMessage}`);
    }
  }

  async getTestResultDetail(
    userId: string,
    resultId: string
  ): Promise<TestResultResponse> {
    try {
      const result = await TestResult.findOne({ _id: resultId, userId }).lean();

      if (!result) {
        throw new Error('Test result not found');
      }

      return {
        id: result._id.toString(),
        testId: result.testId,
        testTitle: result.testTitle,
        testType: result.testType,
        duration: result.duration,
        completedAt: result.completedAt.toISOString(),
        score: result.score,
        totalQuestions: result.totalQuestions,
        percentage: Math.round((result.score / result.totalQuestions) * 100),
        userAnswers: result.userAnswers,
        parts: result.parts,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get test result detail: ${errorMessage}`);
    }
  }

  async getUserStats(userId: string): Promise<{
    totalTests: number;
    averageScore: number;
    bestScore: number;
    recentTests: TestHistoryResponse[];
  }> {
    try {
      const results = await TestResult.find({ userId }).lean();

      if (results.length === 0) {
        return {
          totalTests: 0,
          averageScore: 0,
          bestScore: 0,
          recentTests: [],
        };
      }

      const totalTests = results.length;
      const averageScore = Math.round(
        results.reduce(
          (sum, result) => sum + (result.score / result.totalQuestions) * 100,
          0
        ) / totalTests
      );
      const bestScore = Math.max(
        ...results.map((result) =>
          Math.round((result.score / result.totalQuestions) * 100)
        )
      );

      const recentTests = results
        .sort(
          (a, b) =>
            new Date(b.completedAt).getTime() -
            new Date(a.completedAt).getTime()
        )
        .slice(0, 5)
        .map((result) => ({
          id: result._id.toString(),
          testTitle: result.testTitle,
          testType: result.testType,
          completedAt: result.completedAt.toISOString(),
          score: result.score,
          totalQuestions: result.totalQuestions,
          duration: result.duration,
          percentage: Math.round((result.score / result.totalQuestions) * 100),
        }));

      return {
        totalTests,
        averageScore,
        bestScore,
        recentTests,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get user stats: ${errorMessage}`);
    }
  }
}

export const testResultService = new TestResultService();
