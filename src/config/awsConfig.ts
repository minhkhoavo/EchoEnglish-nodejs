import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const s3Client = new S3Client({
    region: process.env.S3_REGION!,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
});

export const AWS_CONFIG = {
    s3Client,
    bucketName: process.env.S3_BUCKET_NAME!,
    region: process.env.S3_REGION!,
};

export default AWS_CONFIG;
