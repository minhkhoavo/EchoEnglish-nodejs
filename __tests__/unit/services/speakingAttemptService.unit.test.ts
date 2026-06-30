/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { Types } from 'mongoose';
import SpeakingAttemptService from '~/services/speakingAttemptService.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { createRecordingAndStartAnalysisHelper } from '~/controllers/speechController.js';

// ──────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────
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

jest.mock('~/controllers/speechController.js', () => ({
    __esModule: true,
    createRecordingAndStartAnalysisHelper: jest.fn(),
}));

jest.mock('~/ai/service/toeicSpeakingScoringService.js', () => ({
    __esModule: true,
    aiScoringService: {
        scoreRecording: jest.fn(),
    },
}));

const mockedCreateHelper = createRecordingAndStartAnalysisHelper as jest.Mock;

// ──────────────────────────────────────────────
// Fixtures & Helpers
// ──────────────────────────────────────────────
function buildMockTest(overrides: Record<string, any> = {}) {
    return {
        _id: new Types.ObjectId(),
        parts: [
            {
                title: 'Part 1: Read Aloud',
                direction: 'Read the passage aloud.',
                questions: [
                    {
                        questionText: 'Read this passage.',
                        title: 'Read Aloud Q1',
                    },
                ],
            },
            {
                name: 'Part 2',
                instruction: 'Describe the picture.',
                narrator: { text: 'You will see a picture.' },
                questions: [
                    {
                        questionText: 'Describe this picture.',
                        image: 'img.png',
                    },
                ],
            },
        ],
        ...overrides,
    };
}

function buildMockAttempt(overrides: Record<string, any> = {}) {
    const userId = new Types.ObjectId();
    return {
        _id: new Types.ObjectId(),
        userId,
        toeicSpeakingTestId: new Types.ObjectId(),
        submissionTimestamp: new Date(),
        status: 'in_progress',
        totalScore: 0,
        level: 'Beginner',
        parts: [
            {
                partIndex: 1,
                partTitle: 'Part 1',
                partDirection: 'Read aloud.',
                questions: [
                    {
                        questionNumber: 1,
                        questionText: 'Read this.',
                        s3AudioUrl: null,
                        recordingId: null,
                        result: null,
                    },
                ],
            },
        ],
        examMode: 'full',
        createdAt: new Date(),
        ...overrides,
    };
}

