/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import paymentService from '~/services/payment/paymentService.js';
import { Payment } from '~/models/payment.js';
import { PromoCode } from '~/models/promoCode.js';
import { User } from '~/models/userModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { PaymentStatus } from '~/enum/paymentStatus.js';
import { TransactionType } from '~/enum/transactionType.js';
import { PaymentGateway } from '~/enum/paymentGateway.js';
import PromoService from '~/services/payment/promoService.js';
import vnpayService from '~/services/payment/vnpayService.js';
import stripeService from '~/services/payment/stripeService.js';

jest.mock('~/models/payment.js');
jest.mock('~/models/promoCode.js');
jest.mock('~/models/userModel.js');
jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        checkout: { sessions: { create: jest.fn() } },
    }));
});

const mockedPayment = Payment as jest.Mocked<typeof Payment>;
const mockedPromoCode = PromoCode as jest.Mocked<typeof PromoCode>;
const mockedUser = User as jest.Mocked<typeof User>;

function buildMockUser(overrides: Record<string, any> = {}) {
    return {
        _id: { toString: () => 'mock-user-id' },
        credits: 100,
        ...overrides,
    };
}

function mockMongooseQuery(returnValue: any) {
    const execMock = jest.fn().mockResolvedValue(returnValue);
    const promise = Promise.resolve(returnValue);
    const leanMock = jest
        .fn()
        .mockReturnValue(Object.assign(promise, { exec: execMock }));
    const selectMock = jest.fn().mockReturnValue({ lean: leanMock });
    return jest.fn().mockReturnValue(
        Object.assign(Promise.resolve(returnValue), {
            select: selectMock,
            lean: leanMock,
            exec: execMock,
        })
    );
}

function mockMongooseFind(returnValue: any) {
    const promise = Promise.resolve(returnValue);
    const leanMock = jest.fn().mockReturnValue(promise);
    const limitMock = jest
        .fn()
        .mockReturnValue(
            Object.assign(Promise.resolve(returnValue), { lean: leanMock })
        );
    const skipMock = jest.fn().mockReturnValue({ limit: limitMock });
    const sortMock = jest
        .fn()
        .mockReturnValue({ skip: skipMock, lean: leanMock });
    const populateMock = jest.fn().mockReturnValue({ sort: sortMock });
    return jest.fn().mockReturnValue({
        populate: populateMock,
        sort: sortMock,
        skip: skipMock,
        limit: limitMock,
        lean: leanMock,
    });
}

