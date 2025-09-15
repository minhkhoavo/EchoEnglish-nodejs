import mongoose, { Types } from 'mongoose';
import S3Service from '~/services/s3Service';
import SpeechAssessmentService from '~/services/speech-analyze/speechAssessmentService';
import { ApiError } from '~/middleware/apiError';
import { ErrorMessage } from '~/enum/errorMessage';
import { createRecordingAndStartAnalysisHelper } from '~/controllers/speechController';
import RecordingService from '~/services/recordingService';
import { aiScoringService } from '~/ai/service/toeicSpeakingScoringService';

type MongoDb = mongoose.mongo.Db;

export interface StartAttemptInput {
    userId: string;
    toeicSpeakingTestId: string | number;
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

    public async startAttempt({ userId, toeicSpeakingTestId }: StartAttemptInput) {
        const db = await this.getDb();

        // Resolve test by either ObjectId (_id) or numeric testId
        // FIXME: Pending database standardization – no stable ID available yet.
        let test: any = null;
        let tid: number | null = null;
        if (typeof toeicSpeakingTestId === 'string' && /^[a-f\d]{24}$/i.test(toeicSpeakingTestId)) {
            // Looks like ObjectId
            const oid = this.toObjectId(toeicSpeakingTestId);
            test = await db.collection('sw_tests').findOne({ _id: oid });
            if (test) tid = test.testId;
        } else {
            tid =
                typeof toeicSpeakingTestId === 'string' && /\d+/.test(toeicSpeakingTestId)
                    ? parseInt(toeicSpeakingTestId, 10)
                    : (toeicSpeakingTestId as number);
            test = await db.collection('sw_tests').findOne({ testId: tid });
        }
        if (!test) {
            throw new ApiError(ErrorMessage.TEST_NOT_FOUND);
        }

        const parts: any[] = [];
        let qCounter = 0;
        const testParts: any[] = Array.isArray((test as any).parts) ? (test as any).parts : [];

        for (const p of testParts) {
            const questions: any[] = [];
            const rawQs: any[] = Array.isArray(p.questions) ? p.questions : [];
            for (const q of rawQs) {
                qCounter += 1;
                questions.push({
                    questionNumber: qCounter,
                    promptText: q.title || undefined,
                    promptImage: q.image || undefined,
                    s3AudioUrl: null,
                    recordingId: null,
                    scores: null,
                });
            }

            parts.push({
                partIndex: parts.length + 1,
                partTitle: p.title || p.name || p.partName || (p.offset ? `Part ${p.offset}` : 'Part'),
                partDirection: p.direction || p.instruction || p.instructions || undefined,
                questionType:
                    [
                        'speaking_part1',
                        'speaking_part2',
                        'speaking_part3',
                        'speaking_part4',
                        'speaking_part5',
                        'speaking_part6',
                    ][parts.length] || 'speaking_part1',
                questions,
            });
        }

        const now = new Date();
        const attemptDoc = {
            userId: this.toObjectId(userId),
            toeicSpeakingTestId: (test as any)._id,
            testIdNumeric: tid, 
            submissionTimestamp: now,
            status: 'in_progress',
            parts,
            createdAt: now,
        };

        const insert = await db.collection('toeic_speaking_results').insertOne(attemptDoc as any);
        return { testAttemptId: insert.insertedId.toString() };
    }

