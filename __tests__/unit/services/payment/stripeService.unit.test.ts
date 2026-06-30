/* eslint-disable @typescript-eslint/no-explicit-any */
import Stripe from 'stripe';
import stripeService from '~/services/payment/stripeService.js';
import { Payment } from '~/models/payment.js';
import { User } from '~/models/userModel.js';
import { PaymentStatus } from '~/enum/paymentStatus.js';
import notificationService from '~/services/notifications/notificationService.js';

jest.mock('stripe', () => {
    const mockCreateSession = jest
        .fn()
        .mockResolvedValue({ url: 'http://stripe.com/session' });
    return jest.fn().mockImplementation(() => ({
        checkout: {
            sessions: {
                create: mockCreateSession,
            },
        },
    }));
});
jest.mock('~/models/payment.js');
jest.mock('~/models/userModel.js');

const mockedPayment = Payment as jest.Mocked<typeof Payment>;
const mockedUser = User as jest.Mocked<typeof User>;

describe('StripeService', () => {
    let pushNotificationSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        (new Stripe('').checkout.sessions.create as jest.Mock).mockClear();
        pushNotificationSpy = jest
            .spyOn(notificationService, 'pushNotification')
            .mockResolvedValue(undefined as any);
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        (mockedPayment.findById as any) = jest.fn().mockResolvedValue({
            _id: 'payment-1',
            status: PaymentStatus.PENDING,
            user: 'user-1',
            tokens: 10,
            amount: 10000,
            save: jest.fn().mockResolvedValue(true),
        });

        (mockedUser.findByIdAndUpdate as any) = jest.fn().mockResolvedValue({});
        (mockedUser.findById as any) = jest
            .fn()
            .mockResolvedValue({ _id: { toString: () => 'user-1' } });
    });

    afterEach(() => {
        pushNotificationSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    describe('createCheckoutSession', () => {
        it('should call stripe.checkout.sessions.create and return session', async () => {
            const stripeInstance = new Stripe('');
            const payment = {
                _id: { toString: () => 'p-1' },
                amount: 1500.5,
                tokens: 10,
                user: { toString: () => 'u-1' },
            };
            const res = await stripeService.createCheckoutSession(
                payment as any
            );

            expect(
                stripeInstance.checkout.sessions.create as jest.Mock
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    line_items: expect.arrayContaining([
                        expect.objectContaining({
                            price_data: expect.objectContaining({
                                unit_amount: 1501,
                            }),
                        }),
                    ]),
                    metadata: { paymentId: 'p-1', userId: 'u-1' },
                })
            );
            expect(res).toEqual({ url: 'http://stripe.com/session' });
        });

        it('should handle missing amount and user safely', async () => {
            const stripeInstance = new Stripe('');
            const payment = { _id: { toString: () => 'p-1' }, tokens: 10 };
            await stripeService.createCheckoutSession(payment as any);
            expect(
                stripeInstance.checkout.sessions.create as jest.Mock
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    metadata: { paymentId: 'p-1', userId: '' },
                })
            );
        });
    });

    describe('handleEvent', () => {
        it('should return handled false for non checkout.session.completed event', async () => {
            const res = await stripeService.handleEvent({
                type: 'other.event',
            } as any);
            expect(res).toEqual({ handled: false });
        });

        it('should return handled true if no paymentId in metadata', async () => {
            const event = {
                type: 'checkout.session.completed',
                data: { object: { metadata: {} } },
            };
            const res = await stripeService.handleEvent(event as any);
            expect(res).toEqual({ handled: true });
        });

        it('should return handled false and message if payment not found', async () => {
            (mockedPayment.findById as any) = jest.fn().mockResolvedValue(null);
            const event = {
                type: 'checkout.session.completed',
                data: { object: { metadata: { paymentId: 'p-1' } } },
            };
            const res = await stripeService.handleEvent(event as any);
            expect(res).toEqual({
                handled: false,
                message: 'Payment not found',
            });
        });

        it('should return handled true if payment is already SUCCEEDED', async () => {
            (mockedPayment.findById as any) = jest
                .fn()
                .mockResolvedValue({ status: PaymentStatus.SUCCEEDED });
            const event = {
                type: 'checkout.session.completed',
                data: { object: { metadata: { paymentId: 'p-1' } } },
            };
            const res = await stripeService.handleEvent(event as any);
            expect(res).toEqual({ handled: true });
        });

        it('should mark payment as succeeded, add credits, and notify user', async () => {
            const mockSave = jest.fn();
            (mockedPayment.findById as any) = jest.fn().mockResolvedValue({
                _id: 'p-1',
                status: PaymentStatus.PENDING,
                user: 'u-1',
                tokens: 10,
                amount: 10000,
                save: mockSave,
            });

            const event = {
                type: 'checkout.session.completed',
                data: { object: { metadata: { paymentId: 'p-1' } } },
            };
            const res = await stripeService.handleEvent(event as any);

            expect(mockSave).toHaveBeenCalled();
            expect(mockedUser.findByIdAndUpdate).toHaveBeenCalledWith('u-1', {
                $inc: { credits: 10 },
            });
            expect(pushNotificationSpy).toHaveBeenCalledWith(
                'user-1',
                expect.anything()
            );
            expect(res).toEqual({ handled: true });
        });

        it('should not add credits or notify if user or tokens are missing', async () => {
            const mockSave = jest.fn();
            (mockedPayment.findById as any) = jest.fn().mockResolvedValue({
                _id: 'p-1',
                status: PaymentStatus.PENDING,
                save: mockSave,
                tokens: 0,
            });

            const event = {
                type: 'checkout.session.completed',
                data: { object: { metadata: { paymentId: 'p-1' } } },
            };
            await stripeService.handleEvent(event as any);

            expect(mockedUser.findByIdAndUpdate).not.toHaveBeenCalled();
            expect(pushNotificationSpy).not.toHaveBeenCalled();
        });

        it('should not notify if user not found for notification', async () => {
            const mockSave = jest.fn();
            (mockedPayment.findById as any) = jest.fn().mockResolvedValue({
                _id: 'p-1',
                status: PaymentStatus.PENDING,
                user: 'u-1',
                tokens: 10,
                save: mockSave,
            });
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(null);

            const event = {
                type: 'checkout.session.completed',
                data: { object: { metadata: { paymentId: 'p-1' } } },
            };
            await stripeService.handleEvent(event as any);

            expect(mockedUser.findByIdAndUpdate).toHaveBeenCalled();
            expect(pushNotificationSpy).not.toHaveBeenCalled();
        });

        it('should catch errors and return handled false with error', async () => {
            const error = new Error('DB error');
            (mockedPayment.findById as any) = jest
                .fn()
                .mockRejectedValue(error);
            const event = {
                type: 'checkout.session.completed',
                data: { object: { metadata: { paymentId: 'p-1' } } },
            };
            const res = await stripeService.handleEvent(event as any);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Stripe webhook handling error:',
                error
            );
            expect(res).toEqual({ handled: false, error });
        });
    });
});
