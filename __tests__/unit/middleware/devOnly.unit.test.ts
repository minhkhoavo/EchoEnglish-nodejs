 
import { devOnly } from '~/middleware/devOnly.js';
import { Request, Response, NextFunction } from 'express';

describe('devOnly middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;
    let statusJsonMock: jest.Mock;
    let statusMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockReq = {};
        statusJsonMock = jest.fn();
        statusMock = jest.fn().mockReturnValue({ json: statusJsonMock });
        mockRes = {
            status: statusMock,
        };
        mockNext = jest.fn();
    });

    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules(); // clears the cache
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('should call next() when NODE_ENV is not production', () => {
        process.env.NODE_ENV = 'development';
        devOnly(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
        expect(statusMock).not.toHaveBeenCalled();
    });

    it('should call next() when ENABLE_PLAYGROUND is true, even in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.ENABLE_PLAYGROUND = 'true';
        devOnly(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
        expect(statusMock).not.toHaveBeenCalled();
    });

    it('should return 404 when NODE_ENV is production and ENABLE_PLAYGROUND is false/undefined', () => {
        process.env.NODE_ENV = 'production';
        process.env.ENABLE_PLAYGROUND = 'false';
        devOnly(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).not.toHaveBeenCalled();
        expect(statusMock).toHaveBeenCalledWith(404);
        expect(statusJsonMock).toHaveBeenCalledWith({ message: 'Not found' });
    });
});
