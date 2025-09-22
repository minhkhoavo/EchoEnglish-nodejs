import { Request, Response } from 'express';
import { Types } from 'mongoose';
import SpeechAssessmentService from '~/services/speech-analyze/speechAssessmentService.js';
import SpeechTransformService from '~/services/speech-analyze/speechTransformService.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ApiError } from '~/middleware/apiError.js';
import S3Service from '~/services/s3Service.js';
import RecordingService from '~/services/recordingService.js';
import SpeechProsodyService from '~/services/speech-analyze/speechProsodyService.js';
import PronunciationSummaryService from '~/services/speech-analyze/pronunciationSummaryService.js';
import VocabularyService from '~/services/speech-analyze/vocabularyService.js';
// Helper orchestrator functions for recording + analysis
export async function createRecordingAndStartAnalysisHelper(
    params: {
        userId: string;
        buffer: Buffer;
        originalname: string;
        mimetype: string;
        folder?: string;
    },
    onComplete?: (
        err: Error | null,
        result?: {
            recordingId: Types.ObjectId;
            url: string;
            analysisStatus: string;
            analysis?: Record<string, unknown>;
        }
    ) => void
) {
    const { userId, buffer, mimetype, originalname } = params;
    const folder = params.folder || userId || undefined;

    // Upload to S3
    const uploadResult = await S3Service.uploadFile(
        buffer,
        originalname,
        mimetype,
        folder
    );

    // Create recording (processing)
    const recording = await RecordingService.create({
        userId: new Types.ObjectId(userId),
        name: originalname,
        url: uploadResult.url,
        duration: 0,
        speakingTime: 0,
        mimeType: mimetype,
        size: buffer.length,
        transcript: '',
        analysisStatus: 'processing',
    });

    // Keep recordingId as an ObjectId to match other references in the codebase
    const recordingId = recording._id;

    // Background analysis
    (async () => {
        try {
            const azureResponse = await SpeechAssessmentService.assess(
                buffer,
                mimetype
            );
            const parsed = Array.isArray(azureResponse)
                ? azureResponse
                : [azureResponse];
            const transformed = SpeechTransformService.createTranscriptData(
                parsed,
                uploadResult.url
            );

            let prosody: Record<string, unknown> | null = null;
            let fluency: Record<string, unknown> | null = null;
            let stressWords: Record<string, unknown>[] = [];
            let pronunciation: Record<string, unknown> | null = null;

            try {
                const analysis = SpeechProsodyService.analyze({
                    transformed,
                    audioBuffer: buffer,
                    mimeType: mimetype,
                });
                prosody = analysis.prosody;
                fluency = analysis.fluency;
                stressWords = analysis.stressWords;
            } catch (e) {
                console.error('Prosody analysis error:', e);
            }

            try {
                const sum = PronunciationSummaryService.summarize(parsed);
                pronunciation = sum;
            } catch (e) {
                console.error('Pronunciation summary error:', e);
            }

            // Vocabulary field (Paraphrase + Suggestions + Analysis)
            let vocabulary: Record<string, unknown> | null = null;
            try {
                const field =
                    await VocabularyService.buildVocabularyField(transformed);
                vocabulary = field as unknown as Record<string, unknown>;
            } catch (e) {
                console.error('Vocabulary analysis error:', e);
            }

            if (
                Array.isArray(stressWords) &&
                stressWords.length &&
                Array.isArray((transformed as Record<string, unknown>).segments)
            ) {
                let idx = 0;
                for (const seg of (transformed as Record<string, unknown>)
                    .segments as Array<Record<string, unknown>>) {
                    for (const w of (seg.words as Array<
                        Record<string, unknown>
                    >) || []) {
                        const st = stressWords[idx++];
                        if (st)
                            (w as Record<string, unknown>).isStressed =
                                !!st.isStressed;
                    }
                }
            }

            const finalPayload = {
                ...transformed,
                analyses: {
                    prosody,
                    fluency,
                    pronunciation,
                    vocabulary,
                },
            };

            try {
                const transcriptText =
                    (finalPayload as Record<string, unknown>).segments &&
                    Array.isArray(
                        (finalPayload as Record<string, unknown>).segments
                    )
                        ? (
                              (finalPayload as Record<string, unknown>)
                                  .segments as Array<Record<string, unknown>>
                          )
                              .map((s: Record<string, unknown>) => s.text)
                              .join(' ')
                              .trim()
                        : '';

                const metadata = (finalPayload as Record<string, unknown>)
                    .metadata as Record<string, unknown>;
                const updated = await RecordingService.update(recordingId, {
                    transcript: transcriptText || '',
                    duration: (metadata?.duration as number) || 0,
                    speakingTime: (metadata?.speakingTime as number) || 0,
                    analysisStatus: 'done',
                    analysis: finalPayload,
                });

                if (typeof onComplete === 'function') {
                    try {
                        onComplete(null, {
                            recordingId,
                            url: uploadResult.url,
                            analysisStatus: 'done',
                            analysis: finalPayload,
                        });
                    } catch (cbErr) {
                        console.error(
                            'onComplete callback error (done):',
                            cbErr
                        );
                    }
                }
                return updated;
            } catch (err) {
                console.error('Update recording failed:', err);
                if (typeof onComplete === 'function') {
                    try {
                        onComplete(
                            err instanceof Error ? err : new Error(String(err)),
                            {
                                recordingId,
                                url: uploadResult.url,
                                analysisStatus: 'done',
                                analysis: finalPayload,
                            }
                        );
                    } catch (cbErr) {
                        console.error(
                            'onComplete callback error (update failed):',
                            cbErr
                        );
                    }
                }
            }
        } catch (err) {
            console.error('Background analysis failed:', err);
            try {
                await RecordingService.update(recordingId, {
                    analysisStatus: 'failed',
                });
                if (typeof onComplete === 'function') {
                    try {
                        onComplete(
                            err instanceof Error ? err : new Error(String(err))
                        );
                    } catch (cbErr) {
                        console.error(
                            'onComplete callback error (failed):',
                            cbErr
                        );
                    }
                }
            } catch (updateErr) {
                console.error('Failed to update recording status:', updateErr);
            }
        }
    })();

    return {
        recordingId,
        url: uploadResult.url,
        analysisStatus: 'processing' as const,
    };
}

