/* eslint-disable @typescript-eslint/no-explicit-any */
import { testResultService } from '~/services/testResultService.js';
import { TestResult } from '~/models/testResultModel.js';
import testService from '~/services/testService.js';
import { metricsCalculatorService } from '~/services/lr-analyze/metricsCalculatorService.js';
import computeToeicScores from '~/utils/toeicScore.js';
import mongoose from 'mongoose';

// ──────────────────────────────────────────────
// Module Mocks
// ──────────────────────────────────────────────
const mockConstructor = jest.fn();

jest.mock('~/models/testResultModel.js', () => {
    return {
        __esModule: true,
        TestResult: class MockTestResult {
            constructor(public data: any) {
                mockConstructor(data);
                Object.assign(this, data);
            }
            async save() {}
            static find() {}
            static findOne() {}
            static countDocuments() {}
        },
    };
});

jest.mock('~/services/testService.js', () => ({
    __esModule: true,
    default: {
        getTestById: jest.fn(),
    },
}));

jest.mock('~/services/lr-analyze/metricsCalculatorService.js', () => ({
    __esModule: true,
    metricsCalculatorService: {
        calculateMetrics: jest.fn(),
    },
}));

jest.mock('~/utils/toeicScore.js', () => ({
    __esModule: true,
    default: jest.fn(),
}));

const mockedTestService = testService as jest.Mocked<typeof testService>;
const mockedMetricsService = metricsCalculatorService as jest.Mocked<
    typeof metricsCalculatorService
>;
const mockedComputeToeicScores = computeToeicScores as jest.Mock;

// ──────────────────────────────────────────────
// Fixtures & Helpers
// ──────────────────────────────────────────────
function buildMockTestData(overrides: Record<string, any> = {}) {
    return {
        parts: [
            {
                questions: [{ correctAnswer: 'A' }, { correctAnswer: 'B' }],
            },
            {
                questionGroups: [
                    {
                        questions: [
                            { correctAnswer: 'C' },
                            { correctAnswer: 'D' },
                        ],
                    },
                ],
            },
        ],
        ...overrides,
    };
}

