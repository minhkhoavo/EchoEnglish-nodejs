import mongoose, { Types } from 'mongoose';
import SpeechAssessmentService from '~/services/speech-analyze/speechAssessmentService.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { createRecordingAndStartAnalysisHelper } from '~/controllers/speechController.js';
import RecordingService from '~/services/recordingService.js';
import { aiScoringService } from '~/ai/service/toeicSpeakingScoringService.js';

type MongoDb = mongoose.mongo.Db;

export interface StartAttemptInput {
    userId: string;
    toeicSpeakingTestId: string | number;
    examMode: string;
}

interface TestQuestion {
    title?: string;
    image?: string;
}

interface TestPart {
    title?: string;
    name?: string;
    partName?: string;
    offset?: number;
    direction?: string;
    instruction?: string;
    instructions?: string;
    narrator?: { text?: string };
    questions?: TestQuestion[];
}
interface AttemptQuestion {
    questionNumber: number;
    promptText?: string;
    promptImage?: string;
    s3AudioUrl: string | null;
    recordingId: string | null;
    result: unknown | null;
}

interface AttemptPart {
    partIndex: number;
    partTitle: string;
    partDirection?: string;
    partScenario?: string;
    questions: AttemptQuestion[];
}

interface AttemptDocument {
    _id?: Types.ObjectId;
    userId: Types.ObjectId;
    toeicSpeakingTestId: Types.ObjectId;
    submissionTimestamp: Date;
    status: string;
    totalScore: number;
    level: string;
    parts: AttemptPart[];
    examMode: string;
    createdAt: Date;
}

export default class SpeakingAttemptService {
    private async getDb(): Promise<MongoDb> {
        if (mongoose.connection.readyState !== 1) {
            throw new ApiError(ErrorMessage.INTERNAL_ERROR);
        }
        return mongoose.connection.db!;
    }

    private toObjectId(id: string): Types.ObjectId {
        try {
            return new Types.ObjectId(id);
        } catch {
            throw new ApiError(ErrorMessage.INVALID_ID);
        }
    }

    private mapAttemptToResponse(attempt: AttemptDocument | null) {
        if (!attempt) return null;
        return {
            testAttemptId: attempt._id?.toString?.() || '',
            userId: attempt.userId?.toString?.() || attempt.userId,
            toeicSpeakingTestId:
                attempt.toeicSpeakingTestId?.toString?.() ||
                attempt.toeicSpeakingTestId,
            status: attempt.status,
            totalScore: attempt.totalScore,
            level: attempt.level,
            examMode: attempt.examMode,
            submissionTimestamp: attempt.submissionTimestamp,
            createdAt: attempt.createdAt,
            parts: attempt.parts || [],
        };
    }

    public async getCurrentAttempt({
        userId,
        toeicSpeakingTestId,
        examMode,
    }: StartAttemptInput) {
        const db = await this.getDb();

        // Check if there's an existing in_progress attempt for this user and test
        if (
            typeof toeicSpeakingTestId !== 'string' ||
            !mongoose.Types.ObjectId.isValid(toeicSpeakingTestId)
        ) {
            return null;
        }

        const oid = this.toObjectId(toeicSpeakingTestId);
        const existingAttempt = await db
            .collection('toeic_speaking_results')
            .findOne({
                userId: this.toObjectId(userId),
                toeicSpeakingTestId: oid,
                status: 'in_progress',
            });

        return existingAttempt as AttemptDocument | null;
    }

