/* eslint-disable @typescript-eslint/no-explicit-any */
import { OtpEmailService } from '~/services/otpEmailService.js';
import { Otp } from '~/models/otpModel.js';
import { User } from '~/models/userModel.js';
import { mailTransporter } from '~/config/configEmail.js';
import { emailQueue } from '~/services/emailQueue.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { OtpPurpose } from '~/enum/otpPurpose.js';

// ──────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────
jest.mock('~/models/otpModel.js');
jest.mock('~/models/userModel.js');

jest.mock('~/config/configEmail.js', () => ({
    mailTransporter: {
        sendMail: jest.fn().mockResolvedValue(true),
    },
}));

jest.mock('~/services/emailQueue.js', () => ({
    emailQueue: {
        setEmailSender: jest.fn(),
        addJob: jest.fn(),
    },
}));

const mockedOtp = Otp as jest.Mocked<typeof Otp>;
const mockedUser = User as jest.Mocked<typeof User>;
const mockedMailTransporter = mailTransporter as jest.Mocked<
    typeof mailTransporter
>;
const mockedEmailQueue = emailQueue as jest.Mocked<typeof emailQueue>;

// ──────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────
const VALID_EMAIL = 'user@example.com';
const VALID_OTP = '123456';

function buildMockOtp(overrides: Record<string, unknown> = {}) {
    return {
        _id: 'mock-otp-id',
        email: VALID_EMAIL,
        otp: VALID_OTP,
        purpose: OtpPurpose.REGISTER,
        expiryTime: new Date(Date.now() + 10 * 60 * 1000), // future expiry
        ...overrides,
    };
}

