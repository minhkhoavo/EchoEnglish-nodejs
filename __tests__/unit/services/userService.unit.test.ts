/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit Tests for UserService
 *
 * Covers all public methods:
 *  - getUserById, getProfile
 *  - registerUser (email/password validation + all existUser branches + new user creation)
 *  - createUser
 *  - hashPassword
 *  - resetPasswordWithOtp
 *  - updateUser, updateProfileUser
 *  - softDelete
 *  - getAllUsers (field selection, search, gender, sort options, pagination)
 *  - getUserPreference, setUserPreferences
 *  - restoreUser
 *
 * Mocking strategy (ESM-safe — from KI skill_rules.md):
 *  - bcrypt, User model  → jest.mock() auto-mock
 *  - OtpEmailService, CategoryFlashcardService → jest.mock() auto-mock;
 *    prototype methods are replaced in beforeEach to control behavior per test
 *  - PaginationHelper → jest.mock() auto-mock
 *  - ApiError → NOT mocked (keep real for instanceof checks)
 */

import bcrypt from 'bcrypt';
import { User } from '~/models/userModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import UserService from '~/services/userService.js';
import { OtpEmailService } from '~/services/otpEmailService.js';
import CategoryFlashcardService from '~/services/categoryFlashcardService.js';
import { PaginationHelper } from '~/utils/pagination.js';
import { DeletedReason } from '~/enum/deletedReason.js';
import { OtpPurpose } from '~/enum/otpPurpose.js';

// ──────────────────────────────────────────────
// Module mocks (auto-mock — ESM-safe, no factory variables)
// ──────────────────────────────────────────────
jest.mock('bcrypt');
jest.mock('~/models/userModel.js');
jest.mock('~/services/otpEmailService.js', () => {
    return {
        OtpEmailService: jest.fn().mockImplementation(function (this: any) {
            this.sendOtp = jest.fn();
            this.verifyOtp = jest.fn();
            this.sendOtpEmail = jest.fn();
        }),
    };
});
jest.mock('~/services/categoryFlashcardService.js');
jest.mock('~/utils/pagination.js');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;
const mockedUser = User as jest.Mocked<typeof User>;
const MockedOtpEmailService = OtpEmailService as jest.MockedClass<
    typeof OtpEmailService
>;
const MockedCategoryService = CategoryFlashcardService as jest.MockedClass<
    typeof CategoryFlashcardService
>;

// ──────────────────────────────────────────────
// Access the module-level service singletons.
// These are created ONCE when userService.ts is first imported.
// We capture references here after mocking so we can control their behavior.
// ──────────────────────────────────────────────
// Importing userService.ts triggers the module-level:
//   const otpEmailService = new OtpEmailService();
//   const categoryService = new CategoryFlashcardService();
// The instances are stored in MockedXxx.mock.instances[0].
// We defer access until first test (instances exist by then).
let otpServiceInstance: jest.Mocked<OtpEmailService>;
let categoryServiceInstance: jest.Mocked<CategoryFlashcardService>;

// ──────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────
const MOCK_USER_ID = 'mock-user-id-abc123';
const VALID_EMAIL = 'user@example.com';
const VALID_PASSWORD = 'password123';
const HASHED_PASSWORD = '$2b$10$hashedpassword';

/**
 * Creates a Mongoose-document-like mock with save() and toObject().
 * `save()` resolves to itself by default.
 * `toObject()` returns a plain object (no methods).
 */
function buildDbUser(overrides: Record<string, any> = {}) {
    const base: Record<string, any> = {
        _id: { toString: () => MOCK_USER_ID },
        email: VALID_EMAIL,
        password: HASHED_PASSWORD,
        fullName: 'Test User',
        isDeleted: false,
        deletedReason: null,
        role: 'user',
        preferences: {
            primaryGoal: 'toeic_preparation',
            studyTimePerDay: 30,
            lastUpdated: new Date('2024-01-01'),
        },
        save: jest.fn(),
        toObject: jest.fn(),
        ...overrides,
    };

    // Defaults for document methods
    base.save.mockResolvedValue(base);
    base.toObject.mockReturnValue({
        _id: MOCK_USER_ID,
        email: base.email,
        fullName: base.fullName,
        role: base.role,
        isDeleted: base.isDeleted,
        password: base.password,
        __v: 0,
    });

    return base;
}

/** Helper: returns a mock Mongoose query with .select() chaining */
function queryWith(resolvedValue: any) {
    return { select: jest.fn().mockResolvedValue(resolvedValue) };
}