    public async startAttempt({
        userId,
        toeicSpeakingTestId,
        examMode,
    }: StartAttemptInput) {
        const db = await this.getDb();

        // Resolve test by ObjectId (_id) - standardized to ObjectId
        if (
            typeof toeicSpeakingTestId !== 'string' ||
            !mongoose.Types.ObjectId.isValid(toeicSpeakingTestId)
        ) {
            throw new ApiError(ErrorMessage.INVALID_ID);
        }
        const oid = this.toObjectId(toeicSpeakingTestId);

        // Check if user already has an in_progress attempt for this test
        const existingAttempt = await this.getCurrentAttempt({
            userId,
            toeicSpeakingTestId,
            examMode,
        });
        if (existingAttempt) {
            return this.mapAttemptToResponse(existingAttempt);
        }

        const test = await db.collection('sw_tests').findOne({ _id: oid });
        if (!test) {
            throw new ApiError(ErrorMessage.TEST_NOT_FOUND);
        }

        const parts: AttemptPart[] = [];
        let qCounter = 0;
        const testParts: TestPart[] = Array.isArray(test?.parts)
            ? test.parts
            : [];

        for (const p of testParts) {
            const questions: AttemptQuestion[] = [];
            const rawQs: TestQuestion[] = Array.isArray(p.questions)
                ? p.questions
                : [];
            for (const q of rawQs) {
                qCounter += 1;
                questions.push({
                    questionNumber: qCounter,
                    promptText: q.title || undefined,
                    promptImage: q.image || undefined,
                    s3AudioUrl: null,
                    recordingId: null,
                    result: null,
                });
            }

            parts.push({
                partIndex: parts.length + 1,
                partTitle:
                    p.title ||
                    p.name ||
                    p.partName ||
                    (p.offset ? `Part ${p.offset}` : 'Part'),
                partDirection:
                    p.direction || p.instruction || p.instructions || undefined,
                partScenario: p.narrator?.text || undefined,
                questions,
            });
        }

        const now = new Date();
        const attemptDoc: AttemptDocument = {
            userId: this.toObjectId(userId),
            toeicSpeakingTestId: oid,
            submissionTimestamp: now,
            status: 'in_progress',
            totalScore: 0,
            level: 'Beginner',
            parts,
            examMode,
            createdAt: now,
        };

        const insert = await db
            .collection('toeic_speaking_results')
            .insertOne(attemptDoc);

        // Fetch the newly created attempt and return full data
        const newAttempt = (await db
            .collection('toeic_speaking_results')
            .findOne({ _id: insert.insertedId })) as AttemptDocument | null;

        return this.mapAttemptToResponse(newAttempt);
    }