function buildMockUser(overrides: Record<string, unknown> = {}) {
    return {
        _id: 'mock-user-id',
        email: VALID_EMAIL,
        isDeleted: true,
        deletedReason: 'Needs activation',
        save: jest.fn().mockResolvedValue(true),
        ...overrides,
    };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────
describe('OtpEmailService', () => {
    let otpEmailService: OtpEmailService;

    beforeAll(() => {
        process.env.SMTP_USER = 'sender@example.com';
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Instantiate for each test to ensure fresh constructor run
        otpEmailService = new OtpEmailService();
    });

    // ════════════════════════════════════════════
    // Constructor – Registering with queue
    // ════════════════════════════════════════════
    describe('constructor', () => {
        it('should register this service to emailQueue', () => {
            expect(mockedEmailQueue.setEmailSender).toHaveBeenCalledWith(
                otpEmailService
            );
        });
    });

    // ════════════════════════════════════════════
    // sendOtp()
    // ════════════════════════════════════════════
    describe('sendOtp', () => {
        beforeEach(() => {
            (mockedOtp.create as jest.Mock).mockResolvedValue(
                buildMockOtp() as any
            );
        });

        it('should trim and lowercase the recipient email address', async () => {
            const spacesEmail = '  uSeR@eXaMpLe.CoM  ';
            await otpEmailService.sendOtp(spacesEmail, OtpPurpose.REGISTER);

            expect(mockedOtp.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    email: VALID_EMAIL,
                })
            );
        });

        it('should generate a 6-digit OTP code', async () => {
            const otpCode = await otpEmailService.sendOtp(
                VALID_EMAIL,
                OtpPurpose.REGISTER
            );

            expect(otpCode).toMatch(/^\d{6}$/);
            expect(mockedOtp.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    otp: otpCode,
                })
            );
        });

        it('should call Otp.create with normalized email, generated code, purpose, and future expiryTime', async () => {
            const purpose = OtpPurpose.FORGOT_PASSWORD;
            const code = await otpEmailService.sendOtp(VALID_EMAIL, purpose);

            expect(mockedOtp.create).toHaveBeenCalledTimes(1);
            expect(mockedOtp.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    email: VALID_EMAIL,
                    otp: code,
                    purpose,
                    expiryTime: expect.any(Date),
                })
            );
        });

        it('should add the email job to emailQueue', async () => {
            const purpose = OtpPurpose.REGISTER;
            const code = await otpEmailService.sendOtp(VALID_EMAIL, purpose);

            expect(mockedEmailQueue.addJob).toHaveBeenCalledTimes(1);
            expect(mockedEmailQueue.addJob).toHaveBeenCalledWith(
                VALID_EMAIL,
                code,
                purpose
            );
        });

        it('should return the generated OTP code', async () => {
            const result = await otpEmailService.sendOtp(
                VALID_EMAIL,
                OtpPurpose.REGISTER
            );
            expect(result).toMatch(/^\d{6}$/);
        });
    });

    // ════════════════════════════════════════════
    // sendOtpEmail()
    // ════════════════════════════════════════════
    describe('sendOtpEmail', () => {
        it('should send email with correct subject for REGISTER purpose', async () => {
            await otpEmailService.sendOtpEmail(
                VALID_EMAIL,
                VALID_OTP,
                OtpPurpose.REGISTER
            );

            expect(mockedMailTransporter.sendMail).toHaveBeenCalledTimes(1);
            expect(mockedMailTransporter.sendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    from: 'sender@example.com',
                    to: VALID_EMAIL,
                    subject: 'Confirm Your Registration',
                    html: expect.stringContaining(VALID_OTP),
                })
            );
        });

        it('should send email with correct subject for FORGOT_PASSWORD purpose', async () => {
            await otpEmailService.sendOtpEmail(
                VALID_EMAIL,
                VALID_OTP,
                OtpPurpose.FORGOT_PASSWORD
            );

            expect(mockedMailTransporter.sendMail).toHaveBeenCalledTimes(1);
            expect(mockedMailTransporter.sendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    from: 'sender@example.com',
                    to: VALID_EMAIL,
                    subject: 'OTP for Password Reset',
                    html: expect.stringContaining(VALID_OTP),
                })
            );
        });

        it('should fall back to localhost port if FRONTEND_URL environment variable is missing', async () => {
            delete process.env.FRONTEND_URL;
            await otpEmailService.sendOtpEmail(
                VALID_EMAIL,
                VALID_OTP,
                OtpPurpose.REGISTER
            );

            expect(mockedMailTransporter.sendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    html: expect.stringContaining(
                        'http://localhost:5173/verify-otp'
                    ),
                })
            );
        });

        it('should include configured FRONTEND_URL in verifyLink', async () => {
            process.env.FRONTEND_URL = 'https://mycoolapp.com';
            await otpEmailService.sendOtpEmail(
                VALID_EMAIL,
                VALID_OTP,
                OtpPurpose.REGISTER
            );

            expect(mockedMailTransporter.sendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    html: expect.stringContaining(
                        'https://mycoolapp.com/verify-otp'
                    ),
                })
            );
        });

        it('should use empty string senderEmail when SMTP_USER environment variable is missing', async () => {
            delete process.env.SMTP_USER;
            const freshInstance = new OtpEmailService();
            await freshInstance.sendOtpEmail(
                VALID_EMAIL,
                VALID_OTP,
                OtpPurpose.REGISTER
            );
            expect(mockedMailTransporter.sendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    from: '',
                })
            );
        });

        it('should handle undefined or empty email address in sendOtpEmail', async () => {
            await otpEmailService.sendOtpEmail(
                undefined as any,
                VALID_OTP,
                OtpPurpose.REGISTER
            );
            expect(mockedMailTransporter.sendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    html: expect.stringContaining('email=&otp='),
                })
            );
        });

        it('should handle undefined or empty email address in sendOtpEmail for reset password', async () => {
            await otpEmailService.sendOtpEmail(
                undefined as any,
                VALID_OTP,
                OtpPurpose.FORGOT_PASSWORD
            );
            expect(mockedMailTransporter.sendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    html: expect.stringContaining('email=&otp='),
                })
            );
        });
    });

    // ════════════════════════════════════════════
    // verifyOtp()
    // ════════════════════════════════════════════
    describe('verifyOtp', () => {
        beforeEach(() => {
            (mockedOtp.findOne as any) = jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(buildMockOtp()),
            });
            (mockedOtp.deleteOne as any) = jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
            });
            (mockedOtp.deleteMany as any) = jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
            });
            (mockedUser.findOne as any) = jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(buildMockUser()),
            });
        });

        it('should throw ApiError(OTP_INVALID) if OTP record is not found in database', async () => {
            (mockedOtp.findOne as any).mockReturnValue({
                exec: jest.fn().mockResolvedValue(null),
            });

            await expect(
                otpEmailService.verifyOtp(
                    VALID_EMAIL,
                    VALID_OTP,
                    OtpPurpose.REGISTER
                )
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                otpEmailService.verifyOtp(
                    VALID_EMAIL,
                    VALID_OTP,
                    OtpPurpose.REGISTER
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.OTP_INVALID.status,
                message: ErrorMessage.OTP_INVALID.message,
            });
        });

        it('should delete the expired OTP and throw ApiError(OTP_EXPIRED) if expired', async () => {
            const expiredOtp = buildMockOtp({
                _id: 'expired-otp-id',
                expiryTime: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
            });

            (mockedOtp.findOne as any).mockReturnValue({
                exec: jest.fn().mockResolvedValue(expiredOtp),
            });

            await expect(
                otpEmailService.verifyOtp(
                    VALID_EMAIL,
                    VALID_OTP,
                    OtpPurpose.REGISTER
                )
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                otpEmailService.verifyOtp(
                    VALID_EMAIL,
                    VALID_OTP,
                    OtpPurpose.REGISTER
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.OTP_EXPIRED.status,
                message: ErrorMessage.OTP_EXPIRED.message,
            });

            expect(mockedOtp.deleteOne).toHaveBeenCalledWith({
                _id: 'expired-otp-id',
            });
        });

        it('should call Otp.deleteMany to clean up all OTPs for email and purpose on successful validation', async () => {
            await otpEmailService.verifyOtp(
                VALID_EMAIL,
                VALID_OTP,
                OtpPurpose.FORGOT_PASSWORD
            );

            expect(mockedOtp.deleteMany).toHaveBeenCalledWith({
                email: VALID_EMAIL.toLowerCase(),
                purpose: OtpPurpose.FORGOT_PASSWORD,
            });
        });

        it('should throw ApiError(USER_NOT_FOUND) during REGISTER purpose validation if user is missing', async () => {
            (mockedUser.findOne as any).mockReturnValue({
                exec: jest.fn().mockResolvedValue(null),
            });

            await expect(
                otpEmailService.verifyOtp(
                    VALID_EMAIL,
                    VALID_OTP,
                    OtpPurpose.REGISTER
                )
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                otpEmailService.verifyOtp(
                    VALID_EMAIL,
                    VALID_OTP,
                    OtpPurpose.REGISTER
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        it('should update user to set isDeleted=false and deletedReason=null for successful REGISTER verification', async () => {
            const mockUser = buildMockUser();
            (mockedUser.findOne as any).mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockUser),
            });

            await otpEmailService.verifyOtp(
                VALID_EMAIL,
                VALID_OTP,
                OtpPurpose.REGISTER
            );

            expect(mockedUser.findOne).toHaveBeenCalledWith({
                email: VALID_EMAIL.toLowerCase(),
            });
            expect(mockUser.isDeleted).toBe(false);
            expect(mockUser.deletedReason).toBeNull();
            expect(mockUser.save).toHaveBeenCalledTimes(1);
        });

        it('should not perform user update if purpose is FORGOT_PASSWORD', async () => {
            await otpEmailService.verifyOtp(
                VALID_EMAIL,
                VALID_OTP,
                OtpPurpose.FORGOT_PASSWORD
            );

            expect(mockedUser.findOne).not.toHaveBeenCalled();
        });
    });
});
