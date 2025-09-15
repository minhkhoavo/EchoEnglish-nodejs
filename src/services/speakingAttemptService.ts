import mongoose, { Types } from 'mongoose';
import S3Service from '~/services/s3Service';
import SpeechAssessmentService from '~/services/speech-analyze/speechAssessmentService';
import { ApiError } from '~/middleware/apiError';
import { ErrorMessage } from '~/enum/errorMessage';
import { createRecordingAndStartAnalysisHelper } from '~/controllers/speechController';

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
                partTitle: p.title || p.name || p.partName || (p.offset ? `Part ${p.offset}` : 'Part'),
                partDirection: p.direction || p.instruction || p.instructions || undefined,
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
