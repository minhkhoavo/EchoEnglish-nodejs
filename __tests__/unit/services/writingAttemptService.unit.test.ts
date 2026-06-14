/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { Types } from 'mongoose';
import { writingAttemptService } from '~/services/writingAttemptService.js';
import { toeicWritingScoringService } from '~/ai/service/toeicWritingScoringService.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

// Mock mongoose to keep Types/ObjectId actual implementation but allow connection state mocking
jest.mock('mongoose', () => {
    const actualMongoose = jest.requireActual('mongoose');
    return {
        ...actualMongoose,
        connection: {
            readyState: 1,
            db: null,
        },
    };
});

jest.mock('~/ai/service/toeicWritingScoringService.js', () => ({
    __esModule: true,
    toeicWritingScoringService: {
        scoreWriting: jest.fn(),
    },
}));

const mockedToeicWritingScoringService =
    toeicWritingScoringService as jest.Mocked<
        typeof toeicWritingScoringService
    >;

// ──────────────────────────────────────────────
// Fixtures & Helpers
// ──────────────────────────────────────────────
function buildMockTest(overrides: Record<string, any> = {}) {
    return {
        _id: new Types.ObjectId(),
        parts: [
            {
                partTitle: 'Part 1',
                partName: 'Describe a Picture',
                partDirection: 'Part 1 directions',
                questions: [
                    {
                        questionText: 'Write a sentence about this picture.',
                        image: 'https://example.com/image1.png',
                        keywords: 'keyword1, keyword2',
                        time_to_think: 10,
                        limit_time: 45,
                        sample_answer: 'Sample answer 1',
                    },
                ],
            },
            {
                partTitle: 'Part 2',
                partName: 'Respond to a Written Request',
                questions: [
                    {
                        questionText: 'Write an email response.',
                        time_to_think: 20,
                        limit_time: 120,
                        sample_answer: 'Sample answer 2',
                    },
                ],
            },
            {
                partTitle: 'Part 3',
                partName: 'Write an Opinion Essay',
                questions: [
                    {
                        questionText: 'Write an essay.',
                        time_to_think: 30,
                        limit_time: 180,
                        sample_answer: 'Sample answer 3',
                    },
                ],
            },
        ],
        ...overrides,
    };
}

function buildMockAttempt(overrides: Record<string, any> = {}) {
    return {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        toeicWritingTestId: new Types.ObjectId(),
        submissionTimestamp: new Date(),
        status: 'completed',
        totalScore: 0,
        parts: [
            {
                partIndex: 1,
                partTitle: 'Part 1',
                partDirection: 'Directions 1',
                questions: [
                    {
                        questionNumber: 1,
                        promptText: 'Write a sentence.',
                        promptImage: 'image1.png',
                        userAnswer: 'This is my sentence.',
                        questionMetadata: {
                            keywords: 'keyword1',
                            timeToThink: 10,
                            limitTime: 45,
                            sampleAnswer: 'Sample answer 1',
                        },
                        result: null,
                    },
                ],
            },
            {
                partIndex: 2,
                partTitle: 'Part 2',
                partDirection: 'Directions 2',
                questions: [
                    {
                        questionNumber: 2,
                        promptText: 'Write an email.',
                        promptImage: null,
                        userAnswer: 'This is my email.',
                        questionMetadata: {
                            timeToThink: 20,
                            limitTime: 120,
                            sampleAnswer: 'Sample answer 2',
                        },
                        result: null,
                    },
                ],
            },
            {
                partIndex: 3,
                partTitle: 'Part 3',
                partDirection: 'Directions 3',
                questions: [
                    {
                        questionNumber: 3,
                        promptText: 'Write an essay.',
                        promptImage: null,
                        userAnswer: 'This is my essay.',
                        questionMetadata: {
                            timeToThink: 30,
                            limitTime: 180,
                            sampleAnswer: 'Sample answer 3',
                        },
                        result: null,
                    },
                ],
            },
        ],
        createdAt: new Date(),
        ...overrides,
    };
}

