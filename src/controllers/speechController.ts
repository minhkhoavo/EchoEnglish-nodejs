import { Request, Response, NextFunction } from 'express';
import SpeechAssessmentService from '~/services/speech-analyze/speechAssessmentService';
import SpeechTransformService from '~/services/speech-analyze/speechTransformService';
import ApiResponse from '~/dto/response/apiResponse';
import { ApiError } from '~/middleware/apiError';
import S3Service from '~/services/s3Service';
import RecordingService from '~/services/recordingService';
import SpeechProsodyService from '~/services/speech-analyze/speechProsodyService';
import fs from 'fs';
import path from 'path';

class SpeechController {
    async assess(req: Request, res: Response, next: NextFunction) {
        if (!req.file) throw new ApiError({ message: 'No file provided', status: 400 });
        const mimeType = req.file.mimetype || '';

        if (!mimeType.startsWith('audio/'))
            throw new ApiError({ message: 'Only audio files are allowed', status: 400 });

        const userId = (req.user as any)?.id || (req as any).userId || '';
        const folder = userId || undefined;

        const uploadPromise = S3Service.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, folder);
        const assessPromise = SpeechAssessmentService.assess(req.file.buffer, mimeType);
        const [uploadResult, azureResponse] = await Promise.all([uploadPromise, assessPromise]);
        const parsed = Array.isArray(azureResponse) ? azureResponse : [azureResponse];

        const transformed = SpeechTransformService.createTranscriptData(parsed, uploadResult.url);

        // Save recording
        const transcriptText = (transformed.segments || []).map((s: any) => s.text).join(' ').trim();
        const recording = await RecordingService.create({
            userId,
            name: req.file.originalname,
            url: uploadResult.url,
            duration: transformed.metadata?.duration || 0,
            speakingTime: transformed.metadata?.speakingTime || 0,
            mimeType: req.file.mimetype,
            size: req.file.size,
            transcript: transcriptText,
        });

        // Prosody + Fluency analysis
        let prosody: any = null;
        let fluency: any = null;
        let stressWords: any[] = [];
        try {
            const analysis = SpeechProsodyService.analyze({
                azureSegments: parsed,
                transformed,
                audioBuffer: req.file.buffer,
                mimeType: req.file.mimetype,
                userId: userId || '',
                recordingId: (recording as any)?._id?.toString?.() || 'rec',
            });
            prosody = analysis.prosody;
            fluency = analysis.fluency;
            stressWords = analysis.stressWords;
        } catch (e) {
            console.error('Prosody analysis error:', e);
        }

        // Merge stress flags into words
        if (Array.isArray(stressWords) && stressWords.length && Array.isArray(transformed.segments)) {
            let idx = 0;
            for (const seg of transformed.segments) {
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
            },
        };

        // Save to JSON file before responding
        // try {
        //     const outDir = path.join(process.cwd(), 'storage', 'analyses');
        //     fs.mkdirSync(outDir, { recursive: true });
        //     const outPath = path.join(
        //         outDir,
        //         `${(recording as any)?._id?.toString?.() || Date.now()}-analysis.json`
        //     );
        //     fs.writeFileSync(outPath, JSON.stringify(finalPayload, null, 2), 'utf-8');
        //     (finalPayload as any).analysesFile = outPath;
        // } catch {}

        res.status(200).json(new ApiResponse('Assessment success', finalPayload));
    }
}

export default new SpeechController();
