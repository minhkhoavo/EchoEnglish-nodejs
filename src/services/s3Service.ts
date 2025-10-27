import {
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import AWS_CONFIG from '../config/awsConfig.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { ApiError } from '~/middleware/apiError.js';

export interface UploadResult {
    key: string;
    url: string;
    originalName: string;
    size: number;
    mimeType: string;
}

class S3Service {
    private s3Client = AWS_CONFIG.s3Client;
    private bucketName = AWS_CONFIG.bucketName;

    async uploadFile(
        file: Buffer,
        originalName: string,
        mimeType: string,
        folder?: string
    ): Promise<UploadResult> {
        try {
            const fileExtension = path.extname(originalName);
            const fileName = `${uuidv4()}${fileExtension}`;
            const key = folder ? `${folder}/${fileName}` : fileName;

            const command = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                Body: file,
                ContentType: mimeType,
            });

            await this.s3Client.send(command);

            const url = `https://${this.bucketName}.s3.${AWS_CONFIG.region}.amazonaws.com/${key}`;

            return {
                key,
                url,
                originalName,
                size: file.length,
                mimeType,
            };
        } catch (error: unknown) {
            const errorObj = error as {
                message?: string;
                Code?: string;
                name?: string;
                $fault?: string;
                $metadata?: { httpStatusCode?: number; requestId?: string };
            };
            console.error('ApiError uploading file to S3:', {
                message: errorObj?.message,
                code: errorObj?.Code || errorObj?.name,
                fault: errorObj?.$fault,
                statusCode: errorObj?.$metadata?.httpStatusCode,
                requestId: errorObj?.$metadata?.requestId,
            });
            throw new ApiError({
                message: 'Failed to upload file to S3',
                status: 500,
            });
        }
    }

    async deleteFile(key: string): Promise<void> {
        try {
            const command = new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            });

            await this.s3Client.send(command);
        } catch (error) {
            console.error('ApiError deleting file from S3:', error);
            throw new ApiError({
                message: 'Failed to delete file from S3',
                status: 500,
            });
        }
    }

    async getPresignedUrl(
        key: string,
        expiresIn: number = 3600
    ): Promise<string> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            });

            const signedUrl = await getSignedUrl(this.s3Client, command, {
                expiresIn,
            });
            return signedUrl;
        } catch (error) {
            console.error('ApiError generating presigned URL:', error);
            throw new ApiError({
                message: 'Failed to generate presigned URL',
                status: 500,
            });
        }
    }

    async downloadFile(url: string): Promise<Buffer | null> {
        try {
            // Extract key from S3 URL
            // URL format: https://bucket.s3.region.amazonaws.com/key
            const urlObj = new URL(url);
            const key = urlObj.pathname.substring(1); // Remove leading slash

            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            });

            const response = await this.s3Client.send(command);

            // Convert stream to buffer
            if (!response.Body) {
                return null;
            }

            const chunks: Buffer[] = [];
            const stream = response.Body as NodeJS.ReadableStream;

            return new Promise((resolve, reject) => {
                stream.on('data', (chunk) => {
                    chunks.push(
                        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                    );
                });
                stream.on('error', (err) => {
                    reject(err);
                });
                stream.on('end', () => {
                    resolve(Buffer.concat(chunks));
                });
            });
        } catch (error) {
            console.error('ApiError downloading file from S3:', error);
            return null;
        }
    }
}

export default new S3Service();