describe('PaymentService', () => {
    let validatePromoSpy: jest.SpyInstance;
    let applyPromoSpy: jest.SpyInstance;
    let vnpaySpy: jest.SpyInstance;
    let stripeSpy: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        validatePromoSpy = jest
            .spyOn((paymentService as any).promoService, 'validatePromoCode')
            .mockResolvedValue({ discount: 10, code: 'TEST10' } as any);
        applyPromoSpy = jest
            .spyOn((paymentService as any).promoService, 'applyPromoCode')
            .mockResolvedValue({} as any);
        vnpaySpy = jest
            .spyOn(vnpayService, 'createVnpayPaymentUrl')
            .mockResolvedValue('http://vnpay-mock-url');
        stripeSpy = jest
            .spyOn(stripeService, 'createCheckoutSession')
            .mockResolvedValue({ url: 'http://stripe-mock-url' } as any);
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        (mockedPayment.findById as any) = mockMongooseQuery({
            _id: 'mock-payment',
        });
        (mockedPayment.find as any) = mockMongooseFind([{ _id: 'payment-1' }]);
        (mockedPayment.countDocuments as any) = jest.fn().mockResolvedValue(1);
        (mockedPayment.create as any) = jest.fn().mockResolvedValue({
            _id: 'mock-transaction-id',
            status: PaymentStatus.SUCCEEDED,
        });
        (mockedPayment as any).mockImplementation((data: any) => ({
            ...data,
            save: jest.fn().mockResolvedValue(true),
            _id: 'mock-payment-id',
        }));
        (mockedPayment.updateMany as any) = jest
            .fn()
            .mockResolvedValue({ modifiedCount: 1 });

        (mockedUser.findOne as any) = mockMongooseQuery(buildMockUser());
        (mockedUser.findById as any) = mockMongooseQuery(buildMockUser());
        (mockedUser.findByIdAndUpdate as any) = mockMongooseQuery(
            buildMockUser({ credits: 90 })
        );

        (mockedPromoCode.findOne as any) = mockMongooseQuery({
            _id: 'promo-id',
            code: 'TEST',
            discount: 10,
            usageLimit: 100,
            usedCount: 0,
            active: true,
        });
        (mockedPromoCode.updateOne as any) = jest
            .fn()
            .mockResolvedValue({ modifiedCount: 1 });
    });

    afterEach(() => {
        validatePromoSpy.mockRestore();
        applyPromoSpy.mockRestore();
        vnpaySpy.mockRestore();
        stripeSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    describe('getTransactionById', () => {
        it('should return payment if found', async () => {
            const res = await paymentService.getTransactionById('mock-id');
            expect(res).toEqual({ _id: 'mock-payment' });
        });

        it('should throw PAYMENT_NOT_FOUND if not found', async () => {
            (mockedPayment.findById as any) = mockMongooseQuery(null);
            await expect(
                paymentService.getTransactionById('mock-id')
            ).rejects.toMatchObject({
                status: ErrorMessage.PAYMENT_NOT_FOUND.status,
                message: ErrorMessage.PAYMENT_NOT_FOUND.message,
            });
        });
    });

    describe('getAllTransactions', () => {
        it('should return empty result if email filter is provided but user not found', async () => {
            (mockedUser.findOne as any) = mockMongooseQuery(null);
            const res = await paymentService.getAllTransactions({
                email: 'nonexistent@example.com',
                page: 1,
                limit: 10,
            });
            expect(res).toEqual({
                data: [],
                pagination: {
                    page: 1,
                    limit: 10,
                    total: 0,
                    totalPages: 0,
                    hasNext: false,
                    hasPrev: false,
                },
            });
        });

        it('should apply filters and return transactions', async () => {
            const res = await paymentService.getAllTransactions({
                email: 'test@example.com',
                fromDate: '2023-01-01',
                toDate: '2023-12-31',
                status: PaymentStatus.SUCCEEDED,
                type: TransactionType.PURCHASE,
                gateway: PaymentGateway.VNPAY,
                page: 2,
                limit: 10,
                sort: 'asc',
            });

            expect(mockedPayment.find).toHaveBeenCalled();
            expect(res.data.length).toBe(1);
            expect(res.pagination).toEqual({
                page: 2,
                limit: 10,
                total: 1,
                totalPages: 1,
                hasNext: false,
                hasPrev: true,
            });
        });

        it('should apply default sort desc when sort is not asc', async () => {
            const findMock = mockMongooseFind([]);
            (mockedPayment.find as any) = findMock;
            await paymentService.getAllTransactions({ page: 1, limit: 10 });
            expect(mockedPayment.find).toHaveBeenCalled();
        });

        it('should handle only fromDate provided', async () => {
            await paymentService.getAllTransactions({
                fromDate: '2023-01-01',
                page: 1,
                limit: 10,
            });
            expect(mockedPayment.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    createdAt: expect.objectContaining({
                        $gte: expect.any(Date),
                    }),
                })
            );
        });

        it('should handle only toDate provided', async () => {
            await paymentService.getAllTransactions({
                toDate: '2023-12-31',
                page: 1,
                limit: 10,
            });
            expect(mockedPayment.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    createdAt: expect.objectContaining({
                        $lte: expect.any(Date),
                    }),
                })
            );
        });

        it.each([
            ['status', 'INVALID', ErrorMessage.PAYMENT_STATUS_NOT_FOUND],
            ['type', 'INVALID', ErrorMessage.TRANSACTION_TYPE_NOT_FOUND],
            ['gateway', 'INVALID', ErrorMessage.PAYMENT_GATEWAY_NOT_FOUND],
        ])(
            'should throw error if %s is invalid',
            async (field, value, errorMsg) => {
                await expect(
                    paymentService.getAllTransactions({
                        [field]: value,
                        page: 1,
                        limit: 10,
                    } as any)
                ).rejects.toMatchObject({
                    status: errorMsg.status,
                    message: errorMsg.message,
                });
            }
        );
    });

    describe('getTransactions', () => {
        it('should build query without userId if not provided', async () => {
            const findMock = mockMongooseFind([]);
            (mockedPayment.find as any) = findMock;
            await paymentService.getTransactions({ page: 1, limit: 10 } as any);
            expect(mockedPayment.find).toHaveBeenCalledWith({});
        });

        it('should build query with userId and other valid filters', async () => {
            const res = await paymentService.getTransactions({
                userId: 'user1',
                status: PaymentStatus.SUCCEEDED,
                type: TransactionType.PURCHASE,
                gateway: PaymentGateway.STRIPE,
                page: 1,
                limit: 10,
            });
            expect(mockedPayment.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    user: 'user1',
                    status: PaymentStatus.SUCCEEDED,
                    type: TransactionType.PURCHASE,
                    paymentGateway: PaymentGateway.STRIPE,
                })
            );
            expect(res.transaction).toBeDefined();
            expect(res.pagination.total).toBe(1);
        });

        it.each([
            ['status', 'INVALID', ErrorMessage.PAYMENT_STATUS_NOT_FOUND],
            ['type', 'INVALID', ErrorMessage.TRANSACTION_TYPE_NOT_FOUND],
            ['gateway', 'INVALID', ErrorMessage.PAYMENT_GATEWAY_NOT_FOUND],
            ['gateway', '', ErrorMessage.PAYMENT_GATEWAY_NOT_FOUND],
        ])(
            'should throw error if %s is invalid',
            async (field, value, errorMsg) => {
                await expect(
                    paymentService.getTransactions({
                        userId: 'u',
                        [field]: value,
                        page: 1,
                        limit: 10,
                    } as any)
                ).rejects.toMatchObject({
                    status: errorMsg.status,
                    message: errorMsg.message,
                });
            }
        );
    });

    describe('useToken', () => {
        it('should throw UNAUTHORIZED if no userId', async () => {
            await expect(
                paymentService.useToken({ userId: '', tokens: 10 })
            ).rejects.toMatchObject({
                status: ErrorMessage.UNAUTHORIZED.status,
                message: ErrorMessage.UNAUTHORIZED.message,
            });
        });

        it.each([0, -1, undefined])(
            'should throw INVALID_TOKEN_AMOUNT if tokens is %s',
            async (tokens) => {
                await expect(
                    paymentService.useToken({
                        userId: 'u',
                        tokens: tokens as number,
                    })
                ).rejects.toMatchObject({
                    status: ErrorMessage.INVALID_TOKEN_AMOUNT.status,
                    message: ErrorMessage.INVALID_TOKEN_AMOUNT.message,
                });
            }
        );

        it('should throw USER_NOT_FOUND if user not found', async () => {
            (mockedUser.findById as any) = mockMongooseQuery(null);
            await expect(
                paymentService.useToken({ userId: 'u', tokens: 10 })
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        describe('promo logic', () => {
            it('should throw PROMOTION_NOT_FOUND if promoCode is invalid', async () => {
                (mockedPromoCode.findOne as any) = mockMongooseQuery(null);
                await expect(
                    paymentService.useToken({
                        userId: 'u',
                        tokens: 10,
                        promoCode: 'INVALID',
                    })
                ).rejects.toMatchObject({
                    status: ErrorMessage.PROMOTION_NOT_FOUND.status,
                    message: ErrorMessage.PROMOTION_NOT_FOUND.message,
                });
            });

            it('should throw PROMO_USAGE_LIMIT_REACHED if promo usedCount >= usageLimit', async () => {
                (mockedPromoCode.findOne as any) = mockMongooseQuery({
                    usageLimit: 10,
                    usedCount: 10,
                });
                await expect(
                    paymentService.useToken({
                        userId: 'u',
                        tokens: 10,
                        promoCode: 'TEST',
                    })
                ).rejects.toMatchObject({
                    status: ErrorMessage.PROMO_USAGE_LIMIT_REACHED.status,
                    message: ErrorMessage.PROMO_USAGE_LIMIT_REACHED.message,
                });
            });

            it('should throw PROMO_EXPIRED if promo is expired', async () => {
                (mockedPromoCode.findOne as any) = mockMongooseQuery({
                    expiration: new Date(Date.now() - 10000),
                });
                await expect(
                    paymentService.useToken({
                        userId: 'u',
                        tokens: 10,
                        promoCode: 'TEST',
                    })
                ).rejects.toMatchObject({
                    status: ErrorMessage.PROMO_EXPIRED.status,
                    message: ErrorMessage.PROMO_EXPIRED.message,
                });
            });

            it('should calculate discounted tokens correctly and cap at 0', async () => {
                (mockedPromoCode.findOne as any) = mockMongooseQuery({
                    discount: 15,
                    usedCount: 0,
                    _id: 'promo-1',
                });
                // Original tokens = 10, discount = 15 => discounted = 0
                await paymentService.useToken({
                    userId: 'u',
                    tokens: 10,
                    promoCode: 'TEST',
                });
                expect(mockedPromoCode.updateOne).toHaveBeenCalledWith(
                    { _id: 'promo-1' },
                    { $inc: { usedCount: 1 } }
                );
            });

            it('should calculate discounted tokens correctly and not cap at 0 if positive', async () => {
                (mockedPromoCode.findOne as any) = mockMongooseQuery({
                    discount: 5,
                    usedCount: 0,
                    _id: 'promo-1',
                });
                // Original tokens = 10, discount = 5 => discounted = 5
                await paymentService.useToken({
                    userId: 'u',
                    tokens: 10,
                    promoCode: 'TEST',
                });
                expect(mockedUser.findByIdAndUpdate).toHaveBeenCalledWith(
                    expect.anything(),
                    { $inc: { credits: -5 } },
                    { new: true }
                );
            });
        });

        it('should throw NOT_ENOUGH_TOKENS if user credits < required tokens', async () => {
            (mockedUser.findById as any) = mockMongooseQuery(
                buildMockUser({ credits: 5 })
            );
            await expect(
                paymentService.useToken({ userId: 'u', tokens: 10 })
            ).rejects.toMatchObject({
                status: ErrorMessage.NOT_ENOUGH_TOKENS.status,
                message: ErrorMessage.NOT_ENOUGH_TOKENS.message,
            });
        });

        it('should successfully use token and return transaction data', async () => {
            const res = await paymentService.useToken({
                userId: 'u',
                tokens: 10,
                description: 'Buy item',
            });
            expect(mockedUser.findByIdAndUpdate).toHaveBeenCalled();
            expect(mockedPayment.create).toHaveBeenCalled();
            expect(res).toEqual({
                transactionId: 'mock-transaction-id',
                status: PaymentStatus.SUCCEEDED,
                tokensDeducted: 10,
                userTokenBalance: 90,
            });
        });
    });

    describe('createPayment', () => {
        it.each([0, -5, undefined])(
            'should throw TOKEN_INVALID if tokens %s',
            async (tokens) => {
                await expect(
                    paymentService.createPayment('u', 'ip', { tokens })
                ).rejects.toMatchObject({
                    status: ErrorMessage.TOKEN_INVALID.status,
                    message: ErrorMessage.TOKEN_INVALID.message,
                });
            }
        );

        it('should validate and apply promo code if provided', async () => {
            await paymentService.createPayment('u', 'ip', {
                tokens: 10,
                promoCode: 'PROMO10',
            });
            expect(validatePromoSpy).toHaveBeenCalledWith(
                'PROMO10',
                'u',
                10000
            );
            expect(applyPromoSpy).toHaveBeenCalledWith('PROMO10', 'u');
        });

        it('should throw AMOUNT_INVALID if final amount < 0', async () => {
            validatePromoSpy.mockResolvedValueOnce({ discount: 15000 });
            await expect(
                paymentService.createPayment('u', 'ip', {
                    tokens: 10,
                    promoCode: 'PROMO10',
                })
            ).rejects.toMatchObject({
                status: ErrorMessage.AMOUNT_INVALID.status,
                message: ErrorMessage.AMOUNT_INVALID.message,
            });
        });

        it('should handle VNPAY gateway', async () => {
            const res = await paymentService.createPayment('u', 'ip', {
                tokens: 10,
                paymentGateway: PaymentGateway.VNPAY,
            });
            expect(vnpaySpy).toHaveBeenCalled();
            expect(res.payUrl).toBe('http://vnpay-mock-url');
        });

        it('should handle STRIPE gateway', async () => {
            const res = await paymentService.createPayment('u', 'ip', {
                tokens: 10,
                paymentGateway: PaymentGateway.STRIPE,
            });
            expect(stripeSpy).toHaveBeenCalled();
            expect(res.payUrl).toBe('http://stripe-mock-url');
        });

        it('should handle STRIPE gateway without url in session', async () => {
            stripeSpy.mockResolvedValueOnce({} as any);
            const res = await paymentService.createPayment('u', 'ip', {
                tokens: 10,
                paymentGateway: PaymentGateway.STRIPE,
            });
            expect(res.payUrl).toBe(''); // default
        });
    });

    describe('triggerExpiredPayment', () => {
        it('should update expired payments and log', async () => {
            await paymentService.triggerExpiredPayment();
            expect(mockedPayment.updateMany).toHaveBeenCalledWith(
                {
                    status: PaymentStatus.PENDING,
                    expiredAt: { $lte: expect.any(Date) },
                },
                { $set: { status: PaymentStatus.EXPIRED } }
            );
            expect(consoleLogSpy).toHaveBeenCalledWith('Expired 1 payments');
        });

        it('should not log if modifiedCount is 0', async () => {
            (mockedPayment.updateMany as any) = jest
                .fn()
                .mockResolvedValue({ modifiedCount: 0 });
            await paymentService.triggerExpiredPayment();
            expect(consoleLogSpy).not.toHaveBeenCalled();
        });
    });
});
