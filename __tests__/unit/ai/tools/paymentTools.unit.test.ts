/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.STRIPE_SECRET_KEY = 'test_key';
import paymentService from '~/services/payment/paymentService.js';

const createPaymentSpy = jest
    .spyOn(paymentService, 'createPayment')
    .mockImplementation();
const getTransactionsSpy = jest
    .spyOn(paymentService, 'getTransactions')
    .mockImplementation();

import { paymentTools } from '~/ai/tools/paymentTools.js';
import { PaymentGateway } from '~/enum/paymentGateway.js';

describe('paymentTools', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    const [createPaymentTool, getTop5TransactionsTool] = paymentTools as any[];

    beforeEach(() => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
    });

    describe('createPaymentTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(
                createPaymentTool.invoke(
                    { credits: 10, paymentGateway: PaymentGateway.VNPAY },
                    {}
                )
            ).rejects.toThrow('userId required');
        });

        it('should create payment', async () => {
            createPaymentSpy.mockResolvedValue({
                redirectUrl: 'http://pay',
            } as any);

            const result = await createPaymentTool.invoke(
                {
                    credits: 10,
                    paymentGateway: PaymentGateway.VNPAY,
                    description: 'desc',
                    promoCode: 'promo',
                },
                { configurable: { userId: 'user-1' } }
            );

            expect(createPaymentSpy).toHaveBeenCalledWith(
                'user-1',
                '127.0.0.1',
                {
                    tokens: 10,
                    paymentGateway: PaymentGateway.VNPAY,
                    description: 'desc',
                    promoCode: 'promo',
                }
            );

            expect(result).toBe(
                'Payment created: {"redirectUrl":"http://pay"}'
            );
        });
    });

    describe('getTop5TransactionsTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(
                getTop5TransactionsTool.invoke({}, {})
            ).rejects.toThrow('userId required');
        });

        it('should get transactions and map correctly', async () => {
            getTransactionsSpy.mockResolvedValue({
                transaction: [
                    {
                        _id: 'tx1',
                        type: 'buy',
                        tokens: 10,
                        amount: 10000,
                        status: 'success',
                        description: 'desc',
                        createAt: new Date('2023-01-01'),
                    },
                    {
                        _id: 'tx2',
                        type: 'bonus',
                        tokens: 5,
                        amount: 0,
                        status: 'success',
                        createAt: new Date('2023-01-02'),
                    },
                ],
                pagination: { totalPages: 1 },
            } as any);

            const result = await getTop5TransactionsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );

            expect(getTransactionsSpy).toHaveBeenCalledWith({
                userId: 'user-1',
                page: 1,
                limit: 5,
            });

            const parsed = JSON.parse(result);
            expect(parsed.transactions).toHaveLength(2);
            expect(parsed.transactions[0].id).toBe('tx1');
            expect(parsed.transactions[0].description).toBe('desc');
            expect(parsed.transactions[1].id).toBe('tx2');
            expect(parsed.transactions[1].description).toBeUndefined(); // test fallback
        });
    });
});
