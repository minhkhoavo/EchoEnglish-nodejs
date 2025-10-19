import { Request, Response } from 'express';
import { testResultService } from '../services/testResultService.js';
import { TestResult } from '../models/testResultModel.js';
import { SubmitTestResultRequest } from '../dto/request/testResultRequest.js';
import { SuccessMessage } from '../enum/successMessage.js';
import { ErrorMessage } from '../enum/errorMessage.js';
import { analysisEngineService } from '../services/analysis/AnalysisEngineService.js';
import { weaknessDetectorService } from '../services/diagnosis/WeaknessDetectorService.js';
import { studyPlanGeneratorService } from '../services/recommendation/StudyPlanGeneratorService.js';
import { StudyPlan, StudyPlanType } from '../models/studyPlanModel.js';
import { ApiError } from '~/middleware/apiError.js';
import ApiResponse from '../dto/response/apiResponse.js';
import creditsService from '../services/payment/creditsService.js';

export class TestResultController {
    async submitTestResult(req: Request, res: Response) {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const requestData: SubmitTestResultRequest = req.body;

        const result = await testResultService.submitTestResult(
            userId,
            requestData
        );

        return res
            .status(201)
            .json(new ApiResponse(SuccessMessage.CREATE_SUCCESS, result));
    }

    async getTestHistory(req: Request, res: Response) {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const testId = (req.query.testId as string) || undefined;

        const result = await testResultService.getTestHistory(
            userId,
            page,
            limit,
            testId
        );

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    }

    async getTestResultDetail(req: Request, res: Response) {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const { testId } = req.params;
        const result = await testResultService.getTestResultDetail(
            userId,
            testId
        );

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    }