class SpeechController {
    async assess(req: Request, res: Response) {
        if (!req.file)
            throw new ApiError({ message: 'No file provided', status: 400 });
        const mimeType = req.file.mimetype || '';

        if (!mimeType.startsWith('audio/'))
            throw new ApiError({
                message: 'Only audio files are allowed',
                status: 400,
            });

        const userId =
            (req.user as { id?: string })?.id ||
            (req as { userId?: string }).userId ||
            '';
        const folder = userId || undefined;

        const result = await createRecordingAndStartAnalysisHelper({
            userId,
            buffer: req.file.buffer,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            folder,
        });

        res.status(202).json(
            new ApiResponse('Recording created. Analysis in progress', result)
        );
    }

    async listRecordings(req: Request, res: Response) {
        const userId =
            (req.user as { id?: string })?.id ||
            (req as { userId?: string }).userId;
        const data = await RecordingService.list({ userId });
        res.status(200).json(new ApiResponse('OK', data));
    }

    async detailRecording(req: Request, res: Response) {
        const rec = await RecordingService.getById(req.params.id);
        if (!rec)
            throw new ApiError({ message: 'Recording not found', status: 404 });
        res.status(200).json(new ApiResponse('OK', rec));
    }

    async removeRecording(req: Request, res: Response) {
        const rec = await RecordingService.remove(req.params.id);
        if (!rec)
            throw new ApiError({ message: 'Recording not found', status: 404 });
        res.status(200).json(new ApiResponse('Deleted', rec));
    }
}

export default new SpeechController();
