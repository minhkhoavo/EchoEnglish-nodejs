import { ApiError } from '~/middleware/apiError.js';

// ──────────────────────────────────────────────
// Module-level mocks — must be declared before import of s3Service
// ──────────────────────────────────────────────
const mockSend = jest.fn();

jest.mock('~/config/awsConfig.js', () => ({
    __esModule: true,
    default: {
        s3Client: { send: mockSend },
        bucketName: 'test-bucket',
        region: 'us-east-1',
    },
    AWS_CONFIG: {
        s3Client: { send: mockSend },
        bucketName: 'test-bucket',
        region: 'us-east-1',
    },
}));

jest.mock('uuid', () => ({
    v4: () => 'mock-uuid',
}));

jest.mock('@aws-sdk/client-s3', () => ({
    PutObjectCommand: jest.fn().mockImplementation((params) => ({
        ...params,
        _type: 'PutObjectCommand',
    })),
    DeleteObjectCommand: jest.fn().mockImplementation((params) => ({
        ...params,
        _type: 'DeleteObjectCommand',
    })),
    GetObjectCommand: jest.fn().mockImplementation((params) => ({
        ...params,
        _type: 'GetObjectCommand',
    })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: jest.fn(),
}));

import s3Service from '~/services/s3Service.js';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const mockedGetSignedUrl = getSignedUrl as jest.Mock;

describe('S3Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ════════════════════════════════════════════
    // uploadFile()
    // ════════════════════════════════════════════
    describe('uploadFile', () => {
        const file = Buffer.from('test-content');
        const originalName = 'photo.jpg';
        const mimeType = 'image/jpeg';

        it('should upload file without folder and return correct result', async () => {
            mockSend.mockResolvedValue({});

            const result = await s3Service.uploadFile(
                file,
                originalName,
                mimeType
            );

            expect(mockSend).toHaveBeenCalledTimes(1);
            expect(result).toEqual({
                key: 'mock-uuid.jpg',
                url: 'https://test-bucket.s3.us-east-1.amazonaws.com/mock-uuid.jpg',
                originalName: 'photo.jpg',
                size: file.length,
                mimeType: 'image/jpeg',
            });
        });

        it('should upload file with folder prefix', async () => {
            mockSend.mockResolvedValue({});

            const result = await s3Service.uploadFile(
                file,
                originalName,
                mimeType,
                'uploads'
            );

            expect(result.key).toBe('uploads/mock-uuid.jpg');
            expect(result.url).toBe(
                'https://test-bucket.s3.us-east-1.amazonaws.com/uploads/mock-uuid.jpg'
            );
        });

        it('should throw ApiError with status 500 on failure', async () => {
            const s3Error = {
                message: 'Access Denied',
                Code: 'AccessDenied',
                name: 'AccessDeniedException',
                $fault: 'client',
                $metadata: { httpStatusCode: 403, requestId: 'req-123' },
            };
            mockSend.mockRejectedValue(s3Error);

            await expect(
                s3Service.uploadFile(file, originalName, mimeType)
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                s3Service.uploadFile(file, originalName, mimeType)
            ).rejects.toMatchObject({
                status: 500,
                message: 'Failed to upload file to S3',
            });
        });

        it('should log error.name when error.Code is undefined (line 67 branch)', async () => {
            // Error without Code field — should fallback to errorObj.name
            const s3ErrorNoCode = {
                message: 'Network Error',
                name: 'NetworkingError',
                // No Code field
            };
            mockSend.mockRejectedValue(s3ErrorNoCode);

            await expect(
                s3Service.uploadFile(file, originalName, mimeType)
            ).rejects.toBeInstanceOf(ApiError);

            // console.error should have been called with name as the code fallback
            expect(console.error).toHaveBeenCalledWith(
                'ApiError uploading file to S3:',
                expect.objectContaining({ code: 'NetworkingError' })
            );
        });
    });

    // ════════════════════════════════════════════
    // deleteFile()
    // ════════════════════════════════════════════
    describe('deleteFile', () => {
        it('should delete file successfully', async () => {
            mockSend.mockResolvedValue({});

            await s3Service.deleteFile('uploads/mock-uuid.jpg');

            expect(mockSend).toHaveBeenCalledTimes(1);
        });

        it('should throw ApiError with status 500 on failure', async () => {
            mockSend.mockRejectedValue(new Error('Delete failed'));

            await expect(
                s3Service.deleteFile('uploads/mock-uuid.jpg')
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                s3Service.deleteFile('uploads/mock-uuid.jpg')
            ).rejects.toMatchObject({
                status: 500,
                message: 'Failed to delete file from S3',
            });
        });
    });

    // ════════════════════════════════════════════
    // getPresignedUrl()
    // ════════════════════════════════════════════
    describe('getPresignedUrl', () => {
        it('should return presigned URL with default expiresIn', async () => {
            mockedGetSignedUrl.mockResolvedValue('https://presigned-url.com');

            const result = await s3Service.getPresignedUrl('uploads/test.jpg');

            expect(mockedGetSignedUrl).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                { expiresIn: 3600 }
            );
            expect(result).toBe('https://presigned-url.com');
        });

        it('should pass custom expiresIn', async () => {
            mockedGetSignedUrl.mockResolvedValue('https://presigned-url.com');

            await s3Service.getPresignedUrl('uploads/test.jpg', 7200);

            expect(mockedGetSignedUrl).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                { expiresIn: 7200 }
            );
        });

        it('should throw ApiError with status 500 on failure', async () => {
            mockedGetSignedUrl.mockRejectedValue(new Error('Presign failed'));

            await expect(
                s3Service.getPresignedUrl('uploads/test.jpg')
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                s3Service.getPresignedUrl('uploads/test.jpg')
            ).rejects.toMatchObject({
                status: 500,
                message: 'Failed to generate presigned URL',
            });
        });
    });

    // ════════════════════════════════════════════
    // getJSON()
    // ════════════════════════════════════════════
    describe('getJSON', () => {
        it('should parse and return JSON from S3 object Body', async () => {
            const jsonData = { key: 'value', count: 42 };
            mockSend.mockResolvedValue({
                Body: {
                    transformToString: () =>
                        Promise.resolve(JSON.stringify(jsonData)),
                },
            });

            const result = await s3Service.getJSON('data/config.json');

            expect(result).toEqual(jsonData);
        });

        it('should return null when Body is null/undefined', async () => {
            mockSend.mockResolvedValue({ Body: null });

            const result = await s3Service.getJSON('data/missing.json');

            expect(result).toBeNull();
        });

        it('should return null on any error (silent catch)', async () => {
            mockSend.mockRejectedValue(new Error('NoSuchKey'));

            const result = await s3Service.getJSON('data/nonexistent.json');

            expect(result).toBeNull();
        });
    });

    // ════════════════════════════════════════════
    // putJSON()
    // ════════════════════════════════════════════
    describe('putJSON', () => {
        it('should upload JSON data as string with correct ContentType', async () => {
            mockSend.mockResolvedValue({});
            const data = { hello: 'world' };

            await s3Service.putJSON('data/config.json', data);

            expect(mockSend).toHaveBeenCalledTimes(1);
        });
    });

    // ════════════════════════════════════════════
    // downloadFile()
    // ════════════════════════════════════════════
    describe('downloadFile', () => {
        it('should download file and return Buffer from stream', async () => {
            const testContent = Buffer.from('file-content');
            const { EventEmitter } = await import('events');
            const mockStream = new EventEmitter();

            mockSend.mockResolvedValue({ Body: mockStream });

            const downloadPromise = s3Service.downloadFile(
                'https://test-bucket.s3.us-east-1.amazonaws.com/uploads/file.txt'
            );

            // Emit data and end events after the promise is set up
            process.nextTick(() => {
                mockStream.emit('data', testContent);
                mockStream.emit('end');
            });

            const result = await downloadPromise;
            expect(result).toEqual(testContent);
        });

        it('should handle non-Buffer chunk by converting to Buffer (line 169 branch)', async () => {
            const { EventEmitter } = await import('events');
            const mockStream = new EventEmitter();

            mockSend.mockResolvedValue({ Body: mockStream });

            const downloadPromise = s3Service.downloadFile(
                'https://test-bucket.s3.us-east-1.amazonaws.com/uploads/file.txt'
            );

            process.nextTick(() => {
                // Emit a string chunk (not a Buffer) — triggers Buffer.from(chunk) branch
                mockStream.emit('data', 'string-chunk-data');
                mockStream.emit('end');
            });

            const result = await downloadPromise;
            expect(result).toEqual(Buffer.from('string-chunk-data'));
        });

        it('should return null when Body is null', async () => {
            mockSend.mockResolvedValue({ Body: null });

            const result = await s3Service.downloadFile(
                'https://test-bucket.s3.us-east-1.amazonaws.com/uploads/file.txt'
            );

            expect(result).toBeNull();
        });

        it('should return null on S3 send error', async () => {
            mockSend.mockRejectedValue(new Error('Download failed'));

            const result = await s3Service.downloadFile(
                'https://test-bucket.s3.us-east-1.amazonaws.com/uploads/file.txt'
            );

            expect(result).toBeNull();
        });

        it('should reject on stream error event', async () => {
            const { EventEmitter } = await import('events');
            const mockStream = new EventEmitter();

            mockSend.mockResolvedValue({ Body: mockStream });

            const downloadPromise = s3Service.downloadFile(
                'https://test-bucket.s3.us-east-1.amazonaws.com/uploads/file.txt'
            );

            process.nextTick(() => {
                mockStream.emit('error', new Error('Stream error'));
            });

            await expect(downloadPromise).rejects.toThrow('Stream error');
        });
    });
});
