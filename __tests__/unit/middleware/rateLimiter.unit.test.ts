import { oneRequestPerSecond } from '~/middleware/rateLimiter.js';
import { Request, Response } from 'express';

describe('rateLimiter middleware', () => {
    it('should be defined', () => {
        expect(oneRequestPerSecond).toBeDefined();
        expect(typeof oneRequestPerSecond).toBe('function');
    });

    it('should call next when limits are not exceeded', async () => {
        const mockReq = {
            ip: '127.0.0.1',
            headers: {},
            app: {
                get: jest.fn().mockReturnValue(false),
            },
        } as unknown as Request;
        const mockRes = {
            setHeader: jest.fn(),
            getHeader: jest.fn(),
            status: jest.fn().mockReturnThis(),
            send: jest.fn(),
        } as unknown as Response;
        const mockNext = jest.fn();

        await oneRequestPerSecond(mockReq, mockRes, mockNext);
        expect(mockNext).toHaveBeenCalled();
    });
});
