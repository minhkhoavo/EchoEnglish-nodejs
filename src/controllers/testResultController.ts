import { Request, Response } from 'express';
import { testResultService } from '../services/testResultService.js';
import { TestResult } from '../models/testResultModel.js';
import { SubmitTestResultRequest } from '../dto/request/testResultRequest.js';
import { SuccessMessage } from '../enum/successMessage.js';
import { ErrorMessage } from '../enum/errorMessage.js';

export class TestResultController {
    async submitTestResult(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: ErrorMessage.UNAUTHORIZED.message,
                });
            }

            const requestData: SubmitTestResultRequest = req.body;

            // Validate required fields
            if (
                !requestData.testId ||
                !requestData.testTitle ||
                !requestData.userAnswers ||
                !Array.isArray(requestData.userAnswers)
            ) {
                console.log('❌ Validation failed:', {
                    hasTestId: !!requestData.testId,
                    hasTestTitle: !!requestData.testTitle,
                    hasUserAnswers: !!requestData.userAnswers,
                    isArrayUserAnswers: Array.isArray(requestData.userAnswers),
                });
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields',
                });
            }

            const result = await testResultService.submitTestResult(
                userId,
                requestData
            );

            res.status(201).json({
                success: true,
                message: SuccessMessage.CREATE_SUCCESS,
                data: result,
            });
        } catch (error: unknown) {
            console.error(
                '[submitTestResult] ERROR:',
                error && (error as Error).stack ? (error as Error).stack : error
            );
            res.status(500).json({
                success: false,
                message:
                    error && (error as Error).message
                        ? (error as Error).message
                        : ErrorMessage.INTERNAL_ERROR.message,
            });
        }
    }

    async getTestHistory(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: ErrorMessage.UNAUTHORIZED.message,
                });
            }

            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const filterUserId = (req.query.userId as string) || undefined;
            const testId = (req.query.testId as string) || undefined;

            const result = await testResultService.getTestHistory(
                filterUserId || userId,
                page,
                limit,
                testId
            );

            res.status(200).json({
                success: true,
                message: SuccessMessage.GET_SUCCESS,
                data: result.results,
                pagination: {
                    page,
                    limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / limit),
                },
            });
        } catch (error: unknown) {
            res.status(500).json({
                success: false,
                message:
                    (error as Error).message ||
                    ErrorMessage.INTERNAL_ERROR.message,
            });
        }
    }

    async getTestResultDetail(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: ErrorMessage.UNAUTHORIZED.message,
                });
            }

            const { resultId } = req.params;
            if (!resultId) {
                return res.status(400).json({
                    success: false,
                    message: 'Result ID is required',
                });
            }

            const result = await testResultService.getTestResultDetail(
                userId,
                resultId
            );

            res.status(200).json({
                success: true,
                message: SuccessMessage.GET_SUCCESS,
                data: result,
            });
        } catch (error: unknown) {
            if ((error as Error).message.includes('not found')) {
                return res.status(404).json({
                    success: false,
                    message: (error as Error).message,
                });
            }

            res.status(500).json({
                success: false,
                message:
                    (error as Error).message ||
                    ErrorMessage.INTERNAL_ERROR.message,
            });
        }
    }

    async getUserStats(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: ErrorMessage.UNAUTHORIZED.message,
                });
            }

            const stats = await testResultService.getUserStats(userId);

            res.status(200).json({
                success: true,
                message: SuccessMessage.GET_SUCCESS,
                data: stats,
            });
        } catch (error: unknown) {
            res.status(500).json({
                success: false,
                message:
                    (error as Error).message ||
                    ErrorMessage.INTERNAL_ERROR.message,
            });
        }
    }

    async getListeningReading(req: Request, res: Response) {
        try {
            const userId = req.user?.id as string;
            const results =
                await testResultService.getListeningReadingResults(userId);

            res.status(200).json({
                success: true,
                message: 'OK',
                data: results,
            });
        } catch (error: unknown) {
            res.status(500).json({
                success: false,
                message:
                    (error as Error).message ||
                    ErrorMessage.INTERNAL_ERROR.message,
            });
        }
    }

    async getTestResultAnalytics(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            const { resultId } = req.params;

            const result = await TestResult.findOne({
                _id: resultId,
                userId,
            }).lean();

            if (!result) {
                return res.status(404).json({
                    success: false,
                    message: 'Test result not found',
                });
            }

            // Extract analytics data
            const analytics = {
                testInfo: {
                    id: result._id.toString(),
                    testTitle: result.testTitle,
                    completedAt: result.completedAt,
                    score: result.score,
                    totalQuestions: result.totalQuestions,
                    percentage: Math.round(
                        (result.score / result.totalQuestions) * 100
                    ),
                },
                partMetrics: result.partMetrics || [],
                overallMetrics: result.overallMetrics
                    ? {
                          ...result.overallMetrics,
                          timeDistribution:
                              result.overallMetrics.timeDistribution instanceof
                              Map
                                  ? Object.fromEntries(
                                        result.overallMetrics.timeDistribution
                                    )
                                  : result.overallMetrics.timeDistribution ||
                                    {},
                      }
                    : null,
            };

            res.status(200).json({
                success: true,
                message: SuccessMessage.GET_SUCCESS,
                data: analytics,
            });
        } catch (error: unknown) {
            console.error('[getTestResultAnalytics] ERROR:', error);
            res.status(500).json({
                success: false,
                message:
                    error && (error as Error).message
                        ? (error as Error).message
                        : ErrorMessage.INTERNAL_ERROR.message,
            });
        }
    }

    async getSlowestQuestions(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            const { testId } = req.params;
            const limit = parseInt(req.query.limit as string) || 20;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: ErrorMessage.UNAUTHORIZED.message,
                });
            }

            if (!testId) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing testId parameter',
                });
            }

            // Fetch the specific test result and ensure ownership
            const result = await TestResult.findOne({
                _id: testId,
                userId,
            })
                .select('userAnswers testTitle completedAt partMetrics')
                .lean();

            if (!result) {
                return res.status(404).json({
                    success: false,
                    message: 'Test result not found',
                });
            }

            const PART_QUESTION_RANGES: Record<string, [number, number]> = {
                part1: [1, 6],
                part2: [7, 31],
                part3: [32, 70],
                part4: [71, 100],
                part5: [101, 130],
                part6: [131, 146],
                part7: [147, 200],
            };

            const partsToAnalyze =
                result.partMetrics && result.partMetrics.length > 0
                    ? result.partMetrics.map((pm) => pm.partName)
                    : Object.keys(PART_QUESTION_RANGES).filter((p) =>
                          result.userAnswers.some(
                              (a) =>
                                  a.questionNumber >=
                                      PART_QUESTION_RANGES[p][0] &&
                                  a.questionNumber <= PART_QUESTION_RANGES[p][1]
                          )
                      );

            const byPart = partsToAnalyze
                .map((partName) => {
                    const partMetric = result.partMetrics?.find(
                        (pm) => pm.partName === partName
                    );

                    if (partMetric) {
                        return {
                            partName,
                            questionsCount: partMetric.questionsCount,
                            totalTime: partMetric.totalTime,
                            averageTimePerQuestion:
                                partMetric.averageTimePerQuestion,
                            slowestQuestions: partMetric.slowestQuestions.map(
                                (qNum) => ({
                                    questionNumber: qNum,
                                    totalTime:
                                        result.userAnswers.find(
                                            (a) => a.questionNumber === qNum
                                        )?.totalTimeSpent || 0,
                                    answerChanges:
                                        result.userAnswers.find(
                                            (a) => a.questionNumber === qNum
                                        )?.answerChanges || 0,
                                })
                            ),
                        };
                    }

                    const range = PART_QUESTION_RANGES[partName];
                    if (!range) return null;
                    const [start, end] = range;

                    const partAnswers = result.userAnswers
                        .filter(
                            (a) =>
                                a.questionNumber >= start &&
                                a.questionNumber <= end
                        )
                        .map((a) => ({
                            questionNumber: a.questionNumber,
                            totalTime: a.totalTimeSpent || 0,
                            answerChanges: a.answerChanges || 0,
                        }));

                    const slowest = [...partAnswers]
                        .sort((a, b) => b.totalTime - a.totalTime)
                        .slice(0, Math.min(limit, partAnswers.length));

                    return {
                        partName,
                        questionsCount: partAnswers.length,
                        totalTime: partAnswers.reduce(
                            (s, p) => s + p.totalTime,
                            0
                        ),
                        averageTimePerQuestion:
                            partAnswers.length > 0
                                ? Math.round(
                                      partAnswers.reduce(
                                          (s, p) => s + p.totalTime,
                                          0
                                      ) / partAnswers.length
                                  )
                                : 0,
                        slowestQuestions: slowest,
                    };
                })
                .filter((x): x is NonNullable<typeof x> => !!x);

            res.status(200).json({
                success: true,
                message: SuccessMessage.GET_SUCCESS,
                data: {
                    testId: result._id.toString(),
                    testTitle: result.testTitle,
                    completedAt: result.completedAt,
                    byPart,
                },
            });
        } catch (error: unknown) {
            console.error('[getSlowestQuestions] ERROR:', error);
            res.status(500).json({
                success: false,
                message:
                    error && (error as Error).message
                        ? (error as Error).message
                        : ErrorMessage.INTERNAL_ERROR.message,
            });
        }
    }
}

export const testResultController = new TestResultController();