describe('TestResultService', () => {
    let mockFind: jest.Mock;
    let mockFindOne: jest.Mock;
    let mockCountDocuments: jest.Mock;
    let mockSave: jest.Mock;

    let mockSort: jest.Mock;
    let mockSkip: jest.Mock;
    let mockLimit: jest.Mock;
    let mockLean: jest.Mock;
    let mockFindOneLean: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockConstructor.mockClear();

        TestResult.find = jest.fn();
        TestResult.findOne = jest.fn();
        TestResult.countDocuments = jest.fn();
        TestResult.prototype.save = jest.fn();

        mockFind = TestResult.find as jest.Mock;
        mockFindOne = TestResult.findOne as jest.Mock;
        mockCountDocuments = TestResult.countDocuments as jest.Mock;
        mockSave = TestResult.prototype.save as jest.Mock;

        mockFind.mockReset();
        mockFindOne.mockReset();
        mockCountDocuments.mockReset();
        mockSave.mockReset();

        mockSort = jest.fn().mockReturnThis();
        mockSkip = jest.fn().mockReturnThis();
        mockLimit = jest.fn().mockReturnThis();
        mockLean = jest.fn();
        mockFindOneLean = jest.fn();

        mockFind.mockReturnValue({
            sort: mockSort,
            skip: mockSkip,
            limit: mockLimit,
            lean: mockLean,
        });

        mockFindOne.mockReturnValue({
            lean: mockFindOneLean,
        });

        mockedComputeToeicScores.mockReturnValue({
            listeningScore: 200,
            readingScore: 200,
            totalScore: 400,
        });
    });

    // ──────────────────────────────────────────────
    // submitTestResult
    // ──────────────────────────────────────────────
    describe('submitTestResult', () => {
        const userId = '60f8e8b4e7c8e8b4e7c8e8b0';
        const requestData = {
            testId: '60f8e8b4e7c8e8b4e7c8e8b1',
            testTitle: 'TOEIC Test 1',
            testType: 'listening-reading',
            duration: 120,
            parts: ['part1', 'part3'],
            userAnswers: [
                { questionNumber: 1, selectedAnswer: 'A' },
                { questionNumber: 2, selectedAnswer: 'B' },
                { questionNumber: 3, selectedAnswer: 'C' },
                { questionNumber: 4, selectedAnswer: 'D' },
            ],
        };

        it('should throw an error if the test is not found', async () => {
            mockedTestService.getTestById.mockResolvedValue(null as any);

            await expect(
                testResultService.submitTestResult(userId, requestData)
            ).rejects.toThrow('Failed to submit test result: Test not found');
        });

        it('should submit test result successfully with correct score and toeic metrics', async () => {
            const mockTest = buildMockTestData();
            mockedTestService.getTestById.mockResolvedValue(mockTest as any);
            mockSave.mockResolvedValue(true);

            // Mock user answers for listening (Q1) and reading (Q101) specifically
            const customRequest = {
                ...requestData,
                userAnswers: [
                    { questionNumber: 1, selectedAnswer: 'A' }, // Listening correct
                    { questionNumber: 2, selectedAnswer: 'X' }, // Incorrect
                    { questionNumber: 101, selectedAnswer: 'C' }, // Reading correct (mapped to questionNumber 101 in parts data)
                ],
            };
            // Map question 1 -> A, question 2 -> B, question 101 -> C
            const testData = buildMockTestData({
                parts: [
                    {
                        questions: Array(100).fill({ correctAnswer: 'A' }),
                    },
                    {
                        questionGroups: [
                            {
                                questions: [
                                    { correctAnswer: 'C' }, // This will be question number 101
                                ],
                            },
                        ],
                    },
                ],
            });
            mockedTestService.getTestById.mockResolvedValue(testData as any);

            const result = await testResultService.submitTestResult(
                userId,
                customRequest
            );

            expect(mockedComputeToeicScores).toHaveBeenCalledWith(1, 1); // Q1 is listening, Q101 is reading
            expect(mockSave).toHaveBeenCalled();
            expect(result).toEqual({
                score: 2,
                totalQuestions: 45, // part1 (6) + part3 (39) = 45
                correctAnswers: 2,
                incorrectAnswers: 43,
                percentage: 4,
                message: 'You got 2/45 questions correct (4%)',
            });
        });

        it('should normalize parts string splits when single element has hyphen format', async () => {
            const mockTest = buildMockTestData();
            mockedTestService.getTestById.mockResolvedValue(mockTest as any);
            mockSave.mockResolvedValue(true);

            const customRequest = {
                ...requestData,
                parts: ['part1-part2-part3'],
            };

            await testResultService.submitTestResult(userId, customRequest);
            // check total questions calculated correctly for part1(6) + part2(25) + part3(39) = 70
            const savedInstance = mockConstructor.mock.calls[0][0];
            expect(savedInstance.parts).toEqual(['part1', 'part2', 'part3']);
            expect(savedInstance.totalQuestions).toBe(70);
            expect(savedInstance.partsKey).toBe('part1-part2-part3');
        });

        it('should default to full test total questions (200) if parts array is empty', async () => {
            const mockTest = buildMockTestData();
            mockedTestService.getTestById.mockResolvedValue(mockTest as any);
            mockSave.mockResolvedValue(true);

            const customRequest = {
                ...requestData,
                parts: [],
            };

            await testResultService.submitTestResult(userId, customRequest);
            const savedInstance = mockConstructor.mock.calls[0][0];
            expect(savedInstance.totalQuestions).toBe(200);
            expect(savedInstance.partsKey).toBe('full');
        });

        it('should calculate metrics when startedAt is provided and normalizedParts is not empty', async () => {
            const mockTest = buildMockTestData();
            mockedTestService.getTestById.mockResolvedValue(mockTest as any);
            mockSave.mockResolvedValue(true);

            const customRequest = {
                ...requestData,
                startedAt: Date.now(),
                userAnswers: [
                    {
                        questionNumber: 1,
                        selectedAnswer: 'A',
                        answerTimeline: [{ answer: 'A', timestamp: 1000 }],
                    },
                ],
            };

            mockedMetricsService.calculateMetrics.mockReturnValue({
                enrichedAnswers: [
                    {
                        questionNumber: 1,
                        selectedAnswer: 'A',
                        isCorrect: true,
                        timeToFirstAnswer: 1000,
                    },
                ],
                partMetrics: [
                    { partName: 'Part 1', averageTimePerQuestion: 10 },
                ],
                overallMetrics: { totalActiveTime: 10, confidenceScore: 80 },
                hesitationAnalysis: {},
                answerChangePatterns: {},
            } as any);

            await testResultService.submitTestResult(userId, customRequest);

            expect(mockedMetricsService.calculateMetrics).toHaveBeenCalled();
            const savedInstance = mockConstructor.mock.calls[0][0];
            expect(savedInstance.userAnswers[0].timeToFirstAnswer).toBe(1000);
            expect(
                savedInstance.analysis.timeAnalysis.partMetrics[0].partName
            ).toBe('Part 1');
        });

        it('should catch metrics calculator service exception gracefully and proceed', async () => {
            const mockTest = buildMockTestData();
            mockedTestService.getTestById.mockResolvedValue(mockTest as any);
            mockSave.mockResolvedValue(true);

            const customRequest = {
                ...requestData,
                startedAt: Date.now(),
            };

            mockedMetricsService.calculateMetrics.mockImplementation(() => {
                throw new Error('Calculator error');
            });

            const errorSpy = jest.spyOn(console, 'error').mockImplementation();

            await testResultService.submitTestResult(userId, customRequest);

            expect(errorSpy).toHaveBeenCalledWith(
                '[submitTestResult] Failed to calculate metrics:',
                expect.any(Error)
            );
            expect(mockSave).toHaveBeenCalled();

            errorSpy.mockRestore();
        });

        it('should handle and log warning if unknown part is passed to calculateTotalQuestions', async () => {
            const mockTest = buildMockTestData();
            mockedTestService.getTestById.mockResolvedValue(mockTest as any);
            mockSave.mockResolvedValue(true);

            const customRequest = {
                ...requestData,
                parts: ['invalidPart', 'part1'],
            };

            const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

            await testResultService.submitTestResult(userId, customRequest);

            expect(warnSpy).toHaveBeenCalledWith(
                '[calculateTotalQuestions] Unknown part: invalidPart'
            );
            const savedInstance = mockConstructor.mock.calls[0][0];
            expect(savedInstance.totalQuestions).toBe(6); // Only part1 (6) counted

            warnSpy.mockRestore();
        });

        it('should log error when question is missing correctAnswer or part missing both structures', async () => {
            const mockTestWithErrors = {
                parts: [
                    { questions: [{} as any] }, // Missing correctAnswer
                    { questionGroups: [{ questions: [{} as any] }] }, // Missing correctAnswer
                    { neither: true } as any, // Missing questions/groups
                ],
            };
            mockedTestService.getTestById.mockResolvedValue(
                mockTestWithErrors as any
            );
            mockSave.mockResolvedValue(true);

            const errorSpy = jest.spyOn(console, 'error').mockImplementation();

            await testResultService.submitTestResult(userId, requestData);

            expect(errorSpy).toHaveBeenCalledWith(
                '[extractCorrectAnswers] Missing correctAnswer in question:',
                expect.any(Object)
            );
            expect(errorSpy).toHaveBeenCalledWith(
                '[extractCorrectAnswers] Missing correctAnswer in group question:',
                expect.any(Object)
            );
            expect(errorSpy).toHaveBeenCalledWith(
                '[extractCorrectAnswers] Part missing questions or questionGroups:',
                expect.any(Object)
            );

            errorSpy.mockRestore();
        });

        it('should log error if userAnswers has a question number not present in test data', async () => {
            const mockTest = buildMockTestData();
            mockedTestService.getTestById.mockResolvedValue(mockTest as any);
            mockSave.mockResolvedValue(true);

            const customRequest = {
                ...requestData,
                userAnswers: [{ questionNumber: 999, selectedAnswer: 'A' }],
            };

            const errorSpy = jest.spyOn(console, 'error').mockImplementation();

            await testResultService.submitTestResult(userId, customRequest);

            expect(errorSpy).toHaveBeenCalledWith(
                '[processUserAnswers] No correct answer for questionNumber:',
                999,
                'userAnswer:',
                expect.any(Object)
            );

            errorSpy.mockRestore();
        });

        it('should catch database saving errors and rethrow them', async () => {
            const mockTest = buildMockTestData();
            mockedTestService.getTestById.mockResolvedValue(mockTest as any);
            mockSave.mockRejectedValue(new Error('Database error'));

            await expect(
                testResultService.submitTestResult(userId, requestData)
            ).rejects.toThrow('Failed to submit test result: Database error');
        });

        it('should throw an error with fallback message if caught error is not an Error instance', async () => {
            const mockTest = buildMockTestData();
            mockedTestService.getTestById.mockResolvedValue(mockTest as any);
            mockSave.mockImplementation(() => {
                throw 'Some string error';
            });

            await expect(
                testResultService.submitTestResult(userId, requestData)
            ).rejects.toThrow('Failed to submit test result: Unknown error');
        });

        it('should handle question number outside standard listening/reading ranges', async () => {
            const customRequest = {
                ...requestData,
                userAnswers: [{ questionNumber: 201, selectedAnswer: 'A' }],
            };
            const testData = buildMockTestData({
                parts: [
                    {
                        questions: Array(201).fill({ correctAnswer: 'A' }),
                    },
                ],
            });
            mockedTestService.getTestById.mockResolvedValue(testData as any);
            mockSave.mockResolvedValue(true);

            await testResultService.submitTestResult(userId, customRequest);

            expect(mockedComputeToeicScores).toHaveBeenCalledWith(0, 0);
            expect(mockSave).toHaveBeenCalled();
        });

        it('should resolve partsKey to full if exactly 7 parts are passed', async () => {
            const mockTest = buildMockTestData();
            mockedTestService.getTestById.mockResolvedValue(mockTest as any);
            mockSave.mockResolvedValue(true);

            const customRequest = {
                ...requestData,
                parts: [
                    'part1',
                    'part2',
                    'part3',
                    'part4',
                    'part5',
                    'part6',
                    'part7',
                ],
            };

            await testResultService.submitTestResult(userId, customRequest);
            const savedInstance = mockConstructor.mock.calls[0][0];
            expect(savedInstance.partsKey).toBe('full');
        });
    });

    // ──────────────────────────────────────────────
    // getTestHistory
    // ──────────────────────────────────────────────
    describe('getTestHistory', () => {
        const userId = 'user-123';

        it('should return list of history successfully mapped with default page/limit', async () => {
            const mockResults = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    testTitle: 'Test A',
                    testType: 'listening-reading',
                    completedAt: new Date('2026-06-10T10:00:00Z'),
                    score: 80,
                    totalQuestions: 100,
                    duration: 120,
                    partsKey: 'full',
                },
            ];

            mockLean.mockResolvedValue(mockResults);
            mockCountDocuments.mockResolvedValue(5);

            const result = await testResultService.getTestHistory(userId);

            expect(mockFind).toHaveBeenCalledWith({ userId });
            expect(mockSort).toHaveBeenCalledWith({ completedAt: -1 });
            expect(mockSkip).toHaveBeenCalledWith(0);
            expect(mockLimit).toHaveBeenCalledWith(10);
            expect(result).toEqual({
                results: [
                    {
                        id: mockResults[0]._id.toString(),
                        testTitle: 'Test A',
                        testType: 'listening-reading',
                        completedAt: '2026-06-10T10:00:00.000Z',
                        score: 80,
                        totalQuestions: 100,
                        duration: 120,
                        percentage: 80,
                        partsKey: 'full',
                    },
                ],
                total: 5,
            });
        });

        it('should include testId in query if provided', async () => {
            const testId = new mongoose.Types.ObjectId().toString();
            mockLean.mockResolvedValue([]);
            mockCountDocuments.mockResolvedValue(0);

            await testResultService.getTestHistory(userId, 2, 5, testId);

            expect(mockFind).toHaveBeenCalledWith({
                userId,
                testId: new mongoose.Types.ObjectId(testId),
            });
            expect(mockSkip).toHaveBeenCalledWith(5);
            expect(mockLimit).toHaveBeenCalledWith(5);
        });

        it('should rethrow mapping or execution errors', async () => {
            mockLean.mockRejectedValue(new Error('Execution failed'));

            await expect(
                testResultService.getTestHistory(userId)
            ).rejects.toThrow('Failed to get test history: Execution failed');
        });

        it('should throw an error with fallback message if caught error is not an Error instance', async () => {
            mockLean.mockImplementation(() => {
                throw 'Some string error';
            });

            await expect(
                testResultService.getTestHistory(userId)
            ).rejects.toThrow('Failed to get test history: Unknown error');
        });
    });

    // ──────────────────────────────────────────────
    // getTestResultDetail
    // ──────────────────────────────────────────────
    describe('getTestResultDetail', () => {
        const userId = 'user-123';
        const resultId = new mongoose.Types.ObjectId().toString();

        it('should throw error if result is not found', async () => {
            mockFindOneLean.mockResolvedValue(null);

            await expect(
                testResultService.getTestResultDetail(userId, resultId)
            ).rejects.toThrow(
                'Failed to get test result detail: Test result not found'
            );
        });

        it('should map test result detail successfully with full metrics and maps', async () => {
            const mockDbResult = {
                _id: new mongoose.Types.ObjectId(resultId),
                testId: new mongoose.Types.ObjectId(),
                testTitle: 'TOEIC Exam',
                testType: 'listening-reading',
                duration: 120,
                completedAt: new Date('2026-06-12T12:00:00Z'),
                score: 75,
                totalQuestions: 100,
                userAnswers: [
                    {
                        questionNumber: 1,
                        selectedAnswer: 'A',
                        isCorrect: true,
                        correctAnswer: 'A',
                        timeToFirstAnswer: 500,
                        totalTimeSpent: 1000,
                        answerChanges: 1,
                    },
                ],
                parts: ['part1'],
                startedAt: new Date('2026-06-12T10:00:00Z'),
                analysis: {
                    timeAnalysis: {
                        partMetrics: [
                            {
                                partName: 'Part 1',
                                questionsCount: 6,
                                totalTime: 200,
                                averageTimePerQuestion: 33,
                                answerChangeRate: 0.1,
                                slowestQuestions: [1, 2],
                            },
                        ],
                        overallMetrics: {
                            totalActiveTime: 1000,
                            averageTimePerQuestion: 10,
                            totalAnswerChanges: 1,
                            confidenceScore: 90,
                            timeDistribution: new Map([['part1', 500]]), // Using Map format
                        },
                    },
                },
            };

            mockFindOneLean.mockResolvedValue(mockDbResult);

            const result = await testResultService.getTestResultDetail(
                userId,
                resultId
            );

            expect(mockFindOne).toHaveBeenCalledWith({ _id: resultId, userId });
            expect(result).toEqual({
                id: resultId,
                testId: mockDbResult.testId.toString(),
                testTitle: 'TOEIC Exam',
                testType: 'listening-reading',
                duration: 120,
                completedAt: '2026-06-12T12:00:00.000Z',
                score: 75,
                totalQuestions: 100,
                percentage: 75,
                userAnswers: [
                    {
                        questionNumber: 1,
                        selectedAnswer: 'A',
                        isCorrect: true,
                        correctAnswer: 'A',
                        timeToFirstAnswer: 500,
                        totalTimeSpent: 1000,
                        duration: 1000,
                        answerChanges: 1,
                    },
                ],
                parts: ['part1'],
                startedAt: '2026-06-12T10:00:00.000Z',
                partMetrics: [
                    {
                        partName: 'Part 1',
                        questionsCount: 6,
                        totalTime: 200,
                        averageTimePerQuestion: 33,
                        answerChangeRate: 0.1,
                        slowestQuestions: [1, 2],
                    },
                ],
                overallMetrics: {
                    totalActiveTime: 1000,
                    averageTimePerQuestion: 10,
                    totalAnswerChanges: 1,
                    confidenceScore: 90,
                    timeDistribution: { part1: 500 }, // Converted from Map
                },
            });
        });

        it('should handle overallMetrics where timeDistribution is not a Map', async () => {
            const mockDbResult = {
                _id: new mongoose.Types.ObjectId(resultId),
                testId: new mongoose.Types.ObjectId(),
                testTitle: 'TOEIC Exam',
                testType: 'listening-reading',
                duration: 120,
                completedAt: new Date('2026-06-12T12:00:00Z'),
                score: 75,
                totalQuestions: 100,
                userAnswers: [],
                parts: [],
                analysis: {
                    timeAnalysis: {
                        overallMetrics: {
                            totalActiveTime: 1000,
                            averageTimePerQuestion: 10,
                            totalAnswerChanges: 1,
                            confidenceScore: 90,
                            timeDistribution: { part2: 300 }, // object instead of map
                        },
                    },
                },
            };

            mockFindOneLean.mockResolvedValue(mockDbResult);

            const result = await testResultService.getTestResultDetail(
                userId,
                resultId
            );
            expect(result.overallMetrics?.timeDistribution).toEqual({
                part2: 300,
            });
        });

        it('should handle overallMetrics without timeDistribution', async () => {
            const mockDbResult = {
                _id: new mongoose.Types.ObjectId(resultId),
                testId: new mongoose.Types.ObjectId(),
                testTitle: 'TOEIC Exam',
                testType: 'listening-reading',
                duration: 120,
                completedAt: new Date('2026-06-12T12:00:00Z'),
                score: 75,
                totalQuestions: 100,
                userAnswers: [],
                parts: [],
                analysis: {
                    timeAnalysis: {
                        overallMetrics: {
                            totalActiveTime: 1000,
                            averageTimePerQuestion: 10,
                            totalAnswerChanges: 1,
                            confidenceScore: 90,
                            // timeDistribution is undefined
                        },
                    },
                },
            };

            mockFindOneLean.mockResolvedValue(mockDbResult);

            const result = await testResultService.getTestResultDetail(
                userId,
                resultId
            );
            expect(result.overallMetrics?.timeDistribution).toEqual({});
        });

        it('should handle cases when analysis or timeAnalysis is undefined', async () => {
            const mockDbResult = {
                _id: new mongoose.Types.ObjectId(resultId),
                testId: new mongoose.Types.ObjectId(),
                testTitle: 'TOEIC Exam',
                testType: 'listening-reading',
                duration: 120,
                completedAt: new Date('2026-06-12T12:00:00Z'),
                score: 75,
                totalQuestions: 100,
                userAnswers: [],
                parts: [],
                // analysis is undefined
            };

            mockFindOneLean.mockResolvedValue(mockDbResult);

            const result = await testResultService.getTestResultDetail(
                userId,
                resultId
            );
            expect(result.partMetrics).toBeUndefined();
            expect(result.overallMetrics).toBeUndefined();
        });

        it('should rethrow retrieval errors', async () => {
            mockFindOneLean.mockRejectedValue(new Error('Retrieval error'));

            await expect(
                testResultService.getTestResultDetail(userId, resultId)
            ).rejects.toThrow(
                'Failed to get test result detail: Retrieval error'
            );
        });

        it('should throw an error with fallback message if caught error is not an Error instance', async () => {
            mockFindOneLean.mockImplementation(() => {
                throw 'Some string error';
            });

            await expect(
                testResultService.getTestResultDetail(userId, resultId)
            ).rejects.toThrow(
                'Failed to get test result detail: Unknown error'
            );
        });
    });

    // ──────────────────────────────────────────────
    // getUserStats
    // ──────────────────────────────────────────────
    describe('getUserStats', () => {
        const userId = 'user-123';

        it('should return default zeroed statistics if user has no test results', async () => {
            mockLean.mockResolvedValue([]);

            const result = await testResultService.getUserStats(userId);

            expect(result).toEqual({
                listeningReadingTests: 0,
                averageScore: 0,
                highestScore: 0,
                recentTests: [],
            });
        });

        it('should compute average and highest scores and slice recent tests successfully', async () => {
            const mockResults = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    testTitle: 'Test A',
                    testType: 'listening-reading',
                    partsKey: 'full',
                    score: 80,
                    totalScore: 400,
                    totalQuestions: 100,
                    duration: 120,
                    completedAt: new Date('2026-06-10T10:00:00Z'),
                },
                {
                    _id: new mongoose.Types.ObjectId(),
                    testTitle: 'Test B',
                    testType: 'listening-reading',
                    partsKey: 'part1-part2',
                    score: 90,
                    totalScore: 450, // should count towards highestScore, but not averageScore because partsKey is not full
                    totalQuestions: 100,
                    duration: 120,
                    completedAt: new Date('2026-06-11T10:00:00Z'),
                },
            ];

            mockLean.mockResolvedValue(mockResults);

            const result = await testResultService.getUserStats(userId);

            expect(result.listeningReadingTests).toBe(2);
            expect(result.averageScore).toBe(400);
            expect(result.highestScore).toBe(450);
            expect(result.recentTests).toHaveLength(2);
            // Verify recent tests sorted descending by completedAt (Test B then Test A)
            expect(result.recentTests[0].testTitle).toBe('Test B');
        });

        it('should rethrow calculation errors', async () => {
            mockLean.mockRejectedValue(new Error('Calculation failed'));

            await expect(
                testResultService.getUserStats(userId)
            ).rejects.toThrow('Failed to get user stats: Calculation failed');
        });

        it('should return 0 for average and highest score if no full mode or L-R tests exist', async () => {
            const mockResults = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    testTitle: 'Test Writing Only',
                    testType: 'writing',
                    partsKey: 'part1',
                    score: 80,
                    totalQuestions: 100,
                    duration: 120,
                    completedAt: new Date('2026-06-10T10:00:00Z'),
                },
            ];

            mockLean.mockResolvedValue(mockResults);

            const result = await testResultService.getUserStats(userId);

            expect(result.listeningReadingTests).toBe(0);
            expect(result.averageScore).toBe(0);
            expect(result.highestScore).toBe(0);
            expect(result.recentTests).toHaveLength(1);
        });

        it('should throw an error with fallback message if caught error is not an Error instance', async () => {
            mockLean.mockImplementation(() => {
                throw 'Some string error';
            });

            await expect(
                testResultService.getUserStats(userId)
            ).rejects.toThrow('Failed to get user stats: Unknown error');
        });
    });

    // ──────────────────────────────────────────────
    // getListeningReadingResults
    // ──────────────────────────────────────────────
    describe('getListeningReadingResults', () => {
        const userId = 'user-123';

        it('should query and return listening reading results successfully', async () => {
            const mockResults = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    testTitle: 'L-R Test',
                    completedAt: new Date('2026-06-13T10:00:00Z'),
                    totalScore: 500,
                    listeningScore: 250,
                    readingScore: 250,
                    totalQuestions: 200,
                    duration: 120,
                    score: 100,
                    partsKey: 'full',
                },
            ];
            mockLean.mockResolvedValue(mockResults);

            const result =
                await testResultService.getListeningReadingResults(userId);

            expect(mockFind).toHaveBeenCalledWith({
                userId,
                testType: 'listening-reading',
            });
            expect(mockSort).toHaveBeenCalledWith({ completedAt: -1 });
            expect(result).toEqual([
                {
                    id: mockResults[0]._id.toString(),
                    testTitle: 'L-R Test',
                    completedAt: '2026-06-13T10:00:00.000Z',
                    totalScore: 500,
                    listeningScore: 250,
                    readingScore: 250,
                    totalQuestions: 200,
                    duration: 120,
                    percentage: 50,
                    partsKey: 'full',
                },
            ]);
        });

        it('should rethrow exceptions during listening reading retrieval', async () => {
            mockLean.mockRejectedValue(new Error('L-R retrieval failed'));

            await expect(
                testResultService.getListeningReadingResults(userId)
            ).rejects.toThrow(
                'Failed to get listening-reading results: L-R retrieval failed'
            );
        });

        it('should throw an error with fallback message if caught error is not an Error instance', async () => {
            mockLean.mockImplementation(() => {
                throw 'Some string error';
            });

            await expect(
                testResultService.getListeningReadingResults(userId)
            ).rejects.toThrow(
                'Failed to get listening-reading results: Unknown error'
            );
        });
    });

    // ──────────────────────────────────────────────
    // getFirstTestInfo
    // ──────────────────────────────────────────────
    describe('getFirstTestInfo', () => {
        const userId = 'user-123';

        it('should return hasTest false if no listening reading results exist', async () => {
            mockLean.mockResolvedValue([]);

            const result = await testResultService.getFirstTestInfo(userId);

            expect(result).toEqual({
                hasTest: false,
                firstTest: null,
                totalTests: 0,
            });
        });

        it('should return oldest test and identify if analyzed successfully', async () => {
            const mockResults = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    testTitle: 'Oldest Test',
                    completedAt: new Date('2026-06-01T10:00:00Z'),
                    totalScore: 300,
                    listeningScore: 150,
                    readingScore: 150,
                    analysis: {
                        examAnalysis: {
                            summary: 'Very good summary',
                            topWeaknesses: ['Vocabulary'],
                        },
                    },
                },
                {
                    _id: new mongoose.Types.ObjectId(),
                    testTitle: 'Newer Test',
                    completedAt: new Date('2026-06-05T10:00:00Z'),
                    totalScore: 350,
                    listeningScore: 180,
                    readingScore: 170,
                },
            ];

            mockLean.mockResolvedValue(mockResults);

            const result = await testResultService.getFirstTestInfo(userId);

            expect(mockFind).toHaveBeenCalledWith({
                userId,
                testType: 'listening-reading',
            });
            expect(mockSort).toHaveBeenCalledWith({ completedAt: 1 });
            expect(result).toEqual({
                hasTest: true,
                firstTest: {
                    id: mockResults[0]._id.toString(),
                    testTitle: 'Oldest Test',
                    completedAt: '2026-06-01T10:00:00.000Z',
                    totalScore: 300,
                    listeningScore: 150,
                    readingScore: 150,
                    isAnalyzed: true,
                },
                totalTests: 2,
            });
        });

        it('should identify isAnalyzed as false if analysis properties are missing', async () => {
            const mockResults = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    testTitle: 'Unanalyzed Test',
                    completedAt: new Date('2026-06-01T10:00:00Z'),
                    totalScore: 300,
                    listeningScore: 150,
                    readingScore: 150,
                    analysis: {},
                },
            ];

            mockLean.mockResolvedValue(mockResults);

            const result = await testResultService.getFirstTestInfo(userId);
            expect(result.firstTest?.isAnalyzed).toBe(false);
        });

        it('should rethrow errors during first test retrieval', async () => {
            mockLean.mockRejectedValue(new Error('Oldest retrieval failed'));

            await expect(
                testResultService.getFirstTestInfo(userId)
            ).rejects.toThrow(
                'Failed to get first test info: Oldest retrieval failed'
            );
        });

        it('should throw an error with fallback message if caught error is not an Error instance', async () => {
            mockLean.mockImplementation(() => {
                throw 'Some string error';
            });

            await expect(
                testResultService.getFirstTestInfo(userId)
            ).rejects.toThrow('Failed to get first test info: Unknown error');
        });
    });

    // ──────────────────────────────────────────────
    // getListeningReadingChartData
    // ──────────────────────────────────────────────
    describe('getListeningReadingChartData', () => {
        const userId = 'user-123';

        it('should return empty timeline if no tests are found', async () => {
            mockLean.mockResolvedValue([]);

            const result =
                await testResultService.getListeningReadingChartData(userId);
            expect(result).toEqual({ timeline: [] });
        });

        it('should format dates and scores to a timeline timeline array', async () => {
            const mockResults = [
                {
                    completedAt: new Date('2026-06-10T12:34:56Z'),
                    totalScore: 400,
                    listeningScore: 200,
                    readingScore: 200,
                    testTitle: 'TOEIC Chart 1',
                },
            ];
            mockLean.mockResolvedValue(mockResults);

            const result =
                await testResultService.getListeningReadingChartData(userId);

            expect(mockFind).toHaveBeenCalledWith({
                userId,
                testType: 'listening-reading',
            });
            expect(mockSort).toHaveBeenCalledWith({ completedAt: 1 });
            expect(result).toEqual({
                timeline: [
                    {
                        date: '2026-06-10',
                        totalScore: 400,
                        listeningScore: 200,
                        readingScore: 200,
                        testTitle: 'TOEIC Chart 1',
                    },
                ],
            });
        });
    });
});
