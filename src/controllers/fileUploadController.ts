import { Request, Response, NextFunction } from 'express';
import S3Service, { UploadResult } from '../services/s3Service.js';
import ApiResponse from '../dto/response/apiResponse.js';
import { ApiError } from '../middleware/apiError.js';
import { uploadSingle } from '../config/multerConfig.js';

class FileUploadController {
  async uploadSingleFile(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (!req.file) {
      throw new ApiError({ message: 'No file provided', status: 400 });
    }

    const { folder } = req.body;

    const result: UploadResult = await S3Service.uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      folder
    );

    res.status(200).json(new ApiResponse('File uploaded successfully', result));
  }

  async deleteFile(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const { key } = req.params;

    if (!key) {
      throw new ApiError({ message: 'File key is required', status: 400 });
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
      throw new ApiError({ message: 'File key is required', status: 400 });
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
      throw new ApiError({ message: 'No image file provided', status: 400 });
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

    res
      .status(200)
      .json(new ApiResponse('Image uploaded successfully', result));
  }

  async uploadAudio(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (!req.file) {
      throw new ApiError({ message: 'No audio file provided', status: 400 });
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

    res
      .status(200)
      .json(new ApiResponse('Audio uploaded successfully', result));
  }
}

export default new FileUploadController();