describe('WritingAttemptService', () => {
    let mockDb: any;
    let mockCollection: any;

    beforeEach(() => {
        jest.clearAllMocks();

        mockCollection = {
            findOne: jest.fn(),
            insertOne: jest.fn(),
            updateOne: jest.fn(),
        };

        mockDb = {
            collection: jest.fn().mockReturnValue(mockCollection),
        };

        // Reset default active connection state
        (mongoose.connection as any).readyState = 1;
        (mongoose.connection as any).db = mockDb;
    });

    // ──────────────────────────────────────────────
    // getDb Connection Guard
    // ──────────────────────────────────────────────
    describe('getDb Connection Guard', () => {
        it('should throw ApiError INTERNAL_ERROR if readyState !== 1', async () => {
            (mongoose.connection as any).readyState = 0; // Disconnected

            await expect(
                writingAttemptService.submitAndScore({
                    userId: new Types.ObjectId().toString(),
                    toeicWritingTestId: new Types.ObjectId().toString(),
                    answers: {},
                })
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                writingAttemptService.submitAndScore({
                    userId: new Types.ObjectId().toString(),
                    toeicWritingTestId: new Types.ObjectId().toString(),
                    answers: {},
                })
            ).rejects.toMatchObject({
                status: ErrorMessage.INTERNAL_ERROR.status,
                message: ErrorMessage.INTERNAL_ERROR.message,
            });
        });
    });

    // ──────────────────────────────────────────────
    // submitAndScore Input Validation
    // ──────────────────────────────────────────────
    describe('submitAndScore Input Validation', () => {
        it('should throw ApiError INVALID_ID if toeicWritingTestId is invalid ObjectId format', async () => {
            await expect(
                writingAttemptService.submitAndScore({
                    userId: new Types.ObjectId().toString(),
                    toeicWritingTestId: 'invalid-id',
                    answers: {},
                })
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                writingAttemptService.submitAndScore({
                    userId: new Types.ObjectId().toString(),
                    toeicWritingTestId: 'invalid-id',
                    answers: {},
                })
            ).rejects.toMatchObject({
                status: ErrorMessage.INVALID_ID.status,
                message: ErrorMessage.INVALID_ID.message,
            });
        });

        it('should throw ApiError TEST_NOT_FOUND if the test does not exist', async () => {
            mockCollection.findOne.mockResolvedValue(null);
            const validId = new Types.ObjectId().toString();

            await expect(
                writingAttemptService.submitAndScore({
                    userId: new Types.ObjectId().toString(),
                    toeicWritingTestId: validId,
                    answers: {},
                })
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                writingAttemptService.submitAndScore({
                    userId: new Types.ObjectId().toString(),
                    toeicWritingTestId: validId,
                    answers: {},
                })
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
                message: ErrorMessage.TEST_NOT_FOUND.message,
            });
        });

        it('should throw ApiError INVALID_ID if userId is invalid ObjectId format', async () => {
            const mockTest = buildMockTest();
            mockCollection.findOne.mockResolvedValue(mockTest);

            await expect(
                writingAttemptService.submitAndScore({
                    userId: 'invalid-user-id',
                    toeicWritingTestId: mockTest._id.toString(),
                    answers: {},
                })
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                writingAttemptService.submitAndScore({
                    userId: 'invalid-user-id',
                    toeicWritingTestId: mockTest._id.toString(),
                    answers: {},
                })
            ).rejects.toMatchObject({
                status: ErrorMessage.INVALID_ID.status,
                message: ErrorMessage.INVALID_ID.message,
            });
        });
    });

    // ──────────────────────────────────────────────
    // submitAndScore Happy Path & Document Builder
    // ──────────────────────────────────────────────
    describe('submitAndScore Happy Path & Document Builder', () => {
        it('should map answers correctly and reject non-string answers', async () => {
            const mockTest = buildMockTest();
            mockCollection.findOne.mockResolvedValue(mockTest);
            mockCollection.insertOne.mockResolvedValue({
                insertedId: new Types.ObjectId(),
            });

            const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
            const scoreAllQuestionsSpy = jest
                .spyOn(writingAttemptService as any, 'scoreAllQuestions')
                .mockResolvedValue(undefined);

            const answers = {
                1: 'Sentence response',
                2: 12345 as any, // non-string -> should be rejected & set to null
                3: { object: 'essay' } as any, // non-string -> should be rejected & set to null
            };

            const result = await writingAttemptService.submitAndScore({
                userId: new Types.ObjectId().toString(),
                toeicWritingTestId: mockTest._id.toString(),
                answers,
            });

            expect(mockCollection.findOne).toHaveBeenCalledWith({
                _id: mockTest._id,
            });
            expect(mockCollection.insertOne).toHaveBeenCalled();

            const insertedDoc = mockCollection.insertOne.mock.calls[0][0];
            expect(insertedDoc.status).toBe('completed');
            expect(insertedDoc.totalScore).toBe(0);

            // Verify mapping answers
            expect(insertedDoc.parts[0].questions[0].userAnswer).toBe(
                'Sentence response'
            );
            expect(insertedDoc.parts[1].questions[0].userAnswer).toBeNull();
            expect(insertedDoc.parts[2].questions[0].userAnswer).toBeNull();

            // Verify console.warn was triggered twice for non-strings
            expect(warnSpy).toHaveBeenCalledTimes(2);
            expect(scoreAllQuestionsSpy).toHaveBeenCalledWith(result.resultId);

            warnSpy.mockRestore();
            scoreAllQuestionsSpy.mockRestore();
        });

        it('should fallback to default part directions when not specified in test parts', async () => {
            const mockTest = buildMockTest({
                parts: [
                    {
                        partTitle: 'Part 1',
                        questions: [{ questionText: 'Q1' }],
                    },
                    {
                        partTitle: 'Part 2',
                        questions: [{ questionText: 'Q2' }],
                    },
                    {
                        partTitle: 'Part 3',
                        questions: [{ questionText: 'Q3' }],
                    },
                    {
                        partTitle: 'Part 4',
                        questions: [{ questionText: 'Q4' }],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValue(mockTest);
            mockCollection.insertOne.mockResolvedValue({
                insertedId: new Types.ObjectId(),
            });

            const scoreAllQuestionsSpy = jest
                .spyOn(writingAttemptService as any, 'scoreAllQuestions')
                .mockResolvedValue(undefined);

            await writingAttemptService.submitAndScore({
                userId: new Types.ObjectId().toString(),
                toeicWritingTestId: mockTest._id.toString(),
                answers: {},
            });

            const insertedDoc = mockCollection.insertOne.mock.calls[0][0];
            expect(insertedDoc.parts[0].partDirection).toBe(
                'Questions 1-5: Write a sentence based on a picture.'
            );
            expect(insertedDoc.parts[1].partDirection).toBe(
                'Questions 6-7: Respond to a written request.'
            );
            expect(insertedDoc.parts[2].partDirection).toBe(
                'Question 8: Write an opinion essay.'
            );
            expect(insertedDoc.parts[3].partDirection).toBe('Part 4');

            scoreAllQuestionsSpy.mockRestore();
        });

        it('should handle background scoring failure gracefully by catching it', async () => {
            const mockTest = buildMockTest();
            mockCollection.findOne.mockResolvedValue(mockTest);
            const mockResultId = new Types.ObjectId();
            mockCollection.insertOne.mockResolvedValue({
                insertedId: mockResultId,
            });

            const scoreAllQuestionsSpy = jest
                .spyOn(writingAttemptService as any, 'scoreAllQuestions')
                .mockRejectedValue(new Error('Scoring failure'));

            const errorSpy = jest.spyOn(console, 'error').mockImplementation();

            const result = await writingAttemptService.submitAndScore({
                userId: new Types.ObjectId().toString(),
                toeicWritingTestId: mockTest._id.toString(),
                answers: {},
            });

            expect(result.resultId).toBe(mockResultId.toString());
            // Need to wait slightly for background microtask queue
            await new Promise((resolve) => setImmediate(resolve));

            expect(errorSpy).toHaveBeenCalledWith(
                '[WritingAttempt] Background scoring failed:',
                expect.any(Error)
            );

            scoreAllQuestionsSpy.mockRestore();
            errorSpy.mockRestore();
        });

        it('should handle test with undefined parts and parts with undefined questions gracefully', async () => {
            const mockTestWithUndefinedParts = buildMockTest({
                parts: undefined,
            });
            mockCollection.findOne.mockResolvedValueOnce(
                mockTestWithUndefinedParts
            );
            mockCollection.insertOne.mockResolvedValue({
                insertedId: new Types.ObjectId(),
            });

            await writingAttemptService.submitAndScore({
                userId: new Types.ObjectId().toString(),
                toeicWritingTestId: mockTestWithUndefinedParts._id.toString(),
                answers: {},
            });

            const insertedDoc = mockCollection.insertOne.mock.calls[0][0];
            expect(insertedDoc.parts).toEqual([]);
        });

        it('should handle test part with undefined questions gracefully', async () => {
            const mockTestWithUndefinedQuestions = buildMockTest({
                parts: [
                    {
                        partTitle: 'Part 1',
                        questions: undefined,
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValueOnce(
                mockTestWithUndefinedQuestions
            );
            mockCollection.insertOne.mockResolvedValue({
                insertedId: new Types.ObjectId(),
            });

            await writingAttemptService.submitAndScore({
                userId: new Types.ObjectId().toString(),
                toeicWritingTestId:
                    mockTestWithUndefinedQuestions._id.toString(),
                answers: {},
            });

            const insertedDoc = mockCollection.insertOne.mock.calls[0][0];
            expect(insertedDoc.parts[0].questions).toEqual([]);
        });

        it('should fallback promptText to clean_title or empty string when questionText is missing', async () => {
            const mockTest = buildMockTest({
                parts: [
                    {
                        partTitle: 'Part 1',
                        questions: [
                            {
                                clean_title: 'Clean Title 1',
                                image: 'https://example.com/image1.png',
                            },
                            {
                                image: 'https://example.com/image2.png',
                            },
                        ],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValueOnce(mockTest);
            mockCollection.insertOne.mockResolvedValue({
                insertedId: new Types.ObjectId(),
            });

            await writingAttemptService.submitAndScore({
                userId: new Types.ObjectId().toString(),
                toeicWritingTestId: mockTest._id.toString(),
                answers: {},
            });

            const insertedDoc = mockCollection.insertOne.mock.calls[0][0];
            expect(insertedDoc.parts[0].questions[0].promptText).toBe(
                'Clean Title 1'
            );
            expect(insertedDoc.parts[0].questions[1].promptText).toBe('');
        });

        it('should fallback partTitle to partName or Part index when partTitle is missing', async () => {
            const mockTest = buildMockTest({
                parts: [
                    {
                        partName: 'Part Name 1',
                        questions: [],
                    },
                    {
                        questions: [],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValueOnce(mockTest);
            mockCollection.insertOne.mockResolvedValue({
                insertedId: new Types.ObjectId(),
            });

            await writingAttemptService.submitAndScore({
                userId: new Types.ObjectId().toString(),
                toeicWritingTestId: mockTest._id.toString(),
                answers: {},
            });

            const insertedDoc = mockCollection.insertOne.mock.calls[0][0];
            expect(insertedDoc.parts[0].partTitle).toBe('Part Name 1');
            expect(insertedDoc.parts[1].partTitle).toBe('Part 2');
        });
    });

    // ──────────────────────────────────────────────
    // scoreAllQuestions Background Scoring Method
    // ──────────────────────────────────────────────
    describe('scoreAllQuestions Background Scoring', () => {
        it('should return early if the attempt does not exist in DB', async () => {
            mockCollection.findOne.mockResolvedValue(null);

            await (writingAttemptService as any).scoreAllQuestions(
                new Types.ObjectId().toString()
            );

            expect(mockCollection.updateOne).not.toHaveBeenCalled();
            expect(
                mockedToeicWritingScoringService.scoreWriting
            ).not.toHaveBeenCalled();
        });

        it('should score only questions that have userAnswer strings in parallel', async () => {
            const mockAttempt = buildMockAttempt({
                parts: [
                    {
                        partIndex: 1,
                        questions: [
                            {
                                questionNumber: 1,
                                promptText: 'Q1',
                                promptImage: 'img1.png',
                                userAnswer: 'Answer 1',
                                questionMetadata: { keywords: 'kw1' },
                                result: null,
                            },
                        ],
                    },
                    {
                        partIndex: 2,
                        questions: [
                            {
                                questionNumber: 2,
                                promptText: 'Q2',
                                promptImage: null,
                                userAnswer: null, // No answer, should be skipped
                                questionMetadata: {},
                                result: null,
                            },
                        ],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValue(mockAttempt);

            mockedToeicWritingScoringService.scoreWriting.mockResolvedValue({
                overall_assessment: { overallScore: 3 },
                upgraded_text: 'Upgraded response',
            });

            await (writingAttemptService as any).scoreAllQuestions(
                mockAttempt._id.toString()
            );

            expect(
                mockedToeicWritingScoringService.scoreWriting
            ).toHaveBeenCalledTimes(1);
            expect(
                mockedToeicWritingScoringService.scoreWriting
            ).toHaveBeenCalledWith({
                partType: 1,
                questionPrompt: 'Q1',
                imageUrl: 'img1.png',
                keywords: 'kw1',
                directions: undefined,
                suggestions: undefined,
                userAnswer: 'Answer 1',
            });
        });

        it('should convert \\n and newlines to <br> in upgraded_text and save AI success result to DB', async () => {
            const mockAttempt = buildMockAttempt({
                parts: [
                    {
                        partIndex: 1,
                        questions: [
                            {
                                questionNumber: 1,
                                promptText: 'Q1',
                                userAnswer: 'Ans 1',
                                questionMetadata: {},
                                result: null,
                            },
                        ],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValue(mockAttempt);

            mockedToeicWritingScoringService.scoreWriting.mockResolvedValue({
                overall_assessment: { overallScore: 3 },
                upgraded_text: 'Line 1\\nLine 2\nLine 3',
            });

            await (writingAttemptService as any).scoreAllQuestions(
                mockAttempt._id.toString()
            );

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                {
                    _id: mockAttempt._id,
                    'parts.questions.questionNumber': 1,
                },
                {
                    $set: {
                        'parts.$[part].questions.$[question].result': {
                            provider: 'toeicWritingScoringService',
                            scoredAt: expect.any(Date),
                            overall_assessment: { overallScore: 3 },
                            upgraded_text: 'Line 1<br>Line 2<br>Line 3',
                        },
                    },
                },
                {
                    arrayFilters: [
                        { 'part.questions.questionNumber': 1 },
                        { 'question.questionNumber': 1 },
                    ],
                }
            );
        });

        it('should handle AI scoring failure/exceptions by saving error result to DB and marking status partially_scored/scoring_failed', async () => {
            const mockAttempt = buildMockAttempt({
                parts: [
                    {
                        partIndex: 1,
                        questions: [
                            {
                                questionNumber: 1,
                                promptText: 'Q1',
                                userAnswer: 'Ans 1',
                                questionMetadata: {},
                                result: null,
                            },
                            {
                                questionNumber: 2,
                                promptText: 'Q2',
                                userAnswer: 'Ans 2',
                                questionMetadata: {},
                                result: null,
                            },
                        ],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValue(mockAttempt);

            // Mock first question to succeed, second question to throw error
            mockedToeicWritingScoringService.scoreWriting
                .mockResolvedValueOnce({
                    overall_assessment: { overallScore: 3 },
                    upgraded_text: 'Upgraded 1',
                })
                .mockRejectedValueOnce(new Error('AI Service Down'));

            const errorSpy = jest.spyOn(console, 'error').mockImplementation();

            await (writingAttemptService as any).scoreAllQuestions(
                mockAttempt._id.toString()
            );

            // Verification of successful question update
            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                {
                    _id: mockAttempt._id,
                    'parts.questions.questionNumber': 1,
                },
                expect.any(Object),
                expect.any(Object)
            );

            // Verification of error question update
            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                {
                    _id: mockAttempt._id,
                    'parts.questions.questionNumber': 2,
                },
                {
                    $set: {
                        'parts.$[part].questions.$[question].result': {
                            provider: 'toeicWritingScoringService',
                            scoredAt: expect.any(Date),
                            error: 'AI Service Down',
                            errorStack: expect.any(String),
                        },
                    },
                },
                {
                    arrayFilters: [
                        { 'part.questions.questionNumber': 2 },
                        { 'question.questionNumber': 2 },
                    ],
                }
            );

            // Check final scoring outcome (1 scored, 1 failed -> status: partially_scored)
            // Score = 3 / 28 * 200 = 21.4 -> bounded to 21 -> rounded to nearest 5 -> 20
            expect(mockCollection.updateOne).toHaveBeenLastCalledWith(
                { _id: mockAttempt._id },
                {
                    $set: {
                        totalScore: 20,
                        status: 'partially_scored',
                        updatedAt: expect.any(Date),
                    },
                }
            );

            errorSpy.mockRestore();
        });

        it('should handle promise rejections by saving error results and marking status scoring_failed', async () => {
            const mockAttempt = buildMockAttempt({
                parts: [
                    {
                        partIndex: 1,
                        questions: [
                            {
                                questionNumber: 1,
                                promptText: 'Q1',
                                userAnswer: 'Ans 1',
                                questionMetadata: {},
                                result: null,
                            },
                        ],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValue(mockAttempt);

            // Mock scoreWriting to throw/reject
            mockedToeicWritingScoringService.scoreWriting.mockRejectedValue(
                new Error('Severe Network Failure')
            );
            const errorSpy = jest.spyOn(console, 'error').mockImplementation();

            await (writingAttemptService as any).scoreAllQuestions(
                mockAttempt._id.toString()
            );

            // Status is scoring_failed because 0 out of 1 scored successfully
            expect(mockCollection.updateOne).toHaveBeenLastCalledWith(
                { _id: mockAttempt._id },
                {
                    $set: {
                        totalScore: 0,
                        status: 'scoring_failed',
                        updatedAt: expect.any(Date),
                    },
                }
            );

            errorSpy.mockRestore();
        });

        it('should compute final score correctly and bound/round appropriately when all questions score successfully', async () => {
            const mockAttempt = buildMockAttempt({
                parts: [
                    {
                        partIndex: 1,
                        questions: [
                            {
                                questionNumber: 1,
                                promptText: 'Q1',
                                userAnswer: 'Ans 1',
                                questionMetadata: {},
                                result: null,
                            },
                            {
                                questionNumber: 2,
                                promptText: 'Q2',
                                userAnswer: 'Ans 2',
                                questionMetadata: {},
                                result: null,
                            },
                            {
                                questionNumber: 3,
                                promptText: 'Q3',
                                userAnswer: 'Ans 3',
                                questionMetadata: {},
                                result: null,
                            },
                        ],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValue(mockAttempt);

            // Cumulative score: Q1 (3), Q2 (4), Q3 (5) = 12 points
            // Final Score = 12 / 28 * 200 = 85.7 -> Math.round -> 86
            // Nearest 5 = 85
            mockedToeicWritingScoringService.scoreWriting
                .mockResolvedValueOnce({
                    overall_assessment: { overallScore: 3 },
                })
                .mockResolvedValueOnce({
                    overall_assessment: { overallScore: 4 },
                })
                .mockResolvedValueOnce({
                    overall_assessment: { overallScore: 5 },
                });

            await (writingAttemptService as any).scoreAllQuestions(
                mockAttempt._id.toString()
            );

            expect(mockCollection.updateOne).toHaveBeenLastCalledWith(
                { _id: mockAttempt._id },
                {
                    $set: {
                        totalScore: 85,
                        status: 'scored',
                        updatedAt: expect.any(Date),
                    },
                }
            );
        });

        it('should bound score between 0 and 200', async () => {
            const mockAttempt = buildMockAttempt({
                parts: [
                    {
                        partIndex: 1,
                        questions: [
                            {
                                questionNumber: 1,
                                promptText: 'Q1',
                                userAnswer: 'Ans 1',
                                questionMetadata: {},
                                result: null,
                            },
                        ],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValue(mockAttempt);

            // Extremely high score: 100 points
            // Score = 100 / 28 * 200 = 714 -> bounded to 200
            // Nearest 5 = 200
            mockedToeicWritingScoringService.scoreWriting.mockResolvedValue({
                overall_assessment: { overallScore: 100 },
            });

            await (writingAttemptService as any).scoreAllQuestions(
                mockAttempt._id.toString()
            );

            expect(mockCollection.updateOne).toHaveBeenLastCalledWith(
                { _id: mockAttempt._id },
                {
                    $set: {
                        totalScore: 200,
                        status: 'scored',
                        updatedAt: expect.any(Date),
                    },
                }
            );
        });

        it('should handle rejected promise status from Promise.allSettled', async () => {
            const mockAttempt = buildMockAttempt({
                parts: [
                    {
                        partIndex: 1,
                        questions: [
                            {
                                questionNumber: 1,
                                promptText: 'Q1',
                                userAnswer: 'Ans 1',
                                questionMetadata: {},
                                result: null,
                            },
                        ],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValue(mockAttempt);

            // Temporarily mock Promise.allSettled
            const originalAllSettled = Promise.allSettled;
            Promise.allSettled = jest.fn().mockResolvedValue([
                {
                    status: 'rejected',
                    reason: new Error('Simulated promise rejection'),
                },
            ]);

            const errorSpy = jest.spyOn(console, 'error').mockImplementation();

            await (writingAttemptService as any).scoreAllQuestions(
                mockAttempt._id.toString()
            );

            expect(errorSpy).toHaveBeenCalledWith(
                `[WritingAttempt] Promise rejected for question:`,
                expect.any(Error)
            );

            // Restore original Promise.allSettled
            Promise.allSettled = originalAllSettled;
            errorSpy.mockRestore();
        });

        it('should handle non-Error caught exceptions during AI scoring by mapping error as string and empty errorStack', async () => {
            const mockAttempt = buildMockAttempt({
                parts: [
                    {
                        partIndex: 1,
                        questions: [
                            {
                                questionNumber: 1,
                                promptText: 'Q1',
                                userAnswer: 'Ans 1',
                                questionMetadata: {},
                                result: null,
                            },
                        ],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValue(mockAttempt);

            mockedToeicWritingScoringService.scoreWriting.mockRejectedValue(
                'Severe custom string rejection reason'
            );
            const errorSpy = jest.spyOn(console, 'error').mockImplementation();

            await (writingAttemptService as any).scoreAllQuestions(
                mockAttempt._id.toString()
            );

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                {
                    _id: mockAttempt._id,
                    'parts.questions.questionNumber': 1,
                },
                {
                    $set: {
                        'parts.$[part].questions.$[question].result': {
                            provider: 'toeicWritingScoringService',
                            scoredAt: expect.any(Date),
                            error: 'Severe custom string rejection reason',
                            errorStack: undefined,
                        },
                    },
                },
                expect.any(Object)
            );

            errorSpy.mockRestore();
        });

        it('should handle overallScore that is not a number or undefined', async () => {
            const mockAttempt = buildMockAttempt({
                parts: [
                    {
                        partIndex: 1,
                        questions: [
                            {
                                questionNumber: 1,
                                promptText: 'Q1',
                                userAnswer: 'Ans 1',
                                questionMetadata: {},
                                result: null,
                            },
                        ],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValue(mockAttempt);

            mockedToeicWritingScoringService.scoreWriting.mockResolvedValue({
                overall_assessment: { overallScore: 'not-a-number' as any },
            });

            await (writingAttemptService as any).scoreAllQuestions(
                mockAttempt._id.toString()
            );

            expect(mockCollection.updateOne).toHaveBeenLastCalledWith(
                { _id: mockAttempt._id },
                {
                    $set: {
                        totalScore: 0,
                        status: 'scored',
                        updatedAt: expect.any(Date),
                    },
                }
            );
        });

        it('should handle fulfilled scoring task where success is true but aiResult is falsy', async () => {
            const mockAttempt = buildMockAttempt({
                parts: [
                    {
                        partIndex: 1,
                        questions: [
                            {
                                questionNumber: 1,
                                promptText: 'Q1',
                                userAnswer: 'Ans 1',
                                questionMetadata: {},
                                result: null,
                            },
                        ],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValue(mockAttempt);

            const originalAllSettled = Promise.allSettled;
            Promise.allSettled = jest.fn().mockResolvedValue([
                {
                    status: 'fulfilled',
                    value: {
                        question: mockAttempt.parts[0].questions[0],
                        aiResult: null,
                        success: true,
                    },
                },
            ]);

            await (writingAttemptService as any).scoreAllQuestions(
                mockAttempt._id.toString()
            );

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                {
                    _id: mockAttempt._id,
                    'parts.questions.questionNumber': 1,
                },
                {
                    $set: {
                        'parts.$[part].questions.$[question].result': {
                            provider: 'toeicWritingScoringService',
                            scoredAt: expect.any(Date),
                            error: 'Unknown scoring error',
                            errorStack: undefined,
                        },
                    },
                },
                expect.any(Object)
            );

            Promise.allSettled = originalAllSettled;
        });

        it('should fallback to aiResult error fields if success is false and error/errorStack are falsy', async () => {
            const mockAttempt = buildMockAttempt({
                parts: [
                    {
                        partIndex: 1,
                        questions: [
                            {
                                questionNumber: 1,
                                promptText: 'Q1',
                                userAnswer: 'Ans 1',
                                questionMetadata: {},
                                result: null,
                            },
                        ],
                    },
                ],
            });
            mockCollection.findOne.mockResolvedValue(mockAttempt);

            const originalAllSettled = Promise.allSettled;
            Promise.allSettled = jest.fn().mockResolvedValue([
                {
                    status: 'fulfilled',
                    value: {
                        question: mockAttempt.parts[0].questions[0],
                        aiResult: {
                            error: 'Mocked AI Error Object',
                            errorStack: 'Mocked AI Stack',
                        },
                        success: false,
                        error: undefined,
                        errorStack: undefined,
                    },
                },
            ]);

            await (writingAttemptService as any).scoreAllQuestions(
                mockAttempt._id.toString()
            );

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                {
                    _id: mockAttempt._id,
                    'parts.questions.questionNumber': 1,
                },
                {
                    $set: {
                        'parts.$[part].questions.$[question].result': {
                            provider: 'toeicWritingScoringService',
                            scoredAt: expect.any(Date),
                            error: 'Mocked AI Error Object',
                            errorStack: 'Mocked AI Stack',
                        },
                    },
                },
                expect.any(Object)
            );

            Promise.allSettled = originalAllSettled;
        });
    });
});
