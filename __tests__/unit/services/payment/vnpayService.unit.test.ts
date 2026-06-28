/* eslint-disable @typescript-eslint/no-explicit-any */
import vnpayService from '~/services/payment/vnpayService.js';
import { Payment } from '~/models/payment.js';
import { User } from '~/models/userModel.js';
import { PaymentStatus } from '~/enum/paymentStatus.js';
import notificationService from '~/services/notifications/notificationService.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

jest.mock('~/models/payment.js');
jest.mock('~/models/userModel.js');

const mockedPayment = Payment as jest.Mocked<typeof Payment>;
const mockedUser = User as jest.Mocked<typeof User>;

describe('VnpayService', () => {
    let pushNotificationSpy: jest.SpyInstance;

    const secretKey = 'test_secret';

    beforeAll(() => {
        (vnpayService as any).VNP_HASHSECRET = secretKey;
        (vnpayService as any).VNP_TMNCODE = 'test_tmn';
        (vnpayService as any).VNP_URL = 'http://vnpay.com';
        (vnpayService as any).VNP_RETURNURL = 'http://return.com';
        process.env.FRONTEND_URL = 'http://localhost:5173';
    });

    beforeEach(() => {
        jest.clearAllMocks();
        pushNotificationSpy = jest
            .spyOn(notificationService, 'pushNotification')
            .mockResolvedValue(undefined as any);

        (mockedPayment.findOne as any) = jest.fn().mockResolvedValue({
            _id: 'p-1',
            status: PaymentStatus.PENDING,
            user: 'u-1',
            tokens: 10,
            amount: 10000,
            save: jest.fn().mockResolvedValue(true),
        });

        (mockedUser.findByIdAndUpdate as any) = jest.fn().mockResolvedValue({});
        (mockedUser.findById as any) = jest
            .fn()
            .mockResolvedValue({ _id: { toString: () => 'u-1' } });
    });

    afterEach(() => {
        pushNotificationSpy.mockRestore();
    });

    describe('createVnpayPaymentUrl', () => {
        it('should return a valid vnpay url with query parameters and hash', async () => {
            const payment = { _id: 'p-1', amount: 10000 } as any;
            const url = await vnpayService.createVnpayPaymentUrl(
                payment,
                '127.0.0.1'
            );
            expect(url.startsWith('http://vnpay.com')).toBe(true);
            expect(url).toContain('vnp_TxnRef=p-1');
            expect(url).toContain('vnp_SecureHash=');
        });

        it('should handle payment without _id and object with prototype properties', async () => {
            const payment = { amount: 10000 } as any;
            const url = await vnpayService.createVnpayPaymentUrl(
                payment,
                '127.0.0.1'
            );
            expect(url).toContain('vnp_TxnRef=&');

            // test sortObject with inherited property
            const obj = Object.create({ inherited: 'yes' });
            obj.own = 'yes';
            const sorted = (vnpayService as any).sortObject(obj);
            expect(sorted).toHaveProperty('own');
            expect(sorted).not.toHaveProperty('inherited');
        });
    });

    describe('formatDate (private)', () => {
        it('should format date correctly to YYYYMMDDHHmmss', () => {
            const date = new Date('2024-05-15T12:30:00Z');
            const result = (vnpayService as any).formatDate(date);
            expect(result).toMatch(/^\d{14}$/); // YYYYMMDDHHmmss format
        });
    });

    describe('handleVnPayReturn', () => {
        it('should throw PAYMENT_FAILED if params is empty', async () => {
            await expect(
                vnpayService.handleVnPayReturn(null as any)
            ).rejects.toMatchObject({
                status: ErrorMessage.PAYMENT_FAILED.status,
            });
        });

        it('should throw SIGNATURE_INVALID if secureHash is missing', async () => {
            await expect(
                vnpayService.handleVnPayReturn({} as any)
            ).rejects.toMatchObject({
                status: ErrorMessage.SIGNATURE_INVALID.status,
            });
        });

        it('should throw PROMOTION_NOT_FOUND if order not found', async () => {
            (mockedPayment.findOne as any) = jest.fn().mockResolvedValue(null);
            const query: any = { vnp_TxnRef: 'p-1' };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            await expect(
                vnpayService.handleVnPayReturn(query)
            ).rejects.toMatchObject({
                status: ErrorMessage.PROMOTION_NOT_FOUND.status,
            });
        });

        it('should throw SIGNATURE_INVALID and mark failed if hash does not match', async () => {
            const mockSave = jest.fn();
            const mockPayment = {
                status: PaymentStatus.PENDING,
                save: mockSave,
            };
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue(mockPayment);

            const query: any = {
                vnp_TxnRef: 'p-1',
                vnp_SecureHash: 'invalid_hash',
            };

            await expect(
                vnpayService.handleVnPayReturn(query)
            ).rejects.toMatchObject({
                status: ErrorMessage.SIGNATURE_INVALID.status,
            });
            expect(mockPayment.status).toBe(PaymentStatus.FAILED);
            expect(mockSave).toHaveBeenCalled();
        });

        it('should throw AMOUNT_NOT_MATCH and mark failed if amount does not match', async () => {
            const mockSave = jest.fn();
            const mockPayment = {
                status: PaymentStatus.PENDING,
                save: mockSave,
                amount: 50000,
            };
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue(mockPayment);

            const query: any = { vnp_TxnRef: 'p-1', vnp_Amount: '1000000' }; // 1000000 / 100 = 10000
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            await expect(
                vnpayService.handleVnPayReturn(query)
            ).rejects.toMatchObject({
                status: ErrorMessage.AMOUNT_NOT_MATCH.status,
            });
            expect(mockPayment.status).toBe(PaymentStatus.FAILED);
            expect(mockSave).toHaveBeenCalled();
        });

        it('should mark failed and return failed url if response code is not 00', async () => {
            const mockSave = jest.fn();
            const mockPayment = {
                status: PaymentStatus.PENDING,
                save: mockSave,
                amount: 10000,
                _id: { toString: () => 'p-1' },
            };
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue(mockPayment);

            const query: any = {
                vnp_TxnRef: 'p-1',
                vnp_Amount: '1000000',
                vnp_ResponseCode: '24',
                vnp_TransactionStatus: '24',
            };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            const res = await vnpayService.handleVnPayReturn(query);
            expect(mockPayment.status).toBe(PaymentStatus.FAILED);
            expect(mockSave).toHaveBeenCalled();
            expect(res).toEqual({
                success: true,
                redirectUrl:
                    'http://localhost:5173/payment/callback?paymentId=p-1&status=FAILED',
                paymentId: 'p-1',
                status: 'FAILED',
            });
        });

        it('should mark succeeded, add credits, notify user and return success url', async () => {
            const mockSave = jest.fn();
            const mockPayment = {
                status: PaymentStatus.PENDING,
                user: 'u-1',
                tokens: 10,
                amount: 10000,
                save: mockSave,
                _id: { toString: () => 'p-1' },
            };
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue(mockPayment);

            const query: any = {
                vnp_TxnRef: 'p-1',
                vnp_Amount: '1000000',
                vnp_ResponseCode: '00',
                vnp_TransactionStatus: '00',
            };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            const res = await vnpayService.handleVnPayReturn(query);

            expect(mockPayment.status).toBe(PaymentStatus.SUCCEEDED);
            expect(mockSave).toHaveBeenCalled();
            expect(mockedUser.findByIdAndUpdate).toHaveBeenCalledWith('u-1', {
                $inc: { credits: 10 },
            });
            expect(pushNotificationSpy).toHaveBeenCalled();
            expect(res).toEqual({
                success: true,
                redirectUrl:
                    'http://localhost:5173/payment/callback?paymentId=p-1&status=SUCCEEDED',
                paymentId: 'p-1',
                status: 'SUCCEEDED',
            });
        });

        it('should not notify if user not found for notification', async () => {
            const mockSave = jest.fn();
            const mockPayment = {
                status: PaymentStatus.PENDING,
                user: 'u-1',
                tokens: 10,
                amount: 10000,
                save: mockSave,
                _id: { toString: () => 'p-1' },
            };
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue(mockPayment);
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(null);

            const query: any = {
                vnp_TxnRef: 'p-1',
                vnp_Amount: '1000000',
                vnp_ResponseCode: '00',
                vnp_TransactionStatus: '00',
            };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            const res = await vnpayService.handleVnPayReturn(query);

            expect(mockPayment.status).toBe(PaymentStatus.SUCCEEDED);
            expect(pushNotificationSpy).not.toHaveBeenCalled(); // Should not notify if user not found
            expect(res).toEqual({
                success: true,
                redirectUrl:
                    'http://localhost:5173/payment/callback?paymentId=p-1&status=SUCCEEDED',
                paymentId: 'p-1',
                status: 'SUCCEEDED',
            });
        });

        it('should handle missing _id in payment correctly for txnRef', async () => {
            const mockSave = jest.fn();
            const mockPayment = {
                status: PaymentStatus.PENDING,
                save: mockSave,
                amount: 10000,
            };
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue(mockPayment);

            const query: any = {
                vnp_TxnRef: 'p-1',
                vnp_Amount: '1000000',
                vnp_ResponseCode: '00',
                vnp_TransactionStatus: '00',
            };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            const res = await vnpayService.handleVnPayReturn(query);

            expect(res).toEqual({
                success: true,
                redirectUrl:
                    'http://localhost:5173/payment/callback?paymentId=p-1&status=SUCCEEDED',
                paymentId: 'p-1',
                status: 'SUCCEEDED',
            });
        });

        it('should handle missing vnp_Amount and default FRONTEND_URL', async () => {
            const mockSave = jest.fn();
            const mockPayment = {
                status: PaymentStatus.PENDING,
                save: mockSave,
                amount: 10000,
                _id: 'p-1',
            };
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue(mockPayment);

            delete process.env.FRONTEND_URL;
            const query: any = {
                vnp_TxnRef: 'p-1',
                vnp_ResponseCode: '00',
                vnp_TransactionStatus: '00',
            };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            const res = await vnpayService.handleVnPayReturn(query);

            expect(res).toEqual({
                success: true,
                redirectUrl:
                    'http://localhost:5173/payment/callback?paymentId=p-1&status=SUCCEEDED',
                paymentId: 'p-1',
                status: 'SUCCEEDED',
            });
            process.env.FRONTEND_URL = 'http://localhost:5173'; // Restore
        });
    });

    describe('handleVnPayIpn', () => {
        it('should return 99 if params is missing', async () => {
            const res = await vnpayService.handleVnPayIpn(null as any);
            expect(res).toEqual({ RspCode: '99', Message: 'No params' });
        });

        it('should return 97 if secureHash is missing', async () => {
            const res = await vnpayService.handleVnPayIpn({} as any);
            expect(res).toEqual({
                RspCode: '97',
                Message: 'Missing signature',
            });
        });

        it('should return 01 if payment not found', async () => {
            (mockedPayment.findOne as any) = jest.fn().mockResolvedValue(null);
            const query: any = { vnp_TxnRef: 'p-1' };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            const res = await vnpayService.handleVnPayIpn(query);
            expect(res).toEqual({
                RspCode: '01',
                Message: 'Payment not found',
            });
        });

        it('should return 97 if signature does not match', async () => {
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue({ status: PaymentStatus.PENDING });
            const query: any = {
                vnp_TxnRef: 'p-1',
                vnp_SecureHash: 'invalid_hash',
            };

            const res = await vnpayService.handleVnPayIpn(query);
            expect(res).toEqual({
                RspCode: '97',
                Message: 'Invalid signature',
            });
        });

        it('should return 02 if already confirmed', async () => {
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue({ status: PaymentStatus.SUCCEEDED });
            const query: any = { vnp_TxnRef: 'p-1' };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            const res = await vnpayService.handleVnPayIpn(query);
            expect(res).toEqual({
                RspCode: '02',
                Message: 'Already confirmed',
            });
        });

        it('should return 04 and mark failed if amount does not match', async () => {
            const mockSave = jest.fn();
            const mockPayment = {
                status: PaymentStatus.PENDING,
                amount: 50000,
                save: mockSave,
            };
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue(mockPayment);

            const query: any = { vnp_TxnRef: 'p-1', vnp_Amount: '1000000' };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            const res = await vnpayService.handleVnPayIpn(query);
            expect(mockPayment.status).toBe(PaymentStatus.FAILED);
            expect(mockSave).toHaveBeenCalled();
            expect(res).toEqual({ RspCode: '04', Message: 'Amount mismatch' });
        });

        it('should return 00, mark succeeded and add credits if isSuccess', async () => {
            const mockSave = jest.fn();
            const mockPayment = {
                status: PaymentStatus.PENDING,
                user: 'u-1',
                tokens: 10,
                amount: 10000,
                save: mockSave,
            };
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue(mockPayment);

            const query: any = {
                vnp_TxnRef: 'p-1',
                vnp_Amount: '1000000',
                vnp_ResponseCode: '00',
                vnp_TransactionStatus: '00',
            };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            const res = await vnpayService.handleVnPayIpn(query);
            expect(mockPayment.status).toBe(PaymentStatus.SUCCEEDED);
            expect(mockSave).toHaveBeenCalled();
            expect(mockedUser.findByIdAndUpdate).toHaveBeenCalledWith('u-1', {
                $inc: { credits: 10 },
            });
            expect(res).toEqual({ RspCode: '00', Message: 'Confirm Success' });
        });

        it('should return 99, mark failed if not isSuccess', async () => {
            const mockSave = jest.fn();
            const mockPayment = {
                status: PaymentStatus.PENDING,
                amount: 10000,
                save: mockSave,
            };
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue(mockPayment);

            const query: any = {
                vnp_TxnRef: 'p-1',
                vnp_Amount: '1000000',
                vnp_ResponseCode: '24',
                vnp_TransactionStatus: '24',
            };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            const res = await vnpayService.handleVnPayIpn(query);
            expect(mockPayment.status).toBe(PaymentStatus.FAILED);
            expect(mockSave).toHaveBeenCalled();
            expect(res).toEqual({ RspCode: '99', Message: 'Unknown Error' });
        });

        it('should handle internal errors gracefully', async () => {
            const mockConsoleError = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockRejectedValue(new Error('DB Error'));

            const query: any = { vnp_TxnRef: 'p-1' };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            const res = await vnpayService.handleVnPayIpn(query);
            expect(res).toEqual({ RspCode: '99', Message: 'Internal error' });
            expect(mockConsoleError).toHaveBeenCalled();
            mockConsoleError.mockRestore();
        });

        it('should not throw if user not found during IPN success', async () => {
            const mockSave = jest.fn();
            const mockPayment = {
                status: PaymentStatus.PENDING,
                user: 'u-1',
                tokens: 10,
                amount: 10000,
                save: mockSave,
            };
            (mockedPayment.findOne as any) = jest
                .fn()
                .mockResolvedValue(mockPayment);
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(null);

            const query: any = {
                vnp_TxnRef: 'p-1',
                vnp_Amount: '1000000',
                vnp_ResponseCode: '00',
                vnp_TransactionStatus: '00',
            };
            query.vnp_SecureHash = vnpayService.generateSecureHash(query);

            const res = await vnpayService.handleVnPayIpn(query);
            expect(res).toEqual({ RspCode: '00', Message: 'Confirm Success' });
        });
    });

    describe('refundTokens', () => {
        it('should do nothing if payment is SUCCEEDED or tokens <= 0', async () => {
            await vnpayService.refundTokens({
                status: PaymentStatus.SUCCEEDED,
            } as any);
            expect(mockedUser.findById).not.toHaveBeenCalled();

            await vnpayService.refundTokens({
                status: PaymentStatus.FAILED,
                tokens: 0,
            } as any);
            expect(mockedUser.findById).not.toHaveBeenCalled();
        });

        it('should add credits and create refund payment if user found and tokens > 0', async () => {
            const mockUserSave = jest.fn();
            const mockUser = { _id: 'u-1', credits: 100, save: mockUserSave };
            (mockedUser.findById as any) = jest
                .fn()
                .mockResolvedValue(mockUser);

            const mockPaymentSave = jest.fn();
            // Since Payment constructor is automatically mocked by jest.mock,
            // we will just spy on prototype if possible, but actually new Payment().save() is automatically a mock if implemented
            (Payment as unknown as jest.Mock).mockImplementation(() => ({
                save: mockPaymentSave,
            }));

            await vnpayService.refundTokens({
                _id: 'p-1',
                user: 'u-1',
                tokens: 50,
                status: PaymentStatus.FAILED,
            } as any);

            expect(mockUser.credits).toBe(150);
            expect(mockUserSave).toHaveBeenCalled();
            expect(Payment).toHaveBeenCalledWith(
                expect.objectContaining({
                    user: 'u-1',
                    type: 'refund',
                    tokens: 50,
                    description: 'Giao dịch thất bại p-1',
                    status: PaymentStatus.SUCCEEDED,
                })
            );
            expect(mockPaymentSave).toHaveBeenCalled();
        });

        it('should handle missing user credits and missing user gracefully', async () => {
            const mockUserSave = jest.fn();
            const mockUser: any = { _id: 'u-1', save: mockUserSave }; // Missing credits
            (mockedUser.findById as any) = jest
                .fn()
                .mockResolvedValueOnce(mockUser)
                .mockResolvedValueOnce(null);

            // First call with user found but no credits
            await vnpayService.refundTokens({
                _id: 'p-1',
                user: 'u-1',
                tokens: 50,
                status: PaymentStatus.FAILED,
            } as any);
            expect(mockUser.credits).toBe(50); // 0 + 50

            // Second call with user not found
            await vnpayService.refundTokens({
                _id: 'p-1',
                user: 'u-2',
                tokens: 50,
                status: PaymentStatus.FAILED,
            } as any);
            // Should just resolve without errors
        });
    });
});
