import { Request, Response, NextFunction } from 'express';
import SpeechAssessmentService from '~/services/speech-analyze/speechAssessmentService';
import SpeechTransformService from '~/services/speech-analyze/speechTransformService';
import ApiResponse from '~/dto/response/apiResponse';
import { ApiError } from '~/middleware/apiError';
import S3Service from '~/services/s3Service';
import RecordingService from '~/services/recordingService';
import SpeechProsodyService from '~/services/speech-analyze/speechProsodyService';
import PronunciationSummaryService from '~/services/speech-analyze/pronunciationSummaryService';
// File persistence removed; analyses stored in MongoDB

class SpeechController {
    async assess(req: Request, res: Response, next: NextFunction) {
        if (!req.file) throw new ApiError({ message: 'No file provided', status: 400 });
        const mimeType = req.file.mimetype || '';

        if (!mimeType.startsWith('audio/'))
            throw new ApiError({ message: 'Only audio files are allowed', status: 400 });

        const userId = (req.user as any)?.id || (req as any).userId || '';
        const folder = userId || undefined;

        // 1) Upload first
        const uploadResult = await S3Service.uploadFile(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            folder
        );

        // 2) Create a minimal recording immediately (analysis async)
        const recording = await RecordingService.create({
            userId,
            name: req.file.originalname,
            url: uploadResult.url,
            duration: 0,
            speakingTime: 0,
            mimeType: req.file.mimetype,
            size: req.file.size,
            transcript: '',
            analysisStatus: 'processing',
        } as any);

        // 3) Return fast to client with recording info
        res.status(202).json(
            new ApiResponse('Recording created. Analysis in progress', {
                recordingId: (recording as any)?._id?.toString?.(),
                url: uploadResult.url,
                analysisStatus: 'processing',
            })
        );

        // 4) Run analysis in background (best-effort)
        (async () => {
            try {
                const azureResponse = await SpeechAssessmentService.assess(req.file!.buffer, mimeType);
                const parsed = Array.isArray(azureResponse) ? azureResponse : [azureResponse];

                const transformed = SpeechTransformService.createTranscriptData(parsed, uploadResult.url);

                // Prosody + Fluency analysis
                let prosody: any = null;
                let fluency: any = null;
                let stressWords: any[] = [];
                let pronunciation: any = null;
                try {
                    const analysis = SpeechProsodyService.analyze({
                        azureSegments: parsed,
                        transformed,
                        audioBuffer: req.file!.buffer,
                        mimeType: req.file!.mimetype,
                        userId: userId || '',
                        recordingId: (recording as any)?._id?.toString?.() || 'rec',
                    });
                    prosody = analysis.prosody;
                    fluency = analysis.fluency;
                    stressWords = analysis.stressWords;
                } catch (e) {
                    console.error('Prosody analysis error:', e);
                }

                // Pronunciation summary (top errors + resources)
                try {
                    const sum = PronunciationSummaryService.summarize(parsed);
                    pronunciation = sum;
                } catch (e) {
                    console.error('Pronunciation summary error:', e);
                }

                // Merge stress flags into words
                if (
                    Array.isArray(stressWords) &&
                    stressWords.length &&
                    Array.isArray((transformed as any).segments)
                ) {
                    let idx = 0;
                    for (const seg of (transformed as any).segments) {
                        for (const w of seg.words || []) {
                            const st = stressWords[idx++];
                            if (st) w.isStressed = !!st.isStressed;
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

                // Update recording with transcript, durations, analysis file
                try {
                    const transcriptText = (finalPayload as any).segments
                        ?.map((s: any) => s.text)
                        .join(' ')
                        .trim();

                    await RecordingService.update((recording as any)?._id, {
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
                    await RecordingService.update((recording as any)?._id, { analysisStatus: 'failed' } as any);
                } catch {}
            }
        })();
    }

    // Recording handlers moved here for convenience
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