    public async submitQuestion(params: {
        attemptId: string;
        userId: string;
        file: {
            buffer: Buffer;
            originalname: string;
            mimetype: string;
            size: number;
        };
        questionNumber: number;
    }) {
        const db = await this.getDb();
        const attemptObjectId = this.toObjectId(params.attemptId);

        const attempt = await db
            .collection('toeic_speaking_results')
            .findOne({ _id: attemptObjectId });
        if (!attempt) throw new ApiError(ErrorMessage.NOTFOUND);
        if (attempt.userId?.toString?.() !== params.userId)
            throw new ApiError(ErrorMessage.PERMISSION_DENIED);

        const folder = `${params.userId}/${attemptObjectId.toString()}`;
        const orchestration = await createRecordingAndStartAnalysisHelper(
            {
                userId: params.userId,
                buffer: params.file.buffer,
                originalname: params.file.originalname,
                mimetype: params.file.mimetype,
                folder,
            },
            // onComplete callback invoked when analysis finishes or fails
            async (err, result) => {
                try {
                    // Re-fetch attempt doc to locate part/question context
                    const attemptDoc = (await db
                        .collection('toeic_speaking_results')
                        .findOne({
                            _id: attemptObjectId,
                        })) as AttemptDocument | null;

                    // Locate the question by questionNumber and capture its part index
                    let foundPartIndex = -1;
                    let foundQuestion: AttemptQuestion | null = null;
                    const partsArr: AttemptPart[] = Array.isArray(
                        attemptDoc?.parts
                    )
                        ? attemptDoc.parts
                        : [];
                    for (let i = 0; i < partsArr.length; i++) {
                        const p = partsArr[i];
                        const qs: AttemptQuestion[] = Array.isArray(
                            p?.questions
                        )
                            ? p.questions
                            : [];
                        const match = qs.find(
                            (q: AttemptQuestion) =>
                                q?.questionNumber === params.questionNumber
                        );
                        if (match) {
                            foundPartIndex = i; // 0-based
                            foundQuestion = match;
                            break;
                        }
                    }

                    if (!foundQuestion) return;

                    // If analysis failed or error, write analysis_failed
                    if (err || !result || result.analysisStatus === 'failed') {
                        await db.collection('toeic_speaking_results').updateOne(
                            {
                                _id: attemptObjectId,
                                'parts.questions.questionNumber':
                                    params.questionNumber,
                            },
                            {
                                $set: {
                                    'parts.$[part].questions.$[question].result':
                                        {
                                            recordingId: result?.recordingId,
                                            provider:
                                                'toeicSpeakingScoringService',
                                            scoredAt: new Date(),
                                            error: 'analysis_failed',
                                        },
                                },
                            },
                            {
                                arrayFilters: [
                                    {
                                        'part.questions.questionNumber':
                                            params.questionNumber,
                                    },
                                    {
                                        'question.questionNumber':
                                            params.questionNumber,
                                    },
                                ],
                            }
                        );
                        return;
                    }

                    // Build AI scoring context: derive questionType from partIndex
                    const partIndexFromDoc =
                        attemptDoc?.parts?.[foundPartIndex]?.partIndex;
                    const partIndex =
                        typeof partIndexFromDoc === 'number'
                            ? partIndexFromDoc
                            : foundPartIndex + 1;
                    const bounded = Math.max(1, Math.min(6, partIndex));
                    const questionType = `speaking_part${bounded}`;

                    const context = {
                        questionType: questionType as
                            | 'speaking_part1'
                            | 'speaking_part2'
                            | 'speaking_part3'
                            | 'speaking_part4'
                            | 'speaking_part5'
                            | 'speaking_part6',
                        referenceText: foundQuestion?.promptText,
                        imageUrl: foundQuestion?.promptImage,
                        questionPrompt: foundQuestion?.promptText || '',
                        providedInfo:
                            attemptDoc?.parts?.[foundPartIndex]?.partScenario ||
                            '',
                    };
                    try {
                        const scoreResult =
                            await aiScoringService.scoreRecording(
                                result.recordingId,
                                context
                            );
                        console.log(
                            '[speakingAttempt] AI scoring result:',
                            scoreResult
                        );

                        // Save the per-question result
                        await db.collection('toeic_speaking_results').updateOne(
                            {
                                _id: attemptObjectId,
                                'parts.questions.questionNumber':
                                    params.questionNumber,
                            },
                            {
                                $set: {
                                    'parts.$[part].questions.$[question].result':
                                        {
                                            recordingId: result?.recordingId,
                                            provider:
                                                'toeicSpeakingScoringService',
                                            scoredAt: new Date(),
                                            ...scoreResult,
                                        },
                                },
                            },
                            {
                                arrayFilters: [
                                    {
                                        'part.questions.questionNumber':
                                            params.questionNumber,
                                    },
                                    {
                                        'question.questionNumber':
                                            params.questionNumber,
                                    },
                                ],
                            }
                        );

                        const roundTo10 = (n: number) =>
                            Math.round(n / 10) * 10;
                        const overall =
                            scoreResult &&
                            typeof scoreResult.overallScore === 'number'
                                ? scoreResult.overallScore
                                : undefined;
                        let perQuestionScaled = 0;
                        if (typeof overall === 'number' && !isNaN(overall)) {
                            perQuestionScaled = roundTo10((overall / 35) * 200);
                        }

                        // Fetch current totalScore
                        const currentTotal =
                            typeof attemptDoc?.totalScore === 'number'
                                ? attemptDoc.totalScore
                                : 0;
                        const newTotal = Math.max(
                            0,
                            Math.min(
                                200,
                                Math.round(currentTotal + perQuestionScaled)
                            )
                        );
                        const overallPercentage = (newTotal / 200) * 100;

                        function getProficiencyFromPercent(pct: number) {
                            if (pct >= 90) return 'Expert';
                            if (pct >= 75) return 'Advanced';
                            if (pct >= 50) return 'Intermediate';
                            return 'Beginner';
                        }

                        const newLevel =
                            getProficiencyFromPercent(overallPercentage);

                        await db.collection('toeic_speaking_results').updateOne(
                            { _id: attemptObjectId },
                            {
                                $set: {
                                    totalScore: newTotal,
                                    level: newLevel,
                                },
                            }
                        );
                    } catch (scoreErr) {
                        console.error(
                            '[speakingAttempt] AI scoring failed (callback):',
                            scoreErr
                        );
                        await db.collection('toeic_speaking_results').updateOne(
                            {
                                _id: attemptObjectId,
                                'parts.questions.questionNumber':
                                    params.questionNumber,
                            },
                            {
                                $set: {
                                    'parts.$[part].questions.$[question].result':
                                        {
                                            recordingId: result?.recordingId,
                                            provider:
                                                'toeicSpeakingScoringService',
                                            scoredAt: new Date(),
                                            error: 'scoring_failed',
                                        },
                                },
                            },
                            {
                                arrayFilters: [
                                    {
                                        'part.questions.questionNumber':
                                            params.questionNumber,
                                    },
                                    {
                                        'question.questionNumber':
                                            params.questionNumber,
                                    },
                                ],
                            }
                        );
                    }
                } catch (cbErr) {
                    console.error(
                        '[speakingAttempt] onComplete callback error:',
                        cbErr
                    );
                }
            }
        );

        // Update nested question by questionNumber
        const updateRes = await db
            .collection('toeic_speaking_results')
            .updateOne(
                {
                    _id: attemptObjectId,
                    'parts.questions.questionNumber': params.questionNumber,
                },
                {
                    $set: {
                        'parts.$[part].questions.$[question].s3AudioUrl':
                            orchestration.url,
                        'parts.$[part].questions.$[question].recordingId':
                            orchestration.recordingId,
                        'parts.$[part].questions.$[question].result': null,
                    },
                },
                {
                    arrayFilters: [
                        {
                            'part.questions.questionNumber':
                                params.questionNumber,
                        },
                        { 'question.questionNumber': params.questionNumber },
                    ],
                }
            );

        if (!updateRes.matchedCount) {
            throw new ApiError(ErrorMessage.PART_NOT_FOUND);
        }

        return {
            message: 'Recording created. Analysis in progress',
            data: {
                recordingId: orchestration.recordingId,
                url: orchestration.url,
                analysisStatus: orchestration.analysisStatus,
            },
        };
    }

    public async finishAttempt({
        attemptId,
        userId,
    }: {
        attemptId: string;
        userId: string;
    }) {
        const db = await this.getDb();
        const attemptObjectId = this.toObjectId(attemptId);

        const res = await db
            .collection('toeic_speaking_results')
            .updateOne(
                { _id: attemptObjectId, userId: this.toObjectId(userId) },
                { $set: { status: 'completed' } }
            );

        if (!res.matchedCount) throw new ApiError(ErrorMessage.NOTFOUND);
        return { status: 'completed' };
    }

    public async getAllSpeakingAttempts(options?: { userId?: string }) {
        const db = await this.getDb();
        const { userId } = options || {};

        const query: Record<string, unknown> = {};
        if (userId) {
            try {
                query.userId = this.toObjectId(userId);
            } catch {
                query.userId = userId;
            }
        }

        return await db
            .collection('toeic_speaking_results')
            .find(query, { projection: { parts: 0 } })
            .sort({ createdAt: -1 })
            .toArray();
    }
}

export const speakingAttemptService = new SpeakingAttemptService();