    async getUserStats(req: Request, res: Response) {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const stats = await testResultService.getUserStats(userId);

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, stats));
    }

    async getAllListeningReadingResults(req: Request, res: Response) {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const results =
            await testResultService.getListeningReadingResults(userId);

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, results));
    }

    async getListeningReadingChartData(req: Request, res: Response) {
        const userId = req.user?.id as string;
        const chartData =
            await testResultService.getListeningReadingChartData(userId);

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, chartData));
    }

    async getTestResultMetrics(req: Request, res: Response) {
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

            // Extract comprehensive metrics data from new system
            const metrics = {
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
                // New partMetrics from the timing analysis system
                partMetrics:
                    result.analysis?.timeAnalysis?.partMetrics?.map((pm) => ({
                        partName: pm.partName,
                        questionsCount: pm.questionsCount,
                        totalTime: pm.totalTime,
                        averageTimePerQuestion: pm.averageTimePerQuestion,
                        answerChangeRate: pm.answerChangeRate,
                        slowestQuestions: pm.slowestQuestions || [],
                    })) || [],
                // New overallMetrics from the timing analysis system
                overallMetrics: result.analysis?.timeAnalysis?.overallMetrics
                    ? {
                          totalActiveTime:
                              result.analysis.timeAnalysis.overallMetrics
                                  .totalActiveTime,
                          averageTimePerQuestion:
                              result.analysis.timeAnalysis.overallMetrics
                                  .averageTimePerQuestion,
                          totalAnswerChanges:
                              result.analysis.timeAnalysis.overallMetrics
                                  .totalAnswerChanges,
                          confidenceScore:
                              result.analysis.timeAnalysis.overallMetrics
                                  .confidenceScore,
                          timeDistribution:
                              result.analysis.timeAnalysis.overallMetrics
                                  .timeDistribution instanceof Map
                                  ? Object.fromEntries(
                                        result.analysis.timeAnalysis
                                            .overallMetrics.timeDistribution
                                    )
                                  : result.analysis.timeAnalysis.overallMetrics
                                        .timeDistribution || {},
                      }
                    : null,
            };

            res.status(200).json({
                success: true,
                message: SuccessMessage.GET_SUCCESS,
                data: metrics,
            });
        } catch (error: unknown) {
            console.error('[getTestResultMetrics] ERROR:', error);
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
                result.analysis?.timeAnalysis?.partMetrics &&
                result.analysis.timeAnalysis.partMetrics.length > 0
                    ? result.analysis.timeAnalysis.partMetrics.map(
                          (pm) => pm.partName
                      )
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
                    const partMetric =
                        result.analysis?.timeAnalysis?.partMetrics?.find(
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

    /**
     * POST /api/test-results/:id/analyze
     * Trigger deep analysis for a test result
     */
    async analyzeTestResult(req: Request, res: Response) {
        try {
            const userId = req.user?.id as string;
            const testResultId = req.params.id;
            const creditResult = await creditsService.deductCreditsForFeature(
                userId,
                'test_analysis_lr'
            );
            let creditsDeducted = creditResult.creditsDeducted;

            // Run analysis pipeline
            // 1. Core analysis - now updates testResult directly
            const testResult =
                await analysisEngineService.analyzeTestResult(testResultId);

            if (!testResult) {
                return res.status(404).json({
                    success: false,
                    message: 'Test result not found',
                });
            }

            console.log('PASS1 >>>>>>> Analysis complete::::::::');

            // 2. Weakness detection with AI - now uses testResultId
            await weaknessDetectorService.detectWeaknesses(testResultId);
            console.log('PASS 2 >>>>>>> weakness detection complete::::::::');

            // // 3. Generate study plan - now uses testResultId
            const studyPlan = await studyPlanGeneratorService.generateStudyPlan(
                testResultId,
                userId
            );
            console.log(
                'PASS 3 >>>>>>> study plan generation complete::::::::'
            );

            res.status(200).json({
                success: true,
                message: 'Analysis completed successfully',
                data: {
                    testResultId: testResult._id,
                    studyPlanId: studyPlan._id,
                    creditsDeducted,
                },
            });
        } catch (error: unknown) {
            console.error('Analysis error:', error);
            res.status(500).json({
                success: false,
                message:
                    (error as Error).message ||
                    ErrorMessage.INTERNAL_ERROR.message,
            });
        }
    }

    /**
     * GET /api/test-results/:id/analysis
     * Get analysis result for a test
     */
    async getAnalysisResult(req: Request, res: Response) {
        try {
            const testResultId = req.params.id;

            const testResult =
                await analysisEngineService.getAnalysisResult(testResultId);
            const studyPlanDoc =
                (await StudyPlan.findOne({ testResultId })
                    .select('planItems')
                    .lean()) ?? [];
            const studyPlan =
                (studyPlanDoc as { planItems?: StudyPlanType['planItems'] })
                    ?.planItems ?? [];

            if (!testResult || !testResult.analysis) {
                return res.status(404).json({
                    success: false,
                    message: 'Analysis not found. Please run analysis first.',
                });
            }

            res.status(200).json({
                success: true,
                data: {
                    testResultId: testResult._id,
                    userId: testResult.userId,
                    testId: testResult.testId,
                    examDate: testResult.completedAt,
                    listeningScore: testResult.listeningScore || 0,
                    readingScore: testResult.readingScore || 0,
                    totalScore: testResult.totalScore || 0,
                    analysis: testResult.analysis,
                    studyPlan,
                },
            });
        } catch (error: unknown) {
            console.error('Get analysis error:', error);
            res.status(500).json({
                success: false,
                message:
                    (error as Error).message ||
                    ErrorMessage.INTERNAL_ERROR.message,
            });
        }
    }

    /**
     * GET /api/test-results/:id/study-plan
     * Get study plan for a test result
     */
    async getStudyPlan(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: ErrorMessage.UNAUTHORIZED.message,
                });
            }

            // Get active study plan for user
            const studyPlan =
                await studyPlanGeneratorService.getActiveStudyPlan(userId);

            if (!studyPlan) {
                return res.status(404).json({
                    success: false,
                    message:
                        'No active study plan found. Please complete an analysis first.',
                });
            }

            res.status(200).json({
                success: true,
                data: studyPlan,
            });
        } catch (error: unknown) {
            console.error('Get study plan error:', error);
            res.status(500).json({
                success: false,
                message:
                    (error as Error).message ||
                    ErrorMessage.INTERNAL_ERROR.message,
            });
        }
    }

    /**
     * PATCH /api/study-plans/:id/items/:priority/progress
     * Update study plan item progress
     */
    async updateStudyPlanProgress(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: ErrorMessage.UNAUTHORIZED.message,
                });
            }

            const { id: studyPlanId, priority } = req.params;
            const { progress } = req.body;

            if (progress === undefined || progress < 0 || progress > 100) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Invalid progress value. Must be between 0 and 100.',
                });
            }

            const updatedPlan =
                await studyPlanGeneratorService.updateItemProgress(
                    studyPlanId,
                    parseInt(priority),
                    progress
                );

            if (!updatedPlan) {
                return res.status(404).json({
                    success: false,
                    message: 'Study plan not found.',
                });
            }

            res.status(200).json({
                success: true,
                message: 'Progress updated successfully',
                data: updatedPlan,
            });
        } catch (error: unknown) {
            console.error('Update progress error:', error);
            res.status(500).json({
                success: false,
                message:
                    (error as Error).message ||
                    ErrorMessage.INTERNAL_ERROR.message,
            });
        }
    }
}

export const testResultController = new TestResultController();
