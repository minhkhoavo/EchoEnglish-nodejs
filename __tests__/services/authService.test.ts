/* eslint-disable @typescript-eslint/no-explicit-any */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authService } from '~/services/authService.js';
import { User } from '~/models/userModel.js';
import { ApiError } from '~/middleware/apiError.js';

// Mock dependencies
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');
jest.mock('~/models/userModel.js');
jest.mock('~/middleware/apiError.js');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;
const mockedJwt = jwt as jest.Mocked<typeof jwt>;
const mockedUser = User as jest.Mocked<typeof User>;
const mockedApiError = ApiError as jest.MockedClass<typeof ApiError>;

describe('AuthService', () => {
    let mockUser: any;

    beforeAll(() => {
        process.env.JWT_SECRETKEY = 'test-secret-key';
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock user
        mockUser = {
            _id: 'user-id-123',
            email: 'test@example.com',
            password: 'hashed-password',
            isDeleted: false,
            roles: [{ name: 'user' }, { name: 'admin' }],
        };

        // Mock ApiError to throw
        (mockedApiError as any).mockImplementation((message: any) => {
            throw new Error(message);
        });

        // Mock User.findOne with populate chain
        (mockedUser.findOne as any) = jest.fn().mockReturnValue({
            populate: jest.fn().mockResolvedValue(mockUser),
        });
    });

    describe('login', () => {
        it('should throw error for null email', async () => {
            await expect(
                authService.login(null as any, 'password123')
            ).rejects.toThrow();
        });

        it('should throw error for undefined email', async () => {
            await expect(
                authService.login(undefined as any, 'password123')
            ).rejects.toThrow();
        });

        it('should throw error for invalid email', async () => {
            await expect(
                authService.login('invalid-email', 'password123')
            ).rejects.toThrow();
        });

        it('should throw error for password less than 8 characters', async () => {
            await expect(
                authService.login('test@example.com', 'short')
            ).rejects.toThrow();
        });

        it('should throw error for null password', async () => {
            await expect(
                authService.login('test@example.com', null as any)
            ).rejects.toThrow();
        });

        it('should throw error for undefined password', async () => {
            await expect(
                authService.login('test@example.com', undefined as any)
            ).rejects.toThrow();
        });

        it('should throw error when user not found', async () => {
            (mockedUser.findOne as any).mockReturnValue({
                populate: jest.fn().mockResolvedValue(null),
            });

            await expect(
                authService.login('test@example.com', 'password123')
            ).rejects.toThrow();
        });

        it('should throw error when user is deleted', async () => {
            const deletedUser = { ...mockUser, isDeleted: true };
            (mockedUser.findOne as any).mockReturnValue({
                populate: jest.fn().mockResolvedValue(deletedUser),
            });

            await expect(
                authService.login('test@example.com', 'password123')
            ).rejects.toThrow();
        });

        it('should throw error for incorrect password', async () => {
            mockedBcrypt.compare = jest.fn().mockResolvedValue(false);

            await expect(
                authService.login('test@example.com', 'wrongpassword')
            ).rejects.toThrow();
        });

        it('should return token and authenticated true for valid login', async () => {
            mockedBcrypt.compare = jest.fn().mockResolvedValue(true);
            mockedJwt.sign = jest.fn().mockReturnValue('mocked-jwt-token');

            const result = await authService.login(
                'test@example.com',
                'password123'
            );

            expect(result).toEqual({
                token: 'mocked-jwt-token',
                authenticated: true,
            });
            expect(mockedJwt.sign).toHaveBeenCalled();
            const callArgs = (mockedJwt.sign as jest.Mock).mock.calls[0];
            expect(callArgs[0]).toMatchObject({
                sub: 'test@example.com',
                iss: 'https://echo-english.com',
                scope: 'user admin',
                userId: 'user-id-123',
            });
            expect(callArgs[2]).toEqual({
                algorithm: 'HS512',
                expiresIn: '30d',
            });
        });
    });
});
