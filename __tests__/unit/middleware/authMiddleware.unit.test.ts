/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
process.env.JWT_SECRETKEY = 'test-secret';

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import {
    globalAuth,
    authenticateJWT,
    hasAuthority,
    isOwn,
} from '~/middleware/authMiddleware.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { Model } from 'mongoose';

describe('Auth Middleware', () => {
    let mockReq: any;
    let mockRes: Partial<Response>;
    let nextFn: jest.Mock;
    let jwtVerifySpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        mockReq = {
            method: 'GET',
            path: '/api/users/123',
            headers: {},
            params: {},
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        nextFn = jest.fn();

        jwtVerifySpy = jest.spyOn(jwt, 'verify');
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        jwtVerifySpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    describe('globalAuth', () => {
        it('should call next() if endpoint is public (exact match)', () => {
            mockReq.method = 'POST';
            mockReq.path = '/auth/login';
            globalAuth(mockReq as Request, mockRes as Response, nextFn);
            expect(nextFn).toHaveBeenCalled();
            expect(jwtVerifySpy).not.toHaveBeenCalled();
        });

        it('should call next() if endpoint is public (wildcard pattern)', () => {
            mockReq.method = 'GET';
            mockReq.path = '/api/users/profile';
            globalAuth(mockReq as Request, mockRes as Response, nextFn);
            expect(nextFn).toHaveBeenCalled();
            expect(jwtVerifySpy).not.toHaveBeenCalled();
        });

        it('should call next() if endpoint is public (ALL method pattern)', () => {
            mockReq.method = 'PUT';
            mockReq.path = '/api/users/update';
            globalAuth(mockReq as Request, mockRes as Response, nextFn);
            expect(nextFn).toHaveBeenCalled();
            expect(jwtVerifySpy).not.toHaveBeenCalled();
        });

        it('should delegate to authenticateJWT if endpoint is not public', () => {
            mockReq.method = 'GET';
            mockReq.path = '/api/private-data'; // Not in PUBLIC_ENDPOINTS
            mockReq.headers = { authorization: 'Bearer valid-token' };
            jwtVerifySpy.mockReturnValue({
                userId: 'id1',
                sub: 'user@abc.com',
                scope: 'user',
            });

            globalAuth(mockReq as Request, mockRes as Response, nextFn);

            expect(jwtVerifySpy).toHaveBeenCalledWith(
                'valid-token',
                'test-secret'
            );
            expect(nextFn).toHaveBeenCalled();
            expect((mockReq as any).user).toEqual({
                id: 'id1',
                email: 'user@abc.com',
                scope: 'user',
            });
        });
    });

    describe('authenticateJWT', () => {
        it.each([
            ['missing header', undefined],
            ['no Bearer prefix', 'token123'],
        ])('should return 401 if %s', (_, authHeader) => {
            mockReq.headers = { authorization: authHeader };
            authenticateJWT(mockReq as Request, mockRes as Response, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(401);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Missing or invalid Authorization header',
                })
            );
            expect(nextFn).not.toHaveBeenCalled();
        });

        it('should handle token with missing fields in payload', () => {
            mockReq.headers = { authorization: 'Bearer valid-token' };
            jwtVerifySpy.mockReturnValue({}); // Missing userId, sub, scope
            authenticateJWT(mockReq as Request, mockRes as Response, nextFn);
            expect(nextFn).toHaveBeenCalled();
            expect((mockReq as any).user).toEqual({
                id: '',
                email: '',
                scope: '',
            });
        });

        it('should return 403 if jwt.verify throws error', () => {
            mockReq.headers = { authorization: 'Bearer invalid-token' };
            jwtVerifySpy.mockImplementation(() => {
                throw new Error('Expired');
            });
            authenticateJWT(mockReq as Request, mockRes as Response, nextFn);
            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Invalid or expired token' })
            );
            expect(nextFn).not.toHaveBeenCalled();
        });
    });

    describe('hasAuthority', () => {
        it('should return 403 if req.user is undefined', () => {
            const middleware = hasAuthority('admin');
            middleware(mockReq as Request, mockRes as Response, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Forbidden' })
            );
            expect(nextFn).not.toHaveBeenCalled();
        });

        it('should return 403 if req.user has no scope', () => {
            mockReq.user = { id: '1' } as any;
            const middleware = hasAuthority('admin');
            middleware(mockReq as Request, mockRes as Response, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Forbidden' })
            );
            expect(nextFn).not.toHaveBeenCalled();
        });

        it('should return 403 if user scope is not in allowed roles', () => {
            mockReq.user = { id: '1', scope: 'user' } as any;
            const middleware = hasAuthority('admin');
            middleware(mockReq as Request, mockRes as Response, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Insufficient permission' })
            );
            expect(nextFn).not.toHaveBeenCalled();
        });

        it('should call next() if user scope is allowed', () => {
            mockReq.user = { id: '1', scope: 'admin' } as any;
            const middleware = hasAuthority('user', 'admin');
            middleware(mockReq as Request, mockRes as Response, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });
    });

    describe('isOwn', () => {
        let mockModel: any;
        let selectMock: jest.Mock;

        beforeEach(() => {
            selectMock = jest.fn();
            mockModel = {
                findById: jest.fn().mockReturnValue({ select: selectMock }),
            };
        });

        it('should throw UNAUTHORIZED if user is not authenticated', async () => {
            const middleware = isOwn(mockModel as Model<unknown>);
            await expect(
                middleware(mockReq as Request, mockRes as Response, nextFn)
            ).rejects.toMatchObject({
                status: ErrorMessage.UNAUTHORIZED.status,
                message: ErrorMessage.UNAUTHORIZED.message,
            });
            expect(nextFn).not.toHaveBeenCalled();
        });

        it('should throw NOTFOUND if document is not found', async () => {
            mockReq.user = { id: 'user1' } as any;
            mockReq.params = { id: 'doc1' };
            selectMock.mockResolvedValue(null);

            const middleware = isOwn(mockModel as Model<unknown>);
            await expect(
                middleware(mockReq as Request, mockRes as Response, nextFn)
            ).rejects.toMatchObject({
                status: ErrorMessage.NOTFOUND.status,
                message: ErrorMessage.NOTFOUND.message,
            });
            expect(mockModel.findById).toHaveBeenCalledWith('doc1');
            expect(nextFn).not.toHaveBeenCalled();
        });

        it('should throw PERMISSION_DENIED if createBy does not match user id', async () => {
            mockReq.user = { id: 'user1' } as any;
            mockReq.params = { docIdParam: 'doc1' };
            selectMock.mockResolvedValue({ createBy: 'user2' });

            const middleware = isOwn(mockModel as Model<unknown>, 'docIdParam');
            await expect(
                middleware(mockReq as Request, mockRes as Response, nextFn)
            ).rejects.toMatchObject({
                status: ErrorMessage.PERMISSION_DENIED.status,
                message: ErrorMessage.PERMISSION_DENIED.message,
            });
            expect(mockModel.findById).toHaveBeenCalledWith('doc1');
            expect(nextFn).not.toHaveBeenCalled();
        });

        it('should call next() if createBy matches user id', async () => {
            mockReq.user = { id: 'user1' } as any;
            mockReq.params = { id: 'doc1' };
            selectMock.mockResolvedValue({ createBy: 'user1' });

            const middleware = isOwn(mockModel as Model<unknown>);
            await middleware(mockReq as Request, mockRes as Response, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });
    });
});
