import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import AWS_CONFIG from '../config/aws_config';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { ApiError } from '~/middleware/api_error';

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

    async uploadFile(file: Buffer, originalName: string, mimeType: string, folder?: string): Promise<UploadResult> {
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
        } catch (error: any) {
            console.error('ApiError uploading file to S3:', {
                message: error?.message,
                code: error?.Code || error?.name,
                fault: error?.$fault,
                statusCode: error?.$metadata?.httpStatusCode,
                requestId: error?.$metadata?.requestId,
            });
            throw new ApiError({ message: 'Failed to upload file to S3', status: 500 });
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
            throw new ApiError({ message: 'Failed to delete file from S3', status: 500});
        }
    }

    async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            });

            const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
            return signedUrl;
        } catch (error) {
            console.error('ApiError generating presigned URL:', error);
            throw new ApiError({ message: 'Failed to generate presigned URL', status: 500});
        }
    }
}

export default new S3Service();
