/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import errorMiddleware from '~/middleware/errorMiddleware.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

describe('Error Middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        mockReq = {};
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        mockNext = jest.fn();
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('should handle ApiError and return correct status and message', () => {
        const err = new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
        errorMiddleware.handleError(
            err,
            mockReq as Request,
            mockRes as Response,
            mockNext
        );

        expect(mockRes.status).toHaveBeenCalledWith(
            ErrorMessage.CATEGORY_NOT_FOUND.status
        );
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                message: ErrorMessage.CATEGORY_NOT_FOUND.message,
            })
        );
    });

    it('should handle mongoose.Error.CastError and return INVALID_ID message', () => {
        const err = new mongoose.Error.CastError('ObjectId', '123', 'id');
        errorMiddleware.handleError(
            err,
            mockReq as Request,
            mockRes as Response,
            mockNext
        );

        expect(mockRes.status).toHaveBeenCalledWith(
            ErrorMessage.INVALID_ID.status
        );
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                message: ErrorMessage.INVALID_ID.message,
            })
        );
    });

    it('should handle mongoose.Error.ValidationError and map inner messages', () => {
        const err = new mongoose.Error.ValidationError(null as any);
        // Add some mock errors
        err.errors = {
            field1: { message: 'EMAIL_INVALID' } as any,
            field2: { message: 'Some custom missing field error' } as any,
        };

        errorMiddleware.handleError(
            err,
            mockReq as Request,
            mockRes as Response,
            mockNext
        );

        expect(mockRes.status).toHaveBeenCalledWith(400);
        // ErrorMessage['EMAIL_INVALID'].message is 'Email is invalid'
        // Second message has no matching key in ErrorMessage, so it falls back to raw message
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                message: `${ErrorMessage.EMAIL_INVALID.message}, Some custom missing field error`,
            })
        );
    });

    it('should handle multer.MulterError for LIMIT_FILE_SIZE', () => {
        const err = new multer.MulterError('LIMIT_FILE_SIZE');
        errorMiddleware.handleError(
            err,
            mockReq as Request,
            mockRes as Response,
            mockNext
        );

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'File too large. Maximum allowed size is 30MB.',
            })
        );
    });

    it('should handle other multer.MulterError', () => {
        const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
        err.message = 'Unexpected field';
        errorMiddleware.handleError(
            err,
            mockReq as Request,
            mockRes as Response,
            mockNext
        );

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'File upload error: Unexpected field',
            })
        );
    });

    it('should handle fallback unhandled error as Internal Server Error (500)', () => {
        const err = new Error('Unknown catastrophic failure');
        errorMiddleware.handleError(
            err,
            mockReq as Request,
            mockRes as Response,
            mockNext
        );

        expect(consoleErrorSpy).toHaveBeenCalledWith('Unhandled error:', err);
        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Internal Server Error' })
        );
    });
});
