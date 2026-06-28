/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit Tests for AuthService
 *
 * Coverage target:
 *  - authService.login()      → input validation, DB lookup, bcrypt compare, token return
 *  - authService.generateToken() → JWT payload shape, algorithm & expiry options
 *
 * Mocking strategy:
 *  - bcryptjs            → jest.mock (no real hashing)
 *  - jsonwebtoken        → jest.spyOn on jwt.sign (ESM-safe approach)
 *  - ~/models/userModel  → jest.mock (no real DB calls)
 *  - ApiError            → NOT mocked – real implementation so instanceof / status checks work
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authService } from '~/services/authService.js';
import { User } from '~/models/userModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

// ──────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────
jest.mock('bcryptjs');
jest.mock('~/models/userModel.js');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;
const mockedUser = User as jest.Mocked<typeof User>;

// ──────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────
const VALID_EMAIL = 'user@example.com';
const VALID_PASSWORD = 'password123';
const HASHED_PASSWORD = '$2a$10$hashedpassword';
const MOCK_TOKEN = 'mocked.jwt.token';
const MOCK_USER_ID = '60f8e8b4e7c8e8b4e7c8e8b4';

function buildMockUser(overrides: Record<string, unknown> = {}) {
    return {
        _id: { toString: () => MOCK_USER_ID },
        email: VALID_EMAIL,
        password: HASHED_PASSWORD,
        isDeleted: false,
        role: 'user',
        ...overrides,
    };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────
describe('AuthService', () => {
    let jwtSignSpy: jest.SpyInstance;

    beforeAll(() => {
        process.env.JWT_SECRETKEY = 'test-secret-key';
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // jwt.sign spy – returns a predictable token by default
        jwtSignSpy = jest.spyOn(jwt, 'sign').mockReturnValue(MOCK_TOKEN as any);

        // Default: active user found in DB
        (mockedUser.findOne as any) = jest
            .fn()
            .mockResolvedValue(buildMockUser());

        // Default: password matches
        (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true as never);
    });

    afterEach(() => {
        jwtSignSpy.mockRestore();
    });

    // ════════════════════════════════════════════
    // login() – email validation
    // ════════════════════════════════════════════
    describe('login – email validation', () => {
        it.each([
            ['null', null as any],
            ['undefined', undefined as any],
            ['empty string', ''],
            ['no @ symbol', 'invalidemail'],
            ['no domain', 'user@'],
            ['no TLD', 'user@domain'],
            ['spaces in email', 'user @example.com'],
        ])('should throw ApiError for %s email', async (_, email) => {
            await expect(
                authService.login(email, VALID_PASSWORD)
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw EMAIL_INVALID message and status', async () => {
            await expect(
                authService.login('not-an-email', VALID_PASSWORD)
            ).rejects.toMatchObject({
                status: ErrorMessage.EMAIL_INVALID.status,
                message: ErrorMessage.EMAIL_INVALID.message,
            });
        });

        it('should not call User.findOne when email is invalid', async () => {
            await authService.login('bad-email', VALID_PASSWORD).catch(() => {
                /* expected */
            });
            expect(mockedUser.findOne).not.toHaveBeenCalled();
        });
    });

    // ════════════════════════════════════════════
    // login() – password validation
    // ════════════════════════════════════════════
    describe('login – password validation', () => {
        it.each([
            ['null', null as any],
            ['undefined', undefined as any],
            ['empty string', ''],
            ['7 chars (< minimum 8)', 'pass123'],
            ['single char', 'a'],
        ])('should throw ApiError for %s password', async (_, password) => {
            await expect(
                authService.login(VALID_EMAIL, password)
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw PASSWORD_MUST_BE_8_CHARACTERS message and status', async () => {
            await expect(
                authService.login(VALID_EMAIL, 'short')
            ).rejects.toMatchObject({
                status: ErrorMessage.PASSWORD_MUST_BE_8_CHARACTERS.status,
                message: ErrorMessage.PASSWORD_MUST_BE_8_CHARACTERS.message,
            });
        });

        it('should not call User.findOne when password is invalid', async () => {
            await authService.login(VALID_EMAIL, 'bad').catch(() => {
                /* expected */
            });
            expect(mockedUser.findOne).not.toHaveBeenCalled();
        });

        it('should NOT throw for password of exactly 8 characters', async () => {
            await expect(
                authService.login(VALID_EMAIL, '12345678')
            ).resolves.toBeDefined();
        });

        it('should NOT throw for a long password', async () => {
            await expect(
                authService.login(VALID_EMAIL, 'a'.repeat(64))
            ).resolves.toBeDefined();
        });
    });

    // ════════════════════════════════════════════
    // login() – user lookup
    // ════════════════════════════════════════════
    describe('login – user lookup', () => {
        it('should call User.findOne with the provided email', async () => {
            await authService.login(VALID_EMAIL, VALID_PASSWORD);

            expect(mockedUser.findOne).toHaveBeenCalledTimes(1);
            expect(mockedUser.findOne).toHaveBeenCalledWith({
                email: VALID_EMAIL,
            });
        });

        it('should throw USER_NOT_FOUND when user does not exist', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(null);

            await expect(
                authService.login(VALID_EMAIL, VALID_PASSWORD)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        it('should throw ApiError (instanceof) when user not found', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(null);
            await expect(
                authService.login(VALID_EMAIL, VALID_PASSWORD)
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw USER_HAS_BEEN_DELETED when user is soft-deleted', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildMockUser({ isDeleted: true })
            );

            await expect(
                authService.login(VALID_EMAIL, VALID_PASSWORD)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_HAS_BEEN_DELETED.status,
                message: ErrorMessage.USER_HAS_BEEN_DELETED.message,
            });
        });

        it('should not call bcrypt.compare when user is deleted', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildMockUser({ isDeleted: true })
            );
            await authService.login(VALID_EMAIL, VALID_PASSWORD).catch(() => {
                /* expected */
            });
            expect(mockedBcrypt.compare).not.toHaveBeenCalled();
        });
    });

    // ════════════════════════════════════════════
    // login() – password verification
    // ════════════════════════════════════════════
    describe('login – password verification', () => {
        it('should call bcrypt.compare with the raw password and stored hash', async () => {
            await authService.login(VALID_EMAIL, VALID_PASSWORD);

            expect(mockedBcrypt.compare).toHaveBeenCalledTimes(1);
            expect(mockedBcrypt.compare).toHaveBeenCalledWith(
                VALID_PASSWORD,
                HASHED_PASSWORD
            );
        });

        it('should throw PASSWORD_INCORECT when bcrypt returns false', async () => {
            (mockedBcrypt.compare as jest.Mock).mockResolvedValue(
                false as never
            );

            await expect(
                authService.login(VALID_EMAIL, VALID_PASSWORD)
            ).rejects.toMatchObject({
                status: ErrorMessage.PASSWORD_INCORECT.status,
                message: ErrorMessage.PASSWORD_INCORECT.message,
            });
        });

        it('should not call jwt.sign when password is wrong', async () => {
            (mockedBcrypt.compare as jest.Mock).mockResolvedValue(
                false as never
            );
            await authService.login(VALID_EMAIL, VALID_PASSWORD).catch(() => {
                /* expected */
            });
            expect(jwtSignSpy).not.toHaveBeenCalled();
        });
    });

    // ════════════════════════════════════════════
    // login() – successful flow
    // ════════════════════════════════════════════
    describe('login – successful flow', () => {
        it('should return { token, authenticated: true } on valid credentials', async () => {
            const result = await authService.login(VALID_EMAIL, VALID_PASSWORD);

            expect(result).toEqual({
                token: MOCK_TOKEN,
                authenticated: true,
            });
        });

        it('should return authenticated === true (always)', async () => {
            const result = await authService.login(VALID_EMAIL, VALID_PASSWORD);
            expect(result.authenticated).toBe(true);
        });

        it('should call generateToken with the user document', async () => {
            const mockUser = buildMockUser();
            (mockedUser.findOne as jest.Mock).mockResolvedValue(mockUser);
            const genTokenSpy = jest.spyOn(authService, 'generateToken');

            await authService.login(VALID_EMAIL, VALID_PASSWORD);

            expect(genTokenSpy).toHaveBeenCalledWith(mockUser);
            genTokenSpy.mockRestore();
        });

        it('should return the token produced by generateToken', async () => {
            const genTokenSpy = jest
                .spyOn(authService, 'generateToken')
                .mockReturnValue('custom-token');

            const result = await authService.login(VALID_EMAIL, VALID_PASSWORD);
            expect(result.token).toBe('custom-token');

            genTokenSpy.mockRestore();
        });

        it('should not expose user data (password, _id, etc.) in the result', async () => {
            const result = await authService.login(VALID_EMAIL, VALID_PASSWORD);
            expect(result).not.toHaveProperty('password');
            expect(result).not.toHaveProperty('user');
            expect(result).not.toHaveProperty('_id');
        });
    });

    // ════════════════════════════════════════════
    // login() – valid email boundary
    // ════════════════════════════════════════════
    describe('login – valid email boundaries', () => {
        it('should accept subdomain email', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildMockUser({ email: 'user@sub.example.com' })
            );
            await expect(
                authService.login('user@sub.example.com', VALID_PASSWORD)
            ).resolves.toBeDefined();
        });

        it('should accept email with plus sign', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildMockUser({ email: 'user+tag@example.com' })
            );
            await expect(
                authService.login('user+tag@example.com', VALID_PASSWORD)
            ).resolves.toBeDefined();
        });
    });

    // ════════════════════════════════════════════
    // generateToken()
    // ════════════════════════════════════════════
    describe('generateToken', () => {
        it('should return the value produced by jwt.sign', () => {
            const mockUser = buildMockUser() as any;
            jwtSignSpy.mockReturnValue('gen-token' as any);

            const token = authService.generateToken(mockUser);
            expect(token).toBe('gen-token');
        });

        it('should call jwt.sign exactly once', () => {
            authService.generateToken(buildMockUser() as any);
            expect(jwtSignSpy).toHaveBeenCalledTimes(1);
        });

        it('should embed sub = user.email in payload', () => {
            authService.generateToken(buildMockUser() as any);
            const [payload] = jwtSignSpy.mock.calls[0];
            expect(payload.sub).toBe(VALID_EMAIL);
        });

        it('should embed iss = "https://toeic.mkhoavo.site" in payload', () => {
            authService.generateToken(buildMockUser() as any);
            const [payload] = jwtSignSpy.mock.calls[0];
            expect(payload.iss).toBe('https://toeic.mkhoavo.site');
        });

        it('should embed scope = user.role in payload', () => {
            authService.generateToken(buildMockUser({ role: 'admin' }) as any);
            const [payload] = jwtSignSpy.mock.calls[0];
            expect(payload.scope).toBe('admin');
        });

        it('should embed userId = user._id.toString() in payload', () => {
            authService.generateToken(buildMockUser() as any);
            const [payload] = jwtSignSpy.mock.calls[0];
            expect(payload.userId).toBe(MOCK_USER_ID);
        });

        it('should embed custom_key = "Custom_value" in payload', () => {
            authService.generateToken(buildMockUser() as any);
            const [payload] = jwtSignSpy.mock.calls[0];
            expect(payload.custom_key).toBe('Custom_value');
        });

        it('should sign with authService.SECRET_KEY as the secret', () => {
            // authService.SECRET_KEY is assigned at class instantiation (module import time).
            // We verify jwt.sign receives exactly what the service holds, regardless of
            // when the env variable was set relative to the import.
            authService.generateToken(buildMockUser() as any);
            const [, secretKey] = jwtSignSpy.mock.calls[0];
            expect(secretKey).toBe(authService.SECRET_KEY);
        });

        it('should sign with algorithm HS512', () => {
            authService.generateToken(buildMockUser() as any);
            const [, , options] = jwtSignSpy.mock.calls[0];
            expect(options.algorithm).toBe('HS512');
        });

        it('should set expiresIn to "30d"', () => {
            authService.generateToken(buildMockUser() as any);
            const [, , options] = jwtSignSpy.mock.calls[0];
            expect(options.expiresIn).toBe('30d');
        });

        it('should use empty string as scope when role is undefined', () => {
            authService.generateToken(
                buildMockUser({ role: undefined }) as any
            );
            const [payload] = jwtSignSpy.mock.calls[0];
            expect(payload.scope).toBe('');
        });

        it('should use empty string as scope when role is null', () => {
            authService.generateToken(buildMockUser({ role: null }) as any);
            const [payload] = jwtSignSpy.mock.calls[0];
            expect(payload.scope).toBe('');
        });

        it('should call _id.toString() to get the userId', () => {
            const customId = 'custom-user-id-abc';
            const mockUser = buildMockUser({
                _id: { toString: () => customId },
            }) as any;
            authService.generateToken(mockUser);
            const [payload] = jwtSignSpy.mock.calls[0];
            expect(payload.userId).toBe(customId);
        });
    });

    // ════════════════════════════════════════════
    // login → generateToken integration
    // ════════════════════════════════════════════
    describe('login → generateToken integration (JWT payload propagation)', () => {
        it('should propagate user role into JWT scope via generateToken', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildMockUser({ role: 'admin' })
            );
            await authService.login(VALID_EMAIL, VALID_PASSWORD);

            const [payload] = jwtSignSpy.mock.calls[0];
            expect(payload.scope).toBe('admin');
        });

        it('should propagate user._id into JWT userId via generateToken', async () => {
            const specificId = 'specific-user-id-999';
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildMockUser({ _id: { toString: () => specificId } })
            );
            await authService.login(VALID_EMAIL, VALID_PASSWORD);

            const [payload] = jwtSignSpy.mock.calls[0];
            expect(payload.userId).toBe(specificId);
        });

        it('should propagate user email into JWT sub via generateToken', async () => {
            const specificEmail = 'specific@example.com';
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildMockUser({ email: specificEmail })
            );
            await authService.login(specificEmail, VALID_PASSWORD);

            const [payload] = jwtSignSpy.mock.calls[0];
            expect(payload.sub).toBe(specificEmail);
        });
    });
});