// ──────────────────────────────────────────────
// Test Suite
// ──────────────────────────────────────────────
describe('UserService', () => {
    let userService: UserService;

    // Capture module-level service singletons in beforeAll (once).
    // These are created when userService.ts is first imported, before any test runs.
    // We must capture them here (before clearAllMocks) because clearAllMocks resets
    // mock.instances[]. The actual instance objects still exist — we just hold references.
    beforeAll(() => {
        // The singleton instances are created as side effects when userService.ts loads.
        // jest.mock() auto-mocks the classes, so instances have jest.fn() for all methods
        // (both prototype methods AND arrow function properties get auto-mocked).
        otpServiceInstance = MockedOtpEmailService.mock
            .instances[0] as jest.Mocked<OtpEmailService>;
        categoryServiceInstance = MockedCategoryService.mock
            .instances[0] as jest.Mocked<CategoryFlashcardService>;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        userService = new UserService();

        // Default bcrypt behavior
        (mockedBcrypt.genSaltSync as jest.Mock).mockReturnValue('mock-salt');
        (mockedBcrypt.hashSync as jest.Mock).mockReturnValue(HASHED_PASSWORD);

        // Re-setup singleton service mock behaviors after clearAllMocks
        // (clearAllMocks resets .mock.calls but NOT implementations)
        // Re-set implementations so they return expected defaults:
        if (otpServiceInstance) {
            (otpServiceInstance.sendOtp as jest.Mock).mockResolvedValue(
                'otp-code'
            );
            (otpServiceInstance.verifyOtp as jest.Mock).mockResolvedValue(
                undefined
            );
        }
        if (categoryServiceInstance) {
            (
                categoryServiceInstance.createCategory as jest.Mock
            ).mockResolvedValue({
                _id: 'cat-id',
                name: 'Uncategorized',
            });
        }
    });

    // ════════════════════════════════════════════
    // getUserById()
    // ════════════════════════════════════════════
    describe('getUserById', () => {
        it('should call User.findOne with {_id, isDeleted: false}', async () => {
            (mockedUser.findOne as jest.Mock).mockReturnValue(
                queryWith(buildDbUser())
            );

            await userService.getUserById(MOCK_USER_ID);

            expect(mockedUser.findOne).toHaveBeenCalledWith({
                _id: MOCK_USER_ID,
                isDeleted: false,
            });
        });

        it('should call .select() to exclude sensitive fields', async () => {
            const selectFn = jest.fn().mockResolvedValue(buildDbUser());
            (mockedUser.findOne as jest.Mock).mockReturnValue({
                select: selectFn,
            });

            await userService.getUserById(MOCK_USER_ID);

            expect(selectFn).toHaveBeenCalledWith('-password -isDeleted -__v');
        });

        it('should throw USER_NOT_FOUND when user does not exist', async () => {
            (mockedUser.findOne as jest.Mock).mockReturnValue(queryWith(null));

            await expect(
                userService.getUserById(MOCK_USER_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        it('should throw ApiError (instanceof) when user not found', async () => {
            (mockedUser.findOne as jest.Mock).mockReturnValue(queryWith(null));

            await expect(
                userService.getUserById(MOCK_USER_ID)
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should return the user document on success', async () => {
            const mockDbUser = buildDbUser();
            (mockedUser.findOne as jest.Mock).mockReturnValue(
                queryWith(mockDbUser)
            );

            const result = await userService.getUserById(MOCK_USER_ID);

            expect(result).toBe(mockDbUser);
        });
    });

    // ════════════════════════════════════════════
    // getProfile()
    // ════════════════════════════════════════════
    describe('getProfile', () => {
        it('should call User.findOne with {email}', async () => {
            (mockedUser.findOne as jest.Mock).mockReturnValue(
                queryWith(buildDbUser())
            );

            await userService.getProfile(VALID_EMAIL);

            expect(mockedUser.findOne).toHaveBeenCalledWith({
                email: VALID_EMAIL,
            });
        });

        it('should throw USER_NOT_FOUND when user is not found', async () => {
            (mockedUser.findOne as jest.Mock).mockReturnValue(queryWith(null));

            await expect(
                userService.getProfile(VALID_EMAIL)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        it('should return the user profile on success', async () => {
            const mockProfile = buildDbUser();
            (mockedUser.findOne as jest.Mock).mockReturnValue(
                queryWith(mockProfile)
            );

            const result = await userService.getProfile(VALID_EMAIL);

            expect(result).toBe(mockProfile);
        });
    });

    // ════════════════════════════════════════════
    // hashPassword()
    // ════════════════════════════════════════════
    describe('hashPassword', () => {
        it('should call genSaltSync with 10 rounds', async () => {
            await userService.hashPassword(VALID_PASSWORD);

            expect(mockedBcrypt.genSaltSync).toHaveBeenCalledWith(10);
        });

        it('should call hashSync with the password and generated salt', async () => {
            await userService.hashPassword(VALID_PASSWORD);

            expect(mockedBcrypt.hashSync).toHaveBeenCalledWith(
                VALID_PASSWORD,
                'mock-salt'
            );
        });

        it('should return the hashed password', async () => {
            const result = await userService.hashPassword(VALID_PASSWORD);

            expect(result).toBe(HASHED_PASSWORD);
        });
    });

    // ════════════════════════════════════════════
    // registerUser()
    // ════════════════════════════════════════════
    describe('registerUser', () => {
        beforeEach(() => {
            // Default: no existing user → create new
            (mockedUser.findOne as jest.Mock).mockResolvedValue(null);
            const mockInstance = buildDbUser();
            (mockedUser as any).mockImplementation(() => mockInstance);
        });

        // ── Email validation ──────────────────────
        it.each([
            ['null', null as any],
            ['undefined', undefined as any],
            ['invalid format (no @)', 'invalidemail'],
            ['spaces in email', 'user @example.com'],
        ])('should throw EMAIL_INVALID for %s email', async (_, email) => {
            await expect(
                userService.registerUser({
                    email,
                    password: VALID_PASSWORD,
                } as any)
            ).rejects.toMatchObject({
                status: ErrorMessage.EMAIL_INVALID.status,
                message: ErrorMessage.EMAIL_INVALID.message,
            });
        });

        it('should not call User.findOne when email is invalid', async () => {
            await userService
                .registerUser({
                    email: 'not-valid',
                    password: VALID_PASSWORD,
                } as any)
                .catch(() => {});

            expect(mockedUser.findOne).not.toHaveBeenCalled();
        });

        // ── Password validation ───────────────────
        it.each([
            ['null', null as any],
            ['undefined', undefined as any],
            ['7 chars (< 8 minimum)', '1234567'],
        ])(
            'should throw PASSWORD_MUST_BE_8_CHARACTERS for %s password',
            async (_, password) => {
                await expect(
                    userService.registerUser({
                        email: VALID_EMAIL,
                        password,
                    } as any)
                ).rejects.toMatchObject({
                    status: ErrorMessage.PASSWORD_MUST_BE_8_CHARACTERS.status,
                    message: ErrorMessage.PASSWORD_MUST_BE_8_CHARACTERS.message,
                });
            }
        );

        // ── Existing user – not deleted ───────────
        it('should throw USER_EXISTED when user exists and is active', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildDbUser({ isDeleted: false })
            );

            await expect(
                userService.registerUser({
                    email: VALID_EMAIL,
                    password: VALID_PASSWORD,
                } as any)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_EXISTED.status,
                message: ErrorMessage.USER_EXISTED.message,
            });
        });

        // ── Existing user – admin deleted ─────────
        it('should throw USER_HAS_BEEN_DELETED when deletedReason is ADMIN_DELETED', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildDbUser({
                    isDeleted: true,
                    deletedReason: DeletedReason.ADMIN_DELETED,
                })
            );

            await expect(
                userService.registerUser({
                    email: VALID_EMAIL,
                    password: VALID_PASSWORD,
                } as any)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_HAS_BEEN_DELETED.status,
                message: ErrorMessage.USER_HAS_BEEN_DELETED.message,
            });
        });

        it('should throw USER_HAS_BEEN_DELETED when user is deleted with no deletedReason', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildDbUser({ isDeleted: true, deletedReason: null })
            );

            await expect(
                userService.registerUser({
                    email: VALID_EMAIL,
                    password: VALID_PASSWORD,
                } as any)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_HAS_BEEN_DELETED.status,
            });
        });

        // ── Existing user – pending verification ──
        it('should update pending user, call sendOtp, and return when PENDING_VERIFICATION', async () => {
            const existingUser = buildDbUser({
                isDeleted: true,
                deletedReason: DeletedReason.PENDING_VERIFICATION,
            });
            (mockedUser.findOne as jest.Mock).mockResolvedValue(existingUser);

            await userService.registerUser({
                email: VALID_EMAIL,
                password: VALID_PASSWORD,
                fullName: 'Updated Name',
                gender: 'male',
                dob: new Date('2000-01-01'),
                phoneNumber: '1234567890',
                address: '123 Main St',
                image: 'image.jpg',
            } as any);

            expect(existingUser.save).toHaveBeenCalledTimes(1);
            expect(existingUser.fullName).toBe('Updated Name');
            expect(existingUser.gender).toBe('male');
            expect(existingUser.phoneNumber).toBe('1234567890');
            expect(existingUser.address).toBe('123 Main St');
            expect(existingUser.image).toBe('image.jpg');
            expect(otpServiceInstance.sendOtp).toHaveBeenCalledWith(
                VALID_EMAIL,
                OtpPurpose.REGISTER
            );
        });

        it('should update password for pending verification user', async () => {
            const existingUser = buildDbUser({
                isDeleted: true,
                deletedReason: DeletedReason.PENDING_VERIFICATION,
            });
            (mockedUser.findOne as jest.Mock).mockResolvedValue(existingUser);

            await userService.registerUser({
                email: VALID_EMAIL,
                password: VALID_PASSWORD,
            } as any);

            expect(existingUser.password).toBe(HASHED_PASSWORD);
        });

        it('should NOT call createCategory for pending verification re-register', async () => {
            const existingUser = buildDbUser({
                isDeleted: true,
                deletedReason: DeletedReason.PENDING_VERIFICATION,
            });
            (mockedUser.findOne as jest.Mock).mockResolvedValue(existingUser);

            await userService.registerUser({
                email: VALID_EMAIL,
                password: VALID_PASSWORD,
            } as any);

            expect(
                MockedCategoryService.prototype.createCategory
            ).not.toHaveBeenCalled();
        });

        it('should fall through to new user creation if deleted reason is other than pending or admin deleted', async () => {
            const existingUser = buildDbUser({
                isDeleted: true,
                deletedReason: 'SOME_OTHER_REASON' as any,
            });
            (mockedUser.findOne as jest.Mock).mockResolvedValue(existingUser);

            const mockInstance = buildDbUser();
            (mockedUser as any).mockImplementation(() => mockInstance);

            const result = await userService.registerUser({
                email: VALID_EMAIL,
                password: VALID_PASSWORD,
            } as any);

            expect(result).toBeDefined();
        });

        // ── New user creation ─────────────────────
        it('should save, send OTP, and create default category for new user', async () => {
            const mockInstance = buildDbUser();
            (mockedUser as any).mockImplementation(() => mockInstance);

            await userService.registerUser({
                email: VALID_EMAIL,
                password: VALID_PASSWORD,
                fullName: 'New User',
            } as any);

            expect(mockInstance.save).toHaveBeenCalledTimes(1);
            expect(otpServiceInstance.sendOtp).toHaveBeenCalledWith(
                VALID_EMAIL,
                OtpPurpose.REGISTER
            );
            expect(categoryServiceInstance.createCategory).toHaveBeenCalledWith(
                {
                    name: 'Uncategorized',
                    description:
                        'Default category for uncategorized flashcards',
                    is_default: true,
                },
                MOCK_USER_ID
            );
        });

        it('should create new user with isDeleted=true (pending verification state)', async () => {
            const capturedConstructorArgs: any[] = [];
            (mockedUser as any).mockImplementation((args: any) => {
                capturedConstructorArgs.push(args);
                return buildDbUser();
            });

            await userService.registerUser({
                email: VALID_EMAIL,
                password: VALID_PASSWORD,
            } as any);

            expect(capturedConstructorArgs[0]).toMatchObject({
                isDeleted: true,
                deletedReason: DeletedReason.PENDING_VERIFICATION,
            });
        });

        it('should return user without password, isDeleted, __v', async () => {
            const result = await userService.registerUser({
                email: VALID_EMAIL,
                password: VALID_PASSWORD,
            } as any);

            expect(result).not.toHaveProperty('password');
            expect(result).not.toHaveProperty('isDeleted');
            expect(result).not.toHaveProperty('__v');
        });
    });

    // ════════════════════════════════════════════
    // createUser()
    // ════════════════════════════════════════════
    describe('createUser', () => {
        beforeEach(() => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(null);
            (mockedUser as any).mockImplementation(() => buildDbUser());
        });

        it('should throw USER_EXISTED when active user already exists', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildDbUser({ isDeleted: false })
            );

            await expect(
                userService.createUser({
                    email: VALID_EMAIL,
                    password: VALID_PASSWORD,
                } as any)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_EXISTED.status,
                message: ErrorMessage.USER_EXISTED.message,
            });
        });

        it('should restore and save soft-deleted user instead of creating new', async () => {
            const existingUser = buildDbUser({ isDeleted: true });
            (mockedUser.findOne as jest.Mock).mockResolvedValue(existingUser);

            await userService.createUser({
                email: VALID_EMAIL,
                password: VALID_PASSWORD,
            } as any);

            expect(existingUser.isDeleted).toBe(false);
            expect(existingUser.password).toBe(HASHED_PASSWORD);
            expect(existingUser.save).toHaveBeenCalledTimes(1);
        });

        it('should NOT call createCategory when restoring a deleted user', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildDbUser({ isDeleted: true })
            );

            await userService.createUser({
                email: VALID_EMAIL,
                password: VALID_PASSWORD,
            } as any);

            expect(
                MockedCategoryService.prototype.createCategory
            ).not.toHaveBeenCalled();
        });

        it('should save new user and create default category', async () => {
            const mockInstance = buildDbUser();
            (mockedUser as any).mockImplementation(() => mockInstance);

            await userService.createUser({
                email: VALID_EMAIL,
                password: VALID_PASSWORD,
            } as any);

            expect(mockInstance.save).toHaveBeenCalledTimes(1);
            expect(categoryServiceInstance.createCategory).toHaveBeenCalledWith(
                {
                    name: 'Uncategorized',
                    description:
                        'Default category for uncategorized flashcards',
                    is_default: true,
                },
                MOCK_USER_ID
            );
        });

        it('should return new user without password, isDeleted, __v', async () => {
            const result = await userService.createUser({
                email: VALID_EMAIL,
                password: VALID_PASSWORD,
            } as any);

            expect(result).not.toHaveProperty('password');
            expect(result).not.toHaveProperty('isDeleted');
            expect(result).not.toHaveProperty('__v');
        });
    });

    // ════════════════════════════════════════════
    // resetPasswordWithOtp()
    // ════════════════════════════════════════════
    describe('resetPasswordWithOtp', () => {
        const NEW_PASSWORD = 'newpassword123';
        const OTP_CODE = '123456';

        beforeEach(() => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(buildDbUser());
        });

        it('should call verifyOtp with email, otp, and FORGOT_PASSWORD purpose', async () => {
            await userService.resetPasswordWithOtp(
                VALID_EMAIL,
                NEW_PASSWORD,
                OTP_CODE
            );

            expect(otpServiceInstance.verifyOtp).toHaveBeenCalledWith(
                VALID_EMAIL,
                OTP_CODE,
                OtpPurpose.FORGOT_PASSWORD
            );
        });

        it('should call User.findOne with {email, isDeleted: false}', async () => {
            await userService.resetPasswordWithOtp(
                VALID_EMAIL,
                NEW_PASSWORD,
                OTP_CODE
            );

            expect(mockedUser.findOne).toHaveBeenCalledWith({
                email: VALID_EMAIL,
                isDeleted: false,
            });
        });

        it('should throw USER_NOT_FOUND when user does not exist', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(null);

            await expect(
                userService.resetPasswordWithOtp(
                    VALID_EMAIL,
                    NEW_PASSWORD,
                    OTP_CODE
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
            });
        });

        it('should hash the new password', async () => {
            await userService.resetPasswordWithOtp(
                VALID_EMAIL,
                NEW_PASSWORD,
                OTP_CODE
            );

            expect(mockedBcrypt.hashSync).toHaveBeenCalledWith(
                NEW_PASSWORD,
                'mock-salt'
            );
        });

        it('should update user password with the hashed value and save', async () => {
            const mockDbUser = buildDbUser();
            (mockedUser.findOne as jest.Mock).mockResolvedValue(mockDbUser);

            await userService.resetPasswordWithOtp(
                VALID_EMAIL,
                NEW_PASSWORD,
                OTP_CODE
            );

            expect(mockDbUser.password).toBe(HASHED_PASSWORD);
            expect(mockDbUser.save).toHaveBeenCalledTimes(1);
        });

        it('should propagate errors from verifyOtp (e.g. OTP invalid)', async () => {
            (otpServiceInstance.verifyOtp as jest.Mock).mockRejectedValue(
                new ApiError(ErrorMessage.OTP_INVALID)
            );

            await expect(
                userService.resetPasswordWithOtp(
                    VALID_EMAIL,
                    NEW_PASSWORD,
                    OTP_CODE
                )
            ).rejects.toBeInstanceOf(ApiError);
        });
    });

    // ════════════════════════════════════════════
    // updateUser()
    // ════════════════════════════════════════════
    describe('updateUser', () => {
        const UPDATE_REQUEST = { fullName: 'Updated Name' };

        it('should call User.findOneAndUpdate with {_id, isDeleted:false} and options', async () => {
            (mockedUser.findOneAndUpdate as jest.Mock).mockReturnValue(
                queryWith(buildDbUser(UPDATE_REQUEST))
            );

            await userService.updateUser(MOCK_USER_ID, UPDATE_REQUEST as any);

            expect(mockedUser.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: MOCK_USER_ID, isDeleted: false },
                UPDATE_REQUEST,
                { new: true, runValidators: true }
            );
        });

        it('should call .select() to exclude sensitive fields', async () => {
            const selectFn = jest.fn().mockResolvedValue(buildDbUser());
            (mockedUser.findOneAndUpdate as jest.Mock).mockReturnValue({
                select: selectFn,
            });

            await userService.updateUser(MOCK_USER_ID, UPDATE_REQUEST as any);

            expect(selectFn).toHaveBeenCalledWith('-password -isDeleted -__v');
        });

        it('should throw USER_NOT_FOUND when user does not exist', async () => {
            (mockedUser.findOneAndUpdate as jest.Mock).mockReturnValue(
                queryWith(null)
            );

            await expect(
                userService.updateUser(MOCK_USER_ID, UPDATE_REQUEST as any)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        it('should return the updated user document', async () => {
            const updatedUser = buildDbUser(UPDATE_REQUEST);
            (mockedUser.findOneAndUpdate as jest.Mock).mockReturnValue(
                queryWith(updatedUser)
            );

            const result = await userService.updateUser(
                MOCK_USER_ID,
                UPDATE_REQUEST as any
            );

            expect(result).toBe(updatedUser);
        });
    });

    // ════════════════════════════════════════════
    // updateProfileUser()
    // ════════════════════════════════════════════
    describe('updateProfileUser', () => {
        const PROFILE_UPDATE = { fullName: 'New Name' };

        it('should call User.findOneAndUpdate with {_id, isDeleted:false}', async () => {
            (mockedUser.findOneAndUpdate as jest.Mock).mockReturnValue(
                queryWith(buildDbUser(PROFILE_UPDATE))
            );

            await userService.updateProfileUser(
                MOCK_USER_ID,
                PROFILE_UPDATE as any
            );

            expect(mockedUser.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: MOCK_USER_ID, isDeleted: false },
                PROFILE_UPDATE,
                { new: true, runValidators: true }
            );
        });

        it('should throw USER_NOT_FOUND when user does not exist', async () => {
            (mockedUser.findOneAndUpdate as jest.Mock).mockReturnValue(
                queryWith(null)
            );

            await expect(
                userService.updateProfileUser(
                    MOCK_USER_ID,
                    PROFILE_UPDATE as any
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
            });
        });

        it('should return the updated profile', async () => {
            const updatedProfile = buildDbUser(PROFILE_UPDATE);
            (mockedUser.findOneAndUpdate as jest.Mock).mockReturnValue(
                queryWith(updatedProfile)
            );

            const result = await userService.updateProfileUser(
                MOCK_USER_ID,
                PROFILE_UPDATE as any
            );

            expect(result).toBe(updatedProfile);
        });
    });

    // ════════════════════════════════════════════
    // softDelete()
    // ════════════════════════════════════════════
    describe('softDelete', () => {
        it('should throw USER_NOT_FOUND when user does not exist', async () => {
            (mockedUser.findById as jest.Mock).mockResolvedValue(null);

            await expect(
                userService.softDelete(MOCK_USER_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
            });
        });

        it('should throw USER_NOT_FOUND when user is already deleted', async () => {
            (mockedUser.findById as jest.Mock).mockResolvedValue(
                buildDbUser({ isDeleted: true })
            );

            await expect(
                userService.softDelete(MOCK_USER_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
            });
        });

        it('should set isDeleted=true on the user', async () => {
            const mockDbUser = buildDbUser({ isDeleted: false });
            (mockedUser.findById as jest.Mock).mockResolvedValue(mockDbUser);

            await userService.softDelete(MOCK_USER_ID);

            expect(mockDbUser.isDeleted).toBe(true);
        });

        it('should set deletedReason to ADMIN_DELETED', async () => {
            const mockDbUser = buildDbUser({ isDeleted: false });
            (mockedUser.findById as jest.Mock).mockResolvedValue(mockDbUser);

            await userService.softDelete(MOCK_USER_ID);

            expect(mockDbUser.deletedReason).toBe(DeletedReason.ADMIN_DELETED);
        });

        it('should call save() after marking as deleted', async () => {
            const mockDbUser = buildDbUser({ isDeleted: false });
            (mockedUser.findById as jest.Mock).mockResolvedValue(mockDbUser);

            await userService.softDelete(MOCK_USER_ID);

            expect(mockDbUser.save).toHaveBeenCalledTimes(1);
        });
    });

    // ════════════════════════════════════════════
    // getAllUsers()
    // ════════════════════════════════════════════
    describe('getAllUsers', () => {
        beforeEach(() => {
            (PaginationHelper.paginate as jest.Mock).mockResolvedValue({
                data: [],
                pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
            });
        });

        /** Extracts the filter arg from PaginationHelper.paginate call */
        function getFilter() {
            return (PaginationHelper.paginate as jest.Mock).mock.calls[0][1];
        }
        function getSortOptions() {
            return (PaginationHelper.paginate as jest.Mock).mock.calls[0][5];
        }
        function getSelectFields() {
            return (PaginationHelper.paginate as jest.Mock).mock.calls[0][4];
        }

        // ── Filter: isDeleted ─────────────────────
        it('should filter isDeleted=false by default', async () => {
            await userService.getAllUsers(1, 10);
            expect(getFilter().isDeleted).toBe(false);
        });

        it('should filter isDeleted=true when includeDeleted is "true"', async () => {
            await userService.getAllUsers(
                1,
                10,
                undefined,
                undefined,
                undefined,
                'true'
            );
            expect(getFilter().isDeleted).toBe(true);
        });

        // ── Filter: search ────────────────────────
        it('should add $or search filter for fullName, email, phoneNumber', async () => {
            await userService.getAllUsers(1, 10, undefined, 'john');
            const filter = getFilter();
            expect(filter.$or).toHaveLength(3);
            expect(filter.$or[0]).toMatchObject({
                fullName: { $regex: 'john', $options: 'i' },
            });
            expect(filter.$or[1]).toMatchObject({
                email: { $regex: 'john', $options: 'i' },
            });
        });

        it('should NOT add $or filter when search is empty string', async () => {
            await userService.getAllUsers(1, 10, undefined, '');
            expect(getFilter().$or).toBeUndefined();
        });

        it('should NOT add $or filter when search is only whitespace', async () => {
            await userService.getAllUsers(1, 10, undefined, '   ');
            expect(getFilter().$or).toBeUndefined();
        });

        // ── Filter: gender ────────────────────────
        it('should add gender filter when gender is specified and not "all"', async () => {
            await userService.getAllUsers(
                1,
                10,
                undefined,
                undefined,
                'female'
            );
            expect(getFilter().gender).toBe('female');
        });

        it('should NOT add gender filter when gender is "all"', async () => {
            await userService.getAllUsers(1, 10, undefined, undefined, 'all');
            expect(getFilter().gender).toBeUndefined();
        });

        it('should NOT add gender filter when gender is undefined', async () => {
            await userService.getAllUsers(1, 10);
            expect(getFilter().gender).toBeUndefined();
        });

        // ── Sorting ───────────────────────────────
        it.each([
            ['name_asc', { fullName: 1 }],
            ['name_desc', { fullName: -1 }],
            ['email_asc', { email: 1 }],
            ['email_desc', { email: -1 }],
            ['credits_asc', { credits: 1 }],
            ['credits_desc', { credits: -1 }],
            ['date_asc', { createdAt: 1 }],
            ['date_desc', { createdAt: -1 }],
        ])('should sort by %s', async (sortBy, expectedSort) => {
            await userService.getAllUsers(
                1,
                10,
                undefined,
                undefined,
                undefined,
                undefined,
                sortBy
            );
            expect(getSortOptions()).toEqual(expectedSort);
        });

        it('should default sort by {createdAt: -1} when no sortBy provided', async () => {
            await userService.getAllUsers(1, 10);
            expect(getSortOptions()).toEqual({ createdAt: -1 });
        });

        it('should default sort by {createdAt: -1} for unknown sortBy', async () => {
            await userService.getAllUsers(
                1,
                10,
                undefined,
                undefined,
                undefined,
                undefined,
                'unknown_sort'
            );
            expect(getSortOptions()).toEqual({ createdAt: -1 });
        });

        // ── Field selection ───────────────────────
        it('should select valid requested fields joined by space', async () => {
            await userService.getAllUsers(1, 10, 'fullName,email,credits');
            expect(getSelectFields()).toBe('fullName email credits');
        });

        it('should fall back to "-password -__v" when no valid fields are requested', async () => {
            await userService.getAllUsers(1, 10, 'password,invalidField');
            expect(getSelectFields()).toBe('-password -__v');
        });

        it('should fall back to "-password -__v" when fields param is undefined', async () => {
            await userService.getAllUsers(1, 10);
            expect(getSelectFields()).toBe('-password -__v');
        });

        // ── Return shape ──────────────────────────
        it('should return { users, pagination } shape', async () => {
            const mockData = [buildDbUser()];
            const mockPagination = {
                page: 1,
                limit: 10,
                total: 1,
                totalPages: 1,
            };
            (PaginationHelper.paginate as jest.Mock).mockResolvedValue({
                data: mockData,
                pagination: mockPagination,
            });

            const result = await userService.getAllUsers(1, 10);

            expect(result).toEqual({
                users: mockData,
                pagination: mockPagination,
            });
        });
    });

    // ════════════════════════════════════════════
    // getUserPreference()
    // ════════════════════════════════════════════
    describe('getUserPreference', () => {
        it('should call User.findOne with {_id, isDeleted: false}', async () => {
            (mockedUser.findOne as jest.Mock).mockReturnValue(
                queryWith(buildDbUser())
            );

            await userService.getUserPreference(MOCK_USER_ID);

            expect(mockedUser.findOne).toHaveBeenCalledWith({
                _id: MOCK_USER_ID,
                isDeleted: false,
            });
        });

        it('should throw USER_NOT_FOUND when user does not exist', async () => {
            (mockedUser.findOne as jest.Mock).mockReturnValue(queryWith(null));

            await expect(
                userService.getUserPreference(MOCK_USER_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        it('should throw USER_PREFERENCE_NOT_FOUND when user has no preferences', async () => {
            (mockedUser.findOne as jest.Mock).mockReturnValue(
                queryWith(buildDbUser({ preferences: null }))
            );

            await expect(
                userService.getUserPreference(MOCK_USER_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_PREFERENCE_NOT_FOUND.status,
                message: ErrorMessage.USER_PREFERENCE_NOT_FOUND.message,
            });
        });

        it('should return the user preferences object', async () => {
            const mockPrefs = {
                primaryGoal: 'career_advancement',
                studyTimePerDay: 60,
            };
            (mockedUser.findOne as jest.Mock).mockReturnValue(
                queryWith(buildDbUser({ preferences: mockPrefs }))
            );

            const result = await userService.getUserPreference(MOCK_USER_ID);

            expect(result).toEqual(mockPrefs);
        });
    });

    // ════════════════════════════════════════════
    // setUserPreferences()
    // ════════════════════════════════════════════
    describe('setUserPreferences', () => {
        const NEW_PREFS = {
            primaryGoal: 'business_english',
            studyTimePerDay: 60,
        };

        beforeEach(() => {
            // findOne: direct await (no .select() chain)
            (mockedUser.findOne as jest.Mock).mockResolvedValue(buildDbUser());
            // findByIdAndUpdate: with .select('preferences') chain
            (mockedUser.findByIdAndUpdate as jest.Mock).mockReturnValue(
                queryWith(
                    buildDbUser({
                        preferences: { ...NEW_PREFS, lastUpdated: new Date() },
                    })
                )
            );
        });

        it('should throw USER_NOT_FOUND when user does not exist', async () => {
            (mockedUser.findOne as jest.Mock).mockResolvedValue(null);

            await expect(
                userService.setUserPreferences(MOCK_USER_ID, NEW_PREFS as any)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
            });
        });

        it('should call findByIdAndUpdate with merged preferences including lastUpdated', async () => {
            await userService.setUserPreferences(
                MOCK_USER_ID,
                NEW_PREFS as any
            );

            expect(mockedUser.findByIdAndUpdate).toHaveBeenCalledWith(
                MOCK_USER_ID,
                {
                    preferences: expect.objectContaining({
                        ...NEW_PREFS,
                        lastUpdated: expect.any(Date),
                    }),
                },
                { new: true, runValidators: true }
            );
        });

        it('should throw UPDATE_USER_FAIL when findByIdAndUpdate returns null', async () => {
            (mockedUser.findByIdAndUpdate as jest.Mock).mockReturnValue(
                queryWith(null)
            );

            await expect(
                userService.setUserPreferences(MOCK_USER_ID, NEW_PREFS as any)
            ).rejects.toMatchObject({
                status: ErrorMessage.UPDATE_USER_FAIL.status,
            });
        });

        it('should throw UPDATE_USER_FAIL when updated user has no preferences', async () => {
            (mockedUser.findByIdAndUpdate as jest.Mock).mockReturnValue(
                queryWith(buildDbUser({ preferences: null }))
            );

            await expect(
                userService.setUserPreferences(MOCK_USER_ID, NEW_PREFS as any)
            ).rejects.toMatchObject({
                status: ErrorMessage.UPDATE_USER_FAIL.status,
            });
        });

        it('should return the updated preferences', async () => {
            const updatedPrefs = { ...NEW_PREFS, lastUpdated: new Date() };
            (mockedUser.findByIdAndUpdate as jest.Mock).mockReturnValue(
                queryWith(buildDbUser({ preferences: updatedPrefs }))
            );

            const result = await userService.setUserPreferences(
                MOCK_USER_ID,
                NEW_PREFS as any
            );

            expect(result).toEqual(updatedPrefs);
        });

        it('should merge existing preferences with new preferences', async () => {
            const existingPrefs = {
                primaryGoal: 'toeic_preparation',
                weeklyStudyDays: 5,
            };
            (mockedUser.findOne as jest.Mock).mockResolvedValue(
                buildDbUser({ preferences: existingPrefs })
            );

            await userService.setUserPreferences(
                MOCK_USER_ID,
                NEW_PREFS as any
            );

            const [, updatePayload] = (
                mockedUser.findByIdAndUpdate as jest.Mock
            ).mock.calls[0];
            expect(updatePayload.preferences).toMatchObject({
                ...existingPrefs,
                ...NEW_PREFS,
            });
        });
    });

    // ════════════════════════════════════════════
    // restoreUser()
    // ════════════════════════════════════════════
    describe('restoreUser', () => {
        it('should throw USER_NOT_FOUND when user does not exist', async () => {
            (mockedUser.findById as jest.Mock).mockResolvedValue(null);

            await expect(
                userService.restoreUser(MOCK_USER_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
            });
        });

        it('should throw USER_NOT_FOUND when user is not deleted (already active)', async () => {
            (mockedUser.findById as jest.Mock).mockResolvedValue(
                buildDbUser({ isDeleted: false })
            );

            await expect(
                userService.restoreUser(MOCK_USER_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
            });
        });

        it('should set isDeleted=false on the user', async () => {
            const mockDbUser = buildDbUser({ isDeleted: true });
            (mockedUser.findById as jest.Mock).mockResolvedValue(mockDbUser);

            await userService.restoreUser(MOCK_USER_ID);

            expect(mockDbUser.isDeleted).toBe(false);
        });

        it('should call save() after restoring the user', async () => {
            const mockDbUser = buildDbUser({ isDeleted: true });
            (mockedUser.findById as jest.Mock).mockResolvedValue(mockDbUser);

            await userService.restoreUser(MOCK_USER_ID);

            expect(mockDbUser.save).toHaveBeenCalledTimes(1);
        });

        it('should return user without password, isDeleted, __v', async () => {
            const mockDbUser = buildDbUser({ isDeleted: true });
            (mockedUser.findById as jest.Mock).mockResolvedValue(mockDbUser);

            const result = await userService.restoreUser(MOCK_USER_ID);

            expect(result).not.toHaveProperty('password');
            expect(result).not.toHaveProperty('isDeleted');
            expect(result).not.toHaveProperty('__v');
        });
    });
});