describe('SpeakingAttemptService', () => {
    let service: SpeakingAttemptService;
    let mockDb: any;
    let mockCollection: any;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();

        service = new SpeakingAttemptService();

        mockCollection = {
            findOne: jest.fn(),
            insertOne: jest.fn(),
            updateOne: jest.fn(),
            find: jest.fn(),
        };

        // Default find() chain

        const mockSort = jest
            .fn()
            .mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
        mockCollection.find.mockReturnValue({ sort: mockSort });

        mockDb = {
            collection: jest.fn().mockReturnValue(mockCollection),
        };

        (mongoose.connection as any).readyState = 1;
        (mongoose.connection as any).db = mockDb;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ════════════════════════════════════════════
    // getDb Connection Guard
    // ════════════════════════════════════════════
    describe('getDb Connection Guard', () => {
        it('should throw ApiError INTERNAL_ERROR if readyState !== 1', async () => {
            (mongoose.connection as any).readyState = 0;

            await expect(
                service.getCurrentAttempt({
                    userId: new Types.ObjectId().toString(),
                    toeicSpeakingTestId: new Types.ObjectId().toString(),
                    examMode: 'full',
                })
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                service.getCurrentAttempt({
                    userId: new Types.ObjectId().toString(),
                    toeicSpeakingTestId: new Types.ObjectId().toString(),
                    examMode: 'full',
                })
            ).rejects.toMatchObject({
                status: ErrorMessage.INTERNAL_ERROR.status,
                message: ErrorMessage.INTERNAL_ERROR.message,
            });
        });
    });

    // ════════════════════════════════════════════
    // getCurrentAttempt()
    // ════════════════════════════════════════════
    describe('getCurrentAttempt', () => {
        it('should return null if toeicSpeakingTestId is not a string', async () => {
            const result = await service.getCurrentAttempt({
                userId: new Types.ObjectId().toString(),
                toeicSpeakingTestId: 12345 as any,
                examMode: 'full',
            });

            expect(result).toBeNull();
        });

        it('should return null if toeicSpeakingTestId is not a valid ObjectId', async () => {
            const result = await service.getCurrentAttempt({
                userId: new Types.ObjectId().toString(),
                toeicSpeakingTestId: 'invalid-id',
                examMode: 'full',
            });

            expect(result).toBeNull();
        });

        it('should query DB for in_progress attempt and return it', async () => {
            const mockAttempt = buildMockAttempt();
            mockCollection.findOne.mockResolvedValue(mockAttempt);

            const userId = new Types.ObjectId().toString();
            const testId = new Types.ObjectId().toString();
            const result = await service.getCurrentAttempt({
                userId,
                toeicSpeakingTestId: testId,
                examMode: 'full',
            });

            expect(mockDb.collection).toHaveBeenCalledWith(
                'toeic_speaking_results'
            );
            expect(mockCollection.findOne).toHaveBeenCalledWith({
                userId: expect.any(Types.ObjectId),
                toeicSpeakingTestId: expect.any(Types.ObjectId),
                status: 'in_progress',
            });
            expect(result).toEqual(mockAttempt);
        });
    });

    // ════════════════════════════════════════════
    // startAttempt()
    // ════════════════════════════════════════════
    describe('startAttempt', () => {
        it('should throw ApiError INVALID_ID if toeicSpeakingTestId is not a string', async () => {
            await expect(
                service.startAttempt({
                    userId: new Types.ObjectId().toString(),
                    toeicSpeakingTestId: 12345 as any,
                    examMode: 'full',
                })
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                service.startAttempt({
                    userId: new Types.ObjectId().toString(),
                    toeicSpeakingTestId: 12345 as any,
                    examMode: 'full',
                })
            ).rejects.toMatchObject({
                status: ErrorMessage.INVALID_ID.status,
            });
        });

        it('should throw ApiError INVALID_ID if toeicSpeakingTestId is invalid ObjectId', async () => {
            await expect(
                service.startAttempt({
                    userId: new Types.ObjectId().toString(),
                    toeicSpeakingTestId: 'bad-id',
                    examMode: 'full',
                })
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should return existing attempt if one is already in_progress', async () => {
            const existingAttempt = buildMockAttempt();
            mockCollection.findOne.mockResolvedValue(existingAttempt);

            const result = await service.startAttempt({
                userId: existingAttempt.userId.toString(),
                toeicSpeakingTestId:
                    existingAttempt.toeicSpeakingTestId.toString(),
                examMode: 'full',
            });

            expect(result).toBeDefined();
            expect(result?.testAttemptId).toBe(existingAttempt._id.toString());
        });

        it('should throw ApiError TEST_NOT_FOUND if test does not exist', async () => {
            // First findOne for getCurrentAttempt → null
            // Second findOne for test lookup → null
            mockCollection.findOne
                .mockResolvedValueOnce(null) // getCurrentAttempt
                .mockResolvedValueOnce(null); // sw_tests findOne

            const validTestId = new Types.ObjectId().toString();

            await expect(
                service.startAttempt({
                    userId: new Types.ObjectId().toString(),
                    toeicSpeakingTestId: validTestId,
                    examMode: 'full',
                })
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                service.startAttempt({
                    userId: new Types.ObjectId().toString(),
                    toeicSpeakingTestId: validTestId,
                    examMode: 'full',
                })
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
            });
        });

        it('should create a new attempt with correctly mapped parts and questions', async () => {
            const testId = new Types.ObjectId();
            const mockTest = buildMockTest({ _id: testId });
            const insertedId = new Types.ObjectId();

            mockCollection.findOne
                .mockResolvedValueOnce(null) // getCurrentAttempt check
                .mockResolvedValueOnce(mockTest) // sw_tests findOne
                .mockResolvedValueOnce({
                    // fetch newly created attempt
                    _id: insertedId,
                    userId: new Types.ObjectId(),
                    toeicSpeakingTestId: testId,
                    status: 'in_progress',
                    totalScore: 0,
                    level: 'Beginner',
                    examMode: 'full',
                    submissionTimestamp: new Date(),
                    createdAt: new Date(),
                    parts: [
                        {
                            partIndex: 1,
                            partTitle: 'Part 1: Read Aloud',
                            partDirection: 'Read the passage aloud.',
                            questions: [
                                {
                                    questionNumber: 1,
                                    questionText: 'Read this passage.',
                                    s3AudioUrl: null,
                                    recordingId: null,
                                    result: null,
                                },
                            ],
                        },
                        {
                            partIndex: 2,
                            partTitle: 'Part 2',
                            partDirection: 'Describe the picture.',
                            partScenario: 'You will see a picture.',
                            questions: [
                                {
                                    questionNumber: 2,
                                    questionText: 'Describe this picture.',
                                    promptImage: 'img.png',
                                    s3AudioUrl: null,
                                    recordingId: null,
                                    result: null,
                                },
                            ],
                        },
                    ],
                });
            mockCollection.insertOne.mockResolvedValue({ insertedId });

            const result = await service.startAttempt({
                userId: new Types.ObjectId().toString(),
                toeicSpeakingTestId: testId.toString(),
                examMode: 'full',
            });

            expect(mockCollection.insertOne).toHaveBeenCalled();
            expect(result).toBeDefined();
            expect(result?.testAttemptId).toBe(insertedId.toString());
            expect(result?.status).toBe('in_progress');
            expect(result?.parts).toHaveLength(2);
        });

        it('should handle test with undefined parts gracefully', async () => {
            const testId = new Types.ObjectId();
            const mockTest = buildMockTest({ _id: testId, parts: undefined });
            const insertedId = new Types.ObjectId();

            mockCollection.findOne
                .mockResolvedValueOnce(null) // getCurrentAttempt
                .mockResolvedValueOnce(mockTest) // sw_tests findOne
                .mockResolvedValueOnce({
                    // newly created attempt
                    _id: insertedId,
                    userId: new Types.ObjectId(),
                    toeicSpeakingTestId: testId,
                    status: 'in_progress',
                    totalScore: 0,
                    level: 'Beginner',
                    examMode: 'full',
                    submissionTimestamp: new Date(),
                    createdAt: new Date(),
                    parts: [],
                });
            mockCollection.insertOne.mockResolvedValue({ insertedId });

            const result = await service.startAttempt({
                userId: new Types.ObjectId().toString(),
                toeicSpeakingTestId: testId.toString(),
                examMode: 'full',
            });

            expect(result?.parts).toEqual([]);
        });

        it('should use partName fallback and offset fallback for part title', async () => {
            const testId = new Types.ObjectId();
            const mockTest = buildMockTest({
                _id: testId,
                parts: [
                    { partName: 'Custom Part Name', questions: [] },
                    { offset: 3, questions: [] },
                    { questions: [] }, // No title/name/partName/offset
                ],
            });
            const insertedId = new Types.ObjectId();

            mockCollection.findOne
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(mockTest)
                .mockResolvedValueOnce(null); // fetch newly created → null (mapAttemptToResponse handles it)
            mockCollection.insertOne.mockResolvedValue({ insertedId });

            const result = await service.startAttempt({
                userId: new Types.ObjectId().toString(),
                toeicSpeakingTestId: testId.toString(),
                examMode: 'full',
            });

            // When newAttempt is null, mapAttemptToResponse returns null
            expect(result).toBeNull();

            // Verify the inserted document had correct part titles
            const insertedDoc = mockCollection.insertOne.mock.calls[0][0];
            expect(insertedDoc.parts[0].partTitle).toBe('Custom Part Name');
            expect(insertedDoc.parts[1].partTitle).toBe('Part 3');
            expect(insertedDoc.parts[2].partTitle).toBe('Part');
        });
    });

    // ════════════════════════════════════════════
    // submitQuestion()
    // ════════════════════════════════════════════
    describe('submitQuestion', () => {
        const mockFile = {
            buffer: Buffer.from('audio-data'),
            originalname: 'recording.webm',
            mimetype: 'audio/webm',
            size: 1024,
        };

        it('should throw ApiError NOTFOUND if attempt does not exist', async () => {
            mockCollection.findOne.mockResolvedValue(null);

            await expect(
                service.submitQuestion({
                    attemptId: new Types.ObjectId().toString(),
                    userId: new Types.ObjectId().toString(),
                    file: mockFile,
                    questionNumber: 1,
                })
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                service.submitQuestion({
                    attemptId: new Types.ObjectId().toString(),
                    userId: new Types.ObjectId().toString(),
                    file: mockFile,
                    questionNumber: 1,
                })
            ).rejects.toMatchObject({
                status: ErrorMessage.NOTFOUND.status,
            });
        });

        it('should throw ApiError PERMISSION_DENIED if userId does not match', async () => {
            const attempt = buildMockAttempt();
            mockCollection.findOne.mockResolvedValue(attempt);

            await expect(
                service.submitQuestion({
                    attemptId: attempt._id.toString(),
                    userId: new Types.ObjectId().toString(), // different userId
                    file: mockFile,
                    questionNumber: 1,
                })
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                service.submitQuestion({
                    attemptId: attempt._id.toString(),
                    userId: new Types.ObjectId().toString(),
                    file: mockFile,
                    questionNumber: 1,
                })
            ).rejects.toMatchObject({
                status: ErrorMessage.PERMISSION_DENIED.status,
            });
        });

        it('should create recording and update question with audio URL', async () => {
            const userId = new Types.ObjectId();
            const attempt = buildMockAttempt({ userId });
            mockCollection.findOne.mockResolvedValue(attempt);
            mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

            mockedCreateHelper.mockResolvedValue({
                recordingId: 'rec-123',
                url: 'https://s3/audio.webm',
                analysisStatus: 'pending',
            });

            const result = await service.submitQuestion({
                attemptId: attempt._id.toString(),
                userId: userId.toString(),
                file: mockFile,
                questionNumber: 1,
            });

            expect(mockedCreateHelper).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: userId.toString(),
                    buffer: mockFile.buffer,
                    originalname: mockFile.originalname,
                    mimetype: mockFile.mimetype,
                }),
                expect.any(Function) // onComplete callback
            );
            expect(result).toEqual({
                message: 'Recording created. Analysis in progress',
                data: {
                    recordingId: 'rec-123',
                    url: 'https://s3/audio.webm',
                    analysisStatus: 'pending',
                },
            });
        });

        it('should throw ApiError PART_NOT_FOUND if no question matched', async () => {
            const userId = new Types.ObjectId();
            const attempt = buildMockAttempt({ userId });
            mockCollection.findOne.mockResolvedValue(attempt);
            mockCollection.updateOne.mockResolvedValue({ matchedCount: 0 });

            mockedCreateHelper.mockResolvedValue({
                recordingId: 'rec-123',
                url: 'https://s3/audio.webm',
                analysisStatus: 'pending',
            });

            await expect(
                service.submitQuestion({
                    attemptId: attempt._id.toString(),
                    userId: userId.toString(),
                    file: mockFile,
                    questionNumber: 999,
                })
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                service.submitQuestion({
                    attemptId: attempt._id.toString(),
                    userId: userId.toString(),
                    file: mockFile,
                    questionNumber: 999,
                })
            ).rejects.toMatchObject({
                status: ErrorMessage.PART_NOT_FOUND.status,
            });
        });
    });

    // ════════════════════════════════════════════
    // onComplete callback (lines 247-471)
    // ════════════════════════════════════════════
    describe('onComplete callback', () => {
        const mockFile = {
            buffer: Buffer.from('audio-data'),
            originalname: 'recording.webm',
            mimetype: 'audio/webm',
            size: 1024,
        };

        /**
         * Helper: call submitQuestion and capture the onComplete callback
         * that was passed to createRecordingAndStartAnalysisHelper.
         */
        async function captureCallback(
            attemptOverrides: Record<string, any> = {}
        ) {
            const userId = new Types.ObjectId();
            const attempt = buildMockAttempt({ userId, ...attemptOverrides });

            let capturedCallback!: (err: any, result: any) => Promise<void>;
            mockedCreateHelper.mockImplementation(
                async (_params: any, cb: any) => {
                    capturedCallback = cb;
                    return {
                        recordingId: 'rec-cb',
                        url: 'https://s3/cb.webm',
                        analysisStatus: 'pending',
                    };
                }
            );

            mockCollection.findOne.mockResolvedValue(attempt);
            mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

            await service.submitQuestion({
                attemptId: attempt._id.toString(),
                userId: userId.toString(),
                file: mockFile,
                questionNumber: 1,
            });

            return { attempt, capturedCallback };
        }

        it('should write analysis_failed when callback is called with an error', async () => {
            const { attempt, capturedCallback } = await captureCallback();

            // Re-fetch returns the attempt
            mockCollection.findOne.mockResolvedValue(attempt);
            mockCollection.updateOne.mockResolvedValue({});

            await capturedCallback(new Error('analysis error'), null);

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    'parts.questions.questionNumber': 1,
                }),
                expect.objectContaining({
                    $set: expect.objectContaining({
                        'parts.$[part].questions.$[question].result':
                            expect.objectContaining({
                                error: 'analysis_failed',
                            }),
                    }),
                }),
                expect.any(Object)
            );
        });

        it('should write analysis_failed when result.analysisStatus === "failed"', async () => {
            const { attempt, capturedCallback } = await captureCallback();

            mockCollection.findOne.mockResolvedValue(attempt);
            mockCollection.updateOne.mockResolvedValue({});

            await capturedCallback(null, {
                recordingId: 'rec-cb',
                analysisStatus: 'failed',
            });

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    'parts.questions.questionNumber': 1,
                }),
                expect.objectContaining({
                    $set: expect.objectContaining({
                        'parts.$[part].questions.$[question].result':
                            expect.objectContaining({
                                error: 'analysis_failed',
                            }),
                    }),
                }),
                expect.any(Object)
            );
        });

        it('should return early from callback when foundQuestion is null (questionNumber not found)', async () => {
            const { capturedCallback } = await captureCallback();

            // Return attempt with no matching question for questionNumber=1
            const attemptNoQ = buildMockAttempt({
                parts: [{ partIndex: 1, questions: [{ questionNumber: 99 }] }],
            });
            mockCollection.findOne.mockResolvedValue(attemptNoQ);

            // Clear calls from outer submitQuestion
            mockCollection.updateOne.mockClear();

            // Should NOT call updateOne since foundQuestion is null
            await capturedCallback(null, {
                recordingId: 'rec-cb',
                analysisStatus: 'done',
            });

            expect(mockCollection.updateOne).not.toHaveBeenCalled();
        });

        it.each([
            [35, 'Expert', 200], // 35/35 * 200 = 200 (100% -> Expert)
            [27, 'Advanced', 150], // 27/35 * 200 = 154.28 -> roundTo10(154.28) = 150 (75% -> Advanced)
            [18, 'Intermediate', 100], // 18/35 * 200 = 102.85 -> roundTo10(102.85) = 100 (50% -> Intermediate)
            [5, 'Beginner', 30], // 5/35 * 200 = 28.57 -> roundTo10(28.57) = 30 (15% -> Beginner)
        ])(
            'should update level to %s and totalScore to %s when AI overallScore is %s',
            async (score, expectedLevel, expectedScore) => {
                const { aiScoringService } = await import(
                    '~/ai/service/toeicSpeakingScoringService.js'
                );
                const mockedAiScoring = aiScoringService as jest.Mocked<
                    typeof aiScoringService
                >;

                const { attempt, capturedCallback } = await captureCallback();

                mockCollection.findOne.mockReset();
                mockCollection.findOne
                    .mockResolvedValueOnce(attempt)
                    .mockResolvedValueOnce({
                        ...attempt,
                        parts: [
                            {
                                ...attempt.parts[0],
                                questions: [
                                    {
                                        ...attempt.parts[0].questions[0],
                                        result: {
                                            overallScore: score,
                                            feedback: 'Good job',
                                        },
                                    },
                                ],
                            },
                        ],
                    });
                mockCollection.updateOne.mockClear();
                mockCollection.updateOne.mockResolvedValue({});
                mockedAiScoring.scoreRecording.mockResolvedValue({
                    overallScore: score,
                    feedback: 'Good job',
                } as any);

                await capturedCallback(null, {
                    recordingId: 'rec-cb',
                    analysisStatus: 'done',
                });

                // Should update question result
                expect(mockCollection.updateOne).toHaveBeenCalledWith(
                    expect.objectContaining({
                        'parts.questions.questionNumber': 1,
                    }),
                    expect.objectContaining({
                        $set: expect.objectContaining({
                            'parts.$[part].questions.$[question].result':
                                expect.objectContaining({
                                    recordingId: 'rec-cb',
                                    provider: 'toeicSpeakingScoringService',
                                }),
                        }),
                    }),
                    expect.any(Object)
                );
                // Should update totalScore/level
                expect(mockCollection.updateOne).toHaveBeenCalledWith(
                    { _id: attempt._id },
                    {
                        $set: {
                            totalScore: expectedScore,
                            level: expectedLevel,
                        },
                    }
                );
            }
        );

        it('should write scoring_failed when AI scoring throws', async () => {
            const { aiScoringService } = await import(
                '~/ai/service/toeicSpeakingScoringService.js'
            );
            const mockedAiScoring = aiScoringService as jest.Mocked<
                typeof aiScoringService
            >;

            const { attempt, capturedCallback } = await captureCallback();

            mockCollection.findOne.mockResolvedValue(attempt);
            mockCollection.updateOne.mockResolvedValue({});
            mockedAiScoring.scoreRecording.mockRejectedValue(
                new Error('AI down')
            );

            await capturedCallback(null, {
                recordingId: 'rec-cb',
                analysisStatus: 'done',
            });

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    'parts.questions.questionNumber': 1,
                }),
                expect.objectContaining({
                    $set: expect.objectContaining({
                        'parts.$[part].questions.$[question].result':
                            expect.objectContaining({
                                error: 'scoring_failed',
                            }),
                    }),
                }),
                expect.any(Object)
            );
        });

        it('should handle missing freshAttemptDoc or non-array parts/questions when calculating total score', async () => {
            const { aiScoringService } = await import(
                '~/ai/service/toeicSpeakingScoringService.js'
            );
            const mockedAiScoring = aiScoringService as jest.Mocked<
                typeof aiScoringService
            >;

            const { attempt, capturedCallback } = await captureCallback();

            mockCollection.findOne.mockReset();
            mockCollection.findOne
                .mockResolvedValueOnce(attempt)
                .mockResolvedValueOnce(null);

            mockCollection.updateOne.mockClear();
            mockCollection.updateOne.mockResolvedValue({});
            mockedAiScoring.scoreRecording.mockResolvedValue({
                overallScore: 30,
                feedback: 'OK',
            } as any);

            await capturedCallback(null, {
                recordingId: 'rec-cb',
                analysisStatus: 'done',
            });

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                { _id: attempt._id },
                {
                    $set: {
                        totalScore: 0,
                        level: 'Beginner',
                    },
                }
            );

            const attemptBadParts = {
                ...attempt,
                parts: null,
            };
            const attemptBadQuestion = {
                ...attempt,
                parts: [
                    null,
                    {
                        partIndex: 1,
                        questions: null,
                    },
                ],
            };

            mockCollection.findOne.mockReset();
            mockCollection.findOne
                .mockResolvedValueOnce(attempt)
                .mockResolvedValueOnce(attemptBadParts)
                .mockResolvedValueOnce(attempt)
                .mockResolvedValueOnce(attemptBadQuestion);

            await capturedCallback(null, {
                recordingId: 'rec-cb',
                analysisStatus: 'done',
            });

            await capturedCallback(null, {
                recordingId: 'rec-cb',
                analysisStatus: 'done',
            });
        });

        it('should handle outer cbErr gracefully (log error, not rethrow)', async () => {
            const { capturedCallback } = await captureCallback();

            // Cause findOne to throw so the outer try/catch fires
            mockCollection.findOne.mockRejectedValue(new Error('DB crash'));

            // Should NOT throw — outer catch logs and swallows
            await expect(
                capturedCallback(null, {
                    recordingId: 'rec-cb',
                    analysisStatus: 'done',
                })
            ).resolves.toBeUndefined();

            expect(console.error).toHaveBeenCalledWith(
                '[speakingAttempt] onComplete callback error:',
                expect.any(Error)
            );
        });
    });

    // ════════════════════════════════════════════
    // finishAttempt()
    // ════════════════════════════════════════════
    describe('finishAttempt', () => {
        it('should update status to completed', async () => {
            mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

            const attemptId = new Types.ObjectId().toString();
            const userId = new Types.ObjectId().toString();

            const result = await service.finishAttempt({ attemptId, userId });

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                {
                    _id: expect.any(Types.ObjectId),
                    userId: expect.any(Types.ObjectId),
                },
                { $set: { status: 'completed' } }
            );
            expect(result).toEqual({ status: 'completed' });
        });

        it('should throw ApiError NOTFOUND if no attempt matched', async () => {
            mockCollection.updateOne.mockResolvedValue({ matchedCount: 0 });

            await expect(
                service.finishAttempt({
                    attemptId: new Types.ObjectId().toString(),
                    userId: new Types.ObjectId().toString(),
                })
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                service.finishAttempt({
                    attemptId: new Types.ObjectId().toString(),
                    userId: new Types.ObjectId().toString(),
                })
            ).rejects.toMatchObject({
                status: ErrorMessage.NOTFOUND.status,
            });
        });
    });

    // ════════════════════════════════════════════
    // getAllSpeakingAttempts()
    // ════════════════════════════════════════════
    describe('getAllSpeakingAttempts', () => {
        it('should query all attempts without userId filter', async () => {
            const mockToArray = jest.fn().mockResolvedValue([]);
            const mockSort = jest
                .fn()
                .mockReturnValue({ toArray: mockToArray });
            mockCollection.find.mockReturnValue({ sort: mockSort });

            const result = await service.getAllSpeakingAttempts();

            expect(mockCollection.find).toHaveBeenCalledWith(
                {},
                { projection: { parts: 0 } }
            );
            expect(mockSort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(result).toEqual([]);
        });

        it('should filter by userId when provided as valid ObjectId', async () => {
            const mockToArray = jest.fn().mockResolvedValue([]);
            const mockSort = jest
                .fn()
                .mockReturnValue({ toArray: mockToArray });
            mockCollection.find.mockReturnValue({ sort: mockSort });

            const userId = new Types.ObjectId().toString();
            await service.getAllSpeakingAttempts({ userId });

            expect(mockCollection.find).toHaveBeenCalledWith(
                { userId: expect.any(Types.ObjectId) },
                { projection: { parts: 0 } }
            );
        });

        it('should fallback to string userId when ObjectId conversion fails', async () => {
            const mockToArray = jest.fn().mockResolvedValue([]);
            const mockSort = jest
                .fn()
                .mockReturnValue({ toArray: mockToArray });
            mockCollection.find.mockReturnValue({ sort: mockSort });

            await service.getAllSpeakingAttempts({ userId: 'invalid-id' });

            expect(mockCollection.find).toHaveBeenCalledWith(
                { userId: 'invalid-id' },
                { projection: { parts: 0 } }
            );
        });

        it('should query all when options is undefined', async () => {
            const mockToArray = jest.fn().mockResolvedValue([]);
            const mockSort = jest
                .fn()
                .mockReturnValue({ toArray: mockToArray });
            mockCollection.find.mockReturnValue({ sort: mockSort });

            await service.getAllSpeakingAttempts(undefined);

            expect(mockCollection.find).toHaveBeenCalledWith(
                {},
                { projection: { parts: 0 } }
            );
        });

        it('should join with sw_tests to resolve testTitle for attempts without it', async () => {
            const testId1 = new Types.ObjectId();
            const testId2 = new Types.ObjectId();
            const mockAttempts = [
                { _id: 'a1', toeicSpeakingTestId: testId1 },
                {
                    _id: 'a2',
                    toeicSpeakingTestId: testId2,
                    testTitle: 'Existing Title',
                },
                { _id: 'a3', toeicSpeakingTestId: new Types.ObjectId() },
            ];

            const mockAttemptsToArray = jest
                .fn()
                .mockResolvedValue(mockAttempts);
            mockCollection.find.mockReturnValueOnce({
                sort: jest
                    .fn()
                    .mockReturnValue({ toArray: mockAttemptsToArray }),
            });

            const mockTestsToArray = jest
                .fn()
                .mockResolvedValue([
                    { _id: testId1, testTitle: 'Resolved Title 1' },
                ]);
            mockCollection.find.mockReturnValueOnce({
                toArray: mockTestsToArray,
            });

            const result = await service.getAllSpeakingAttempts();

            expect(mockCollection.find).toHaveBeenNthCalledWith(
                2,
                {
                    _id: {
                        $in: [testId1, mockAttempts[2].toeicSpeakingTestId],
                    },
                },
                { projection: { _id: 1, testTitle: 1 } }
            );

            expect(result[0].testTitle).toBe('Resolved Title 1');
            expect(result[1].testTitle).toBe('Existing Title');
            expect(result[2].testTitle).toBe('TOEIC Speaking Test');
        });

        it('should fall back to default title for attempts without testTitle when testIds is empty', async () => {
            const mockAttempts = [
                { _id: 'a1' },
                { _id: 'a2', testTitle: 'Already Set' },
            ];

            const mockToArray = jest.fn().mockResolvedValue(mockAttempts);
            mockCollection.find.mockReturnValue({
                sort: jest.fn().mockReturnValue({ toArray: mockToArray }),
            });

            const result = await service.getAllSpeakingAttempts();

            expect(result[0].testTitle).toBe('TOEIC Speaking Test');
            expect(result[1].testTitle).toBe('Already Set');
        });
    });

    // ════════════════════════════════════════════
    // Branch Coverage Tests
    // ════════════════════════════════════════════
    describe('Branch Coverage Tests', () => {
        describe('mapAttemptToResponse branch coverage', () => {
            it('should handle attempt with missing fields/toString functions', () => {
                const noToStringUser = {
                    toString: null,
                    val: 'no-tostring-user',
                };
                const noToStringTest = {
                    toString: null,
                    val: 'no-tostring-test',
                };
                const mockAttempt = {
                    _id: null,
                    userId: noToStringUser,
                    toeicSpeakingTestId: noToStringTest,
                    status: 'in_progress',
                    totalScore: 100,
                    level: 'Intermediate',
                    examMode: 'full',
                    submissionTimestamp: new Date(),
                    createdAt: new Date(),
                    parts: null,
                };

                const result = (service as any).mapAttemptToResponse(
                    mockAttempt
                );
                expect(result).toEqual({
                    testAttemptId: '',
                    userId: noToStringUser,
                    toeicSpeakingTestId: noToStringTest,
                    status: 'in_progress',
                    totalScore: 100,
                    level: 'Intermediate',
                    examMode: 'full',
                    submissionTimestamp: mockAttempt.submissionTimestamp,
                    createdAt: mockAttempt.createdAt,
                    parts: [],
                    testTitle: 'TOEIC Speaking Test',
                });
            });

            it('should return null if attempt is null', () => {
                const result = (service as any).mapAttemptToResponse(null);
                expect(result).toBeNull();
            });
        });

        describe('startAttempt branch coverage', () => {
            it('should handle parts with non-array questions and fallback to title/undefined for questionText', async () => {
                const testId = new Types.ObjectId();
                const userId = new Types.ObjectId();

                const mockTest = {
                    _id: testId,
                    parts: [
                        {
                            title: 'Part 1',
                            questions: null, // non-array questions
                        },
                        {
                            title: 'Part 2',
                            questions: [
                                { title: 'Question Title Only' }, // no questionText
                                { questionText: '', title: '' }, // both falsy
                            ],
                        },
                    ],
                };

                mockCollection.findOne.mockResolvedValueOnce(null); // no existing attempt
                mockCollection.findOne.mockResolvedValueOnce(mockTest); // find test

                // Setup insertOne response
                mockCollection.insertOne.mockResolvedValue({
                    insertedId: new Types.ObjectId(),
                });

                // Mock returning the created document
                const createdAttempt = buildMockAttempt({
                    userId,
                    toeicSpeakingTestId: testId,
                    parts: [
                        {
                            partIndex: 1,
                            partTitle: 'Part 1',
                            questions: [],
                        },
                        {
                            partIndex: 2,
                            partTitle: 'Part 2',
                            questions: [
                                {
                                    questionNumber: 1,
                                    questionText: 'Question Title Only',
                                    promptImage: undefined,
                                    s3AudioUrl: null,
                                    recordingId: null,
                                    result: null,
                                },
                                {
                                    questionNumber: 2,
                                    questionText: undefined,
                                    promptImage: undefined,
                                    s3AudioUrl: null,
                                    recordingId: null,
                                    result: null,
                                },
                            ],
                        },
                    ],
                });
                mockCollection.findOne.mockResolvedValueOnce(createdAttempt);

                const result = await service.startAttempt({
                    userId: userId.toString(),
                    toeicSpeakingTestId: testId.toString(),
                    examMode: 'full',
                });

                expect(result).not.toBeNull();
            });
        });

        describe('onComplete callback branch coverage', () => {
            const mockFile = {
                buffer: Buffer.from('audio-data'),
                originalname: 'recording.webm',
                mimetype: 'audio/webm',
                size: 1024,
            };

            async function captureCallback(
                attemptOverrides: Record<string, any> = {}
            ) {
                const userId = new Types.ObjectId();
                const attempt = buildMockAttempt({
                    userId,
                    ...attemptOverrides,
                });

                let capturedCallback!: (err: any, result: any) => Promise<void>;
                mockedCreateHelper.mockImplementation(
                    async (_params: any, cb: any) => {
                        capturedCallback = cb;
                        return {
                            recordingId: 'rec-cb',
                            url: 'https://s3/cb.webm',
                            analysisStatus: 'pending',
                        };
                    }
                );

                mockCollection.findOne.mockResolvedValue(attempt);
                mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

                await service.submitQuestion({
                    attemptId: attempt._id.toString(),
                    userId: userId.toString(),
                    file: mockFile,
                    questionNumber: 1,
                });

                return { attempt, capturedCallback };
            }

            it('should handle non-array parts or questions in onComplete callback', async () => {
                const { capturedCallback } = await captureCallback();

                // Part with non-array questions or non-array parts
                const attemptNoParts = buildMockAttempt({
                    parts: null,
                });
                mockCollection.findOne.mockResolvedValue(attemptNoParts);
                mockCollection.updateOne.mockClear();

                await capturedCallback(null, {
                    recordingId: 'rec-cb',
                    analysisStatus: 'done',
                });
                expect(mockCollection.updateOne).not.toHaveBeenCalled();

                const attemptNoQs = buildMockAttempt({
                    parts: [{ partIndex: 1, questions: null }],
                });
                mockCollection.findOne.mockResolvedValue(attemptNoQs);
                mockCollection.updateOne.mockClear();

                await capturedCallback(null, {
                    recordingId: 'rec-cb',
                    analysisStatus: 'done',
                });
                expect(mockCollection.updateOne).not.toHaveBeenCalled();
            });

            it('should fallback to defaults when partIndex, questionText, promptImage, partScenario, overallScore, or totalScore are missing', async () => {
                const { aiScoringService } = await import(
                    '~/ai/service/toeicSpeakingScoringService.js'
                );
                const mockedAiScoring = aiScoringService as jest.Mocked<
                    typeof aiScoringService
                >;

                const { attempt, capturedCallback } = await captureCallback();

                // Modify attempt to lack partIndex, totalScore, questionText, promptImage
                const modifiedAttempt = {
                    ...attempt,
                    totalScore: null, // not a number
                    parts: [
                        {
                            partIndex: undefined, // not a number
                            partTitle: 'Part 1',
                            partDirection: 'Read aloud.',
                            partScenario: undefined, // no partScenario
                            questions: [
                                {
                                    questionNumber: 1,
                                    questionText: undefined, // no questionText
                                    promptImage: undefined, // no promptImage
                                    s3AudioUrl: null,
                                    recordingId: null,
                                    result: null,
                                },
                            ],
                        },
                    ],
                };

                mockCollection.findOne.mockResolvedValue(modifiedAttempt);
                mockCollection.updateOne.mockClear();
                mockCollection.updateOne.mockResolvedValue({});

                // Mock AI scoring returning invalid overallScore
                mockedAiScoring.scoreRecording.mockResolvedValue({
                    overallScore: undefined,
                    feedback: 'No score',
                } as any);

                await capturedCallback(null, {
                    recordingId: 'rec-cb',
                    analysisStatus: 'done',
                });

                // Since overallScore is undefined, perQuestionScaled should be 0, and newTotal = 0 (using currentTotal = 0)
                expect(mockCollection.updateOne).toHaveBeenCalledWith(
                    { _id: attempt._id },
                    {
                        $set: {
                            totalScore: 0,
                            level: 'Beginner',
                        },
                    }
                );
            });
        });
    });
});
