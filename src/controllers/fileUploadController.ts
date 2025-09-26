import { Request, Response, NextFunction } from 'express';
import S3Service, { UploadResult } from '../services/s3Service.js';
import ApiResponse from '../dto/response/apiResponse.js';
import { ApiError } from '../middleware/apiError.js';
import { fileIntelligenceService } from '~/services/document-analyze/fileAnalysis.js';

class FileUploadController {
    async uploadOnly(req: Request, res: Response): Promise<void> {
        if (!req.file) {
            throw new ApiError({ message: 'No file provided', status: 400 });
        }

        const { folder } = req.body;

        const uploadResult: UploadResult = await S3Service.uploadFile(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            folder
        );

        res.status(200).json(
            new ApiResponse('File uploaded successfully', uploadResult)
        );
    }

    async analyzeFile(req: Request, res: Response): Promise<void> {
        if (!req.file) {
            throw new ApiError({ message: 'No file provided', status: 400 });
        }

        const { folder } = req.body;

        const uploadResult: UploadResult = await S3Service.uploadFile(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            folder
        );

        const processing = await fileIntelligenceService.processUpload({
            file: req.file,
            folder,
            userId: req.user?.id || '',
            upload: uploadResult,
        });

        res.status(200).json(
            new ApiResponse('File uploaded and analyzed successfully', {
                ...processing.upload,
                status: processing.metadata.status,
                metadataId: processing.metadata._id,
                language: processing.metadata.language,
                tagsPart: processing.metadata.tagsPart,
                moderation: processing.moderation,
                analysis: processing.analysis,
                embedding: processing.embedding,
                aiUsage: processing.aiUsage,
            })
        );
    }

    async chatWithUploads(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        if (!req.user?.id) {
            throw new ApiError({ message: 'Unauthorized', status: 401 });
        }

        const { question, fileIds, topK, language } = req.body ?? {};
        if (!question || typeof question !== 'string') {
            throw new ApiError({
                message: 'question is required to chat with documents',
                status: 400,
            });
        }

        const result = await fileIntelligenceService.chat({
            userId: req.user.id,
            question,
            fileIds: Array.isArray(fileIds) ? fileIds : undefined,
            topK: typeof topK === 'number' ? topK : undefined,
            language: typeof language === 'string' ? language : undefined,
        });

        res.status(200).json(new ApiResponse('Chat completed', result));
    }

    async deleteFile(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        const { key } = req.params;

        if (!key) {
            throw new ApiError({
                message: 'File key is required',
                status: 400,
            });
        }

        await S3Service.deleteFile(key);

        res.status(200).json(new ApiResponse('File deleted successfully'));
    }

    async getPresignedUrl(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        const { key } = req.params;
        const { expiresIn } = req.query;

        if (!key) {
            throw new ApiError({
                message: 'File key is required',
                status: 400,
            });
        }

        const expires = expiresIn ? parseInt(expiresIn as string) : 3600;
        const signedUrl = await S3Service.getPresignedUrl(key, expires);

        res.status(200).json(
            new ApiResponse('Presigned URL generated successfully', {
                url: signedUrl,
                expiresIn: expires,
            })
        );
    }

    async uploadImage(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        if (!req.file) {
            throw new ApiError({
                message: 'No image file provided',
                status: 400,
            });
        }

        if (!req.file.mimetype.startsWith('image/')) {
            throw new ApiError({
                message: 'Only image files are allowed',
                status: 400,
            });
        }

        const result: UploadResult = await S3Service.uploadFile(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            'images'
        );

        res.status(200).json(
            new ApiResponse('Image uploaded successfully', result)
        );
    }

    async uploadAudio(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        if (!req.file) {
            throw new ApiError({
                message: 'No audio file provided',
                status: 400,
            });
        }

        if (!req.file.mimetype.startsWith('audio/')) {
            throw new ApiError({
                message: 'Only audio files are allowed',
                status: 400,
            });
        }

        const result: UploadResult = await S3Service.uploadFile(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            'audio'
        );

        res.status(200).json(
            new ApiResponse('Audio uploaded successfully', result)
        );
    }
}

export default new FileUploadController();
