import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import SpeechAssessmentService from '~/services/speech-analyze/speechAssessmentService';
import SpeechTransformService from '~/services/speech-analyze/speechTransformService';
import ApiResponse from '~/dto/response/apiResponse';
import { ApiError } from '~/middleware/apiError';
import S3Service from '~/services/s3Service';
import RecordingService from '~/services/recordingService';
import SpeechProsodyService from '~/services/speech-analyze/speechProsodyService';
import PronunciationSummaryService from '~/services/speech-analyze/pronunciationSummaryService';
// Helper orchestrator functions for recording + analysis
export async function createRecordingAndStartAnalysisHelper(params: {
    userId: string;
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    folder?: string;
}) {
    const { userId, buffer, mimetype, originalname } = params;
    const folder = params.folder || userId || undefined;

    // Upload to S3
    const uploadResult = await S3Service.uploadFile(buffer, originalname, mimetype, folder);

    // Create recording (processing)
    const recording = await RecordingService.create({
        userId,
        name: originalname,
        url: uploadResult.url,
        duration: 0,
        speakingTime: 0,
        mimeType: mimetype,
        size: buffer.length,
        transcript: '',
        analysisStatus: 'processing',
    } as any);

    // Keep recordingId as an ObjectId to match other references in the codebase
    const recordingId = (recording as any)?._id as Types.ObjectId;

    // Background analysis
    (async () => {
        try {
            const azureResponse = await SpeechAssessmentService.assess(buffer, mimetype);
            const parsed = Array.isArray(azureResponse) ? azureResponse : [azureResponse];
            const transformed = SpeechTransformService.createTranscriptData(parsed, uploadResult.url);

            let prosody: any = null;
            let fluency: any = null;
            let stressWords: any[] = [];
            let pronunciation: any = null;

            try {
                const analysis = SpeechProsodyService.analyze({
                    transformed,
                    audioBuffer: buffer,
                    mimeType: mimetype
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

            if (
                Array.isArray(stressWords) &&
                stressWords.length &&
                Array.isArray((transformed as any).segments)
            ) {
                let idx = 0;
                for (const seg of (transformed as any).segments) {
                    for (const w of seg.words || []) {
                        const st = stressWords[idx++];
                        if (st) (w as any).isStressed = !!st.isStressed;
                    }
                }
            }

            const finalPayload = {
                ...transformed,
                analyses: {
                    prosody,
                    fluency,
                    pronunciation,
                },
            };

            try {
                const transcriptText = (finalPayload as any).segments
                    ?.map((s: any) => s.text)
                    .join(' ')
                    .trim();

                await RecordingService.update(recordingId, {
                    transcript: transcriptText || '',
                    duration: (finalPayload as any).metadata?.duration || 0,
                    speakingTime: (finalPayload as any).metadata?.speakingTime || 0,
                    analysisStatus: 'done',
                    analysis: finalPayload,
                } as any);
            } catch (err) {
                console.error('Update recording failed:', err);
            }
        } catch (err) {
            console.error('Background analysis failed:', err);
            try {
                await RecordingService.update(recordingId, { analysisStatus: 'failed' } as any);
            } catch {}
        }
    })();

    return {
        recordingId,
        url: uploadResult.url,
        analysisStatus: 'processing' as const,
    };
}

class SpeechController {
    async assess(req: Request, res: Response, next: NextFunction) {
        if (!req.file) throw new ApiError({ message: 'No file provided', status: 400 });
        const mimeType = req.file.mimetype || '';

        if (!mimeType.startsWith('audio/'))
            throw new ApiError({ message: 'Only audio files are allowed', status: 400 });

        const userId = (req.user as any)?.id || (req as any).userId || '';
        const folder = userId || undefined;

        const result = await createRecordingAndStartAnalysisHelper({
            userId,
            buffer: req.file.buffer,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            folder,
        });

        res.status(202).json(new ApiResponse('Recording created. Analysis in progress', result));
    }

    async listRecordings(req: Request, res: Response, next: NextFunction) {
        const userId = (req.user as any)?.id || (req as any).userId;
        const data = await RecordingService.list({ userId });
        res.status(200).json(new ApiResponse('OK', data));
    }

    async detailRecording(req: Request, res: Response, next: NextFunction) {
        const rec = await RecordingService.getById(req.params.id);
        if (!rec) throw new ApiError({ message: 'Recording not found', status: 404 });
        res.status(200).json(new ApiResponse('OK', rec));
    }

    async removeRecording(req: Request, res: Response, next: NextFunction) {
        const rec = await RecordingService.remove(req.params.id);
        if (!rec) throw new ApiError({ message: 'Recording not found', status: 404 });
        res.status(200).json(new ApiResponse('Deleted', rec));
    }
}

export default new SpeechController();