    public async submitQuestion(params: {
        attemptId: string;
        userId: string;
        file: { buffer: Buffer; originalname: string; mimetype: string; size: number };
        questionNumber: number;
    }) {
        const db = await this.getDb();
        const attemptObjectId = this.toObjectId(params.attemptId);

        const attempt = await db.collection('toeic_speaking_results').findOne({ _id: attemptObjectId });
        if (!attempt) throw new ApiError(ErrorMessage.NOTFOUND);
        if (attempt.userId?.toString?.() !== params.userId) throw new ApiError(ErrorMessage.PERMISSION_DENIED);

        const folder = `${params.userId}/${attemptObjectId.toString()}`;
        const orchestration = await createRecordingAndStartAnalysisHelper({
            userId: params.userId,
            buffer: params.file.buffer,
            originalname: params.file.originalname,
            mimetype: params.file.mimetype,
            folder,
        });

        // Update nested question by questionNumber
        const updateRes = await db.collection('toeic_speaking_results').updateOne(
            { _id: attemptObjectId, 'parts.questions.questionNumber': params.questionNumber },
            {
                $set: {
                    'parts.$[part].questions.$[question].s3AudioUrl': orchestration.url,
                    'parts.$[part].questions.$[question].recordingId': orchestration.recordingId,
                    'parts.$[part].questions.$[question].scores': null,
                },
            },
            {
                arrayFilters: [
                    { 'part.questions.questionNumber': params.questionNumber },
                    { 'question.questionNumber': params.questionNumber },
                ],
            } as any
        );

        if (!updateRes.matchedCount) {
            throw new ApiError(ErrorMessage.PART_NOT_FOUND);
        }

        // Fire-and-forget background scoring workflow: wait until analysis is done, then score with AI
        (async () => {
            // Helper: sleep
            const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

            try {
                // Re-fetch attempt doc to locate part/question context
                const attemptDoc: any = await db
                    .collection('toeic_speaking_results')
                    .findOne({ _id: attemptObjectId });

                // Locate the question by questionNumber and capture its part index
                let foundPartIndex = -1;
                let foundQuestion: any = null;
                const partsArr: any[] = Array.isArray(attemptDoc?.parts) ? attemptDoc.parts : [];
                for (let i = 0; i < partsArr.length; i++) {
                    const p = partsArr[i];
                    const qs: any[] = Array.isArray(p?.questions) ? p.questions : [];
                    const match = qs.find((q: any) => q?.questionNumber === params.questionNumber);
                    if (match) {
                        foundPartIndex = i; // 0-based
                        foundQuestion = match;
                        break;
                    }
                }

                if (foundQuestion && orchestration.recordingId) {
                    // Poll for analysis completion
                    const maxWaitMs = 2 * 60 * 1000; // 2 minutes
                    const intervalMs = 2000;
                    const start = Date.now();
                    let status: string | undefined = 'processing';

                    while (Date.now() - start < maxWaitMs) {
                        const rec: any = await RecordingService.getById(orchestration.recordingId as any);
                        status = rec?.analysisStatus;
                        if (status === 'done' || status === 'failed') break;
                        await sleep(intervalMs);
                    }

                    if (status === 'done') {
                        // Map part index (0-based) to TOEIC speaking part
                        const mapIdxToType = (idx: number) => {
                            const types = [
                                'speaking_part1',
                                'speaking_part2',
                                'speaking_part3',
                                'speaking_part4',
                                'speaking_part5',
                                'speaking_part6',
                            ] as const;
                            return types[idx] ?? 'speaking_part1';
                        };

                        const questionType = mapIdxToType(foundPartIndex);

                        // Build AI scoring context using available metadata
                        const context: any = {
                            questionType,
                        };
                        if (foundQuestion?.promptText) context.referenceText = foundQuestion.promptText;
                        if (foundQuestion?.promptImage) context.imageUrl = foundQuestion.promptImage;

                        try {
                            const scoreResult = await aiScoringService.scoreRecording(
                                orchestration.recordingId as any,
                                context
                            );

                            // Persist scores back into the corresponding question
                            await db.collection('toeic_speaking_results').updateOne(
                                { _id: attemptObjectId, 'parts.questions.questionNumber': params.questionNumber },
                                {
                                    $set: {
                                        'parts.$[part].questions.$[question].scores': {
                                            provider: 'toeicSpeakingScoringService',
                                            scoredAt: new Date(),
                                            result: scoreResult,
                                        },
                                    },
                                },
                                {
                                    arrayFilters: [
                                        { 'part.questions.questionNumber': params.questionNumber },
                                        { 'question.questionNumber': params.questionNumber },
                                    ],
                                } as any
                            );
                        } catch (scoreErr) {
                            console.error('[speakingAttempt] AI scoring failed:', scoreErr);
                            // Optionally mark an error in scores
                            await db.collection('toeic_speaking_results').updateOne(
                                { _id: attemptObjectId, 'parts.questions.questionNumber': params.questionNumber },
                                {
                                    $set: {
                                        'parts.$[part].questions.$[question].scores': {
                                            provider: 'toeicSpeakingScoringService',
                                            scoredAt: new Date(),
                                            error: 'scoring_failed',
                                        },
                                    },
                                },
                                {
                                    arrayFilters: [
                                        { 'part.questions.questionNumber': params.questionNumber },
                                        { 'question.questionNumber': params.questionNumber },
                                    ],
                                } as any
                            );
                        }
                    } else if (status === 'failed') {
                        // Analysis failed – mark accordingly
                        await db.collection('toeic_speaking_results').updateOne(
                            { _id: attemptObjectId, 'parts.questions.questionNumber': params.questionNumber },
                            {
                                $set: {
                                    'parts.$[part].questions.$[question].scores': {
                                        provider: 'toeicSpeakingScoringService',
                                        scoredAt: new Date(),
                                        error: 'analysis_failed',
                                    },
                                },
                            },
                            {
                                arrayFilters: [
                                    { 'part.questions.questionNumber': params.questionNumber },
                                    { 'question.questionNumber': params.questionNumber },
                                ],
                            } as any
                        );
                    }
                }
            } catch (bgErr) {
                console.error('[speakingAttempt] Background scoring workflow error:', bgErr);
            }
        })();

        return {
            message: 'Recording created. Analysis in progress',
            data: {
                recordingId: orchestration.recordingId,
                url: orchestration.url,
                analysisStatus: orchestration.analysisStatus,
            },
        };
    }

    public async finishAttempt({ attemptId, userId }: { attemptId: string; userId: string }) {
        const db = await this.getDb();
        const attemptObjectId = this.toObjectId(attemptId);

        const res = await db
            .collection('toeic_speaking_results')
            .updateOne({ _id: attemptObjectId, userId: this.toObjectId(userId) }, { $set: { status: 'completed' } });

        if (!res.matchedCount) throw new ApiError(ErrorMessage.NOTFOUND);
        return { status: 'completed' };
    }
}

export const speakingAttemptService = new SpeakingAttemptService();
