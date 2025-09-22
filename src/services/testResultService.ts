import { TestResult, IUserAnswer } from '../models/testResultModel.js';
import { SubmitTestResultRequest } from '../dto/request/testResultRequest.js';
import {
    TestResultResponse,
    TestHistoryResponse,
    TestResultSummaryResponse,
} from '../dto/response/testResultResponse.js';
import testService from './testService.js';

interface TestQuestion {
    correctAnswer?: string;
}

interface TestQuestionGroup {
    questions: TestQuestion[];
}

interface TestPart {
    questions?: TestQuestion[];
    questionGroups?: TestQuestionGroup[];
}

interface TestData {
    parts: TestPart[];
}

// TOEIC part question counts
const PART_QUESTION_COUNTS: Record<string, number> = {
    part1: 6,
    part2: 25,
    part3: 39,
    part4: 30,
    part5: 30,
    part6: 16,
    part7: 54,
};

class TestResultService {
    // Calculate total questions based on selected parts
    private calculateTotalQuestions(parts: string[]): number {
        if (!parts || parts.length === 0) {
            // If no parts specified, assume full test
            return Object.values(PART_QUESTION_COUNTS).reduce(
                (sum, count) => sum + count,
                0
            );
        }

        return parts.reduce((sum, part) => {
            const count = PART_QUESTION_COUNTS[part];
            if (!count) {
                console.warn(`[calculateTotalQuestions] Unknown part: ${part}`);
                return sum;
            }
            return sum + count;
        }, 0);
    }

    async submitTestResult(
        userId: string,
        requestData: SubmitTestResultRequest
    ): Promise<TestResultSummaryResponse> {
        try {
            // Get test data to validate answers
            const testDataResult = await testService.getTestById(
                requestData.testId
            );
            if (!testDataResult) {
                throw new Error('Test not found');
            }
            const testData = testDataResult as unknown as TestData;

            // Normalize parts: nếu parts là 1 phần tử dạng "part1-part4-part3" thì tách ra thành mảng
            let normalizedParts = requestData.parts;
            if (
                Array.isArray(requestData.parts) &&
                requestData.parts.length === 1 &&
                typeof requestData.parts[0] === 'string' &&
                requestData.parts[0].includes('-')
            ) {
                normalizedParts = requestData.parts[0].split('-');
            }

            // Calculate total questions based on selected parts
            const totalQuestions =
                this.calculateTotalQuestions(normalizedParts);

            // Calculate scores and validate answers
            const processedAnswers = this.processUserAnswers(
                requestData.userAnswers,
                testData
            );
            const score = processedAnswers.filter(
                (answer) => answer.isCorrect
            ).length;

            // Tạo partKey: nếu đủ 7 part thì là 'full', còn lại thì sort và join '-'
            let partsKey = 'full';
            if (normalizedParts && normalizedParts.length > 0) {
                partsKey =
                    normalizedParts.length === 7
                        ? 'full'
                        : [...normalizedParts].sort().join('-');
            }

            // Create test result
            const testResult = new TestResult({
                userId,
                testId: requestData.testId,
                testTitle: requestData.testTitle,
                testType: requestData.testType,
                duration: requestData.duration,
                score,
                totalQuestions, // Now based on selected parts, not answers submitted
                userAnswers: processedAnswers,
                parts: normalizedParts,
                partsKey,
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
        testData: TestData
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

    private extractCorrectAnswers(testData: TestData): Record<number, string> {
        const correctAnswers: Record<number, string> = {};
        let questionNumber = 1;

        testData.parts.forEach((part: TestPart, partIdx: number) => {
            if (part.questions) {
                // For parts with direct questions (Part 1, 2, 5)
                part.questions.forEach(
                    (question: TestQuestion, qIdx: number) => {
                        if (!('correctAnswer' in question)) {
                            console.error(
                                '[extractCorrectAnswers] Missing correctAnswer in question:',
                                { partIdx, qIdx, question }
                            );
                        }
                        correctAnswers[questionNumber] =
                            question.correctAnswer || 'N/A';
                        questionNumber++;
                    }
                );
            } else if (part.questionGroups) {
                // For parts with question groups (Part 3, 4, 6, 7)
                part.questionGroups.forEach(
                    (group: TestQuestionGroup, gIdx: number) => {
                        group.questions.forEach(
                            (question: TestQuestion, qIdx: number) => {
                                if (!('correctAnswer' in question)) {
                                    console.error(
                                        '[extractCorrectAnswers] Missing correctAnswer in group question:',
                                        { partIdx, gIdx, qIdx, question }
                                    );
                                }
                                correctAnswers[questionNumber] =
                                    question.correctAnswer || 'N/A';
                                questionNumber++;
                            }
                        );
                    }
                );
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
            const query: { userId: string; testId?: string } = { userId };
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

            const formattedResults: TestHistoryResponse[] = results.map(
                (result) => ({
                    id: result._id.toString(),
                    testTitle: result.testTitle,
                    testType: result.testType,
                    completedAt: result.completedAt.toISOString(),
                    score: result.score,
                    totalQuestions: result.totalQuestions,
                    duration: result.duration,
                    percentage: Math.round(
                        (result.score / result.totalQuestions) * 100
                    ),
                    partsKey: result.partsKey,
                })
            );

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
            const result = await TestResult.findOne({
                _id: resultId,
                userId,
            }).lean();

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
                percentage: Math.round(
                    (result.score / result.totalQuestions) * 100
                ),
                userAnswers: result.userAnswers,
                parts: result.parts,
            };
        } catch (error: unknown) {
            const errorMessage =
                error instanceof Error ? error.message : 'Unknown error';
            throw new Error(
                `Failed to get test result detail: ${errorMessage}`
            );
        }
    }

    async getUserStats(userId: string): Promise<{
        listeningReadingTests: number;
        averageScore: number;
        highestScore: number;
        recentTests: TestHistoryResponse[];
    }> {
        try {
            const results = await TestResult.find({ userId }).lean();

            if (results.length === 0) {
                return {
                    listeningReadingTests: 0,
                    averageScore: 0,
                    highestScore: 0,
                    recentTests: [],
                };
            }

            // Filter by test type
            const listeningReadingTests = results.filter(
                (result) => result.testType === 'listening-reading'
            );

            const fullModeResults = results.filter(
                (result) => result.partsKey === 'full'
            );

            const averageScore =
                fullModeResults.length > 0
                    ? Math.round(
                          fullModeResults.reduce(
                              (sum, result) => sum + result.score * 5,
                              0
                          ) / fullModeResults.length
                      )
                    : 0;

            // Calculate highest score (score * 5 for listening-reading tests)
            const highestScore =
                listeningReadingTests.length > 0
                    ? Math.max(
                          ...listeningReadingTests.map(
                              (result) => result.score * 5
                          )
                      )
                    : 0;

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
                    percentage: Math.round(
                        (result.score / result.totalQuestions) * 100
                    ),
                    partsKey: result.partsKey,
                }));

            return {
                listeningReadingTests: listeningReadingTests.length,
                averageScore,

                highestScore,
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
