import { Request, Response, NextFunction } from 'express';
import SpeechAssessmentService from '~/services/speech_assessment_service';
import SpeechTransformService from '~/services/speech_transform_service';
import ApiResponse from '~/dto/response/api_response';
import { ApiError } from '~/middleware/api_error';
import S3Service from '~/services/s3_service';

class SpeechController {
    async assess(req: Request, res: Response, next: NextFunction) {
        if (!req.file) throw new ApiError({ message: 'No file provided', status: 400 });
        const mimeType = req.file.mimetype || '';

        if (!mimeType.startsWith('audio/')) throw new ApiError({ message: 'Only audio files are allowed', status: 400 });
        
        const userId = (req.user as any)?.id || (req as any).userId || '';
        const folder = userId || undefined;
        
        const uploadPromise = S3Service.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, folder);
        const assessPromise = SpeechAssessmentService.assess(req.file.buffer, mimeType);
        const [uploadResult, azureResponse] = await Promise.all([uploadPromise, assessPromise]);
        const parsed = Array.isArray(azureResponse) ? azureResponse : [azureResponse];
        
        const transformed = SpeechTransformService.createTranscriptData(parsed, uploadResult.url);
        
        res.status(200).json(new ApiResponse('Assessment success', transformed));
    }
}

export default new SpeechController();
