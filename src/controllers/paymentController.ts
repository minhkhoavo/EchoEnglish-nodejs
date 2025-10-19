import { Request, Response } from 'express';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import paymentService from '~/services/payment/paymentService.js';
import vnpayService from '~/services/payment/vnpayService.js';
import stripeService from '../services/payment/stripeService.js';
import { User, UserType } from '~/models/userModel.js';
import { Payment, PaymentType } from '~/models/payment.js';
import { PaymentStatus } from '~/enum/paymentStatus.js';
class PaymentController {
    public stripeWebhook = async (req: Request, res: Response) => {
        const stripeSig = req.headers['stripe-signature'] as string | undefined;
        if (!stripeSig) {
            console.error('Missing stripe-signature header');
            return res.status(400).send('Missing signature');
        }

        try {
            const StripeLib = await import('stripe');
            const stripe = new StripeLib.default(
                process.env.STRIPE_SECRET_KEY || ''
            );

            const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
            const event = stripe.webhooks.constructEvent(
                req.body,
                stripeSig,
                webhookSecret
            );

            // delegate handling to stripeService
            const result = await stripeService.handleEvent(event);

            // Webhook is server-to-server. Do not redirect the caller (Stripe).
            // If the event is a checkout session completion we simply log it;
            // the handler (stripeService.handleEvent) already updates DB and credits tokens.
            if (event.type === 'checkout.session.completed') {
                const session = event.data.object as unknown as {
                    metadata?: { paymentId?: string };
                };
                const paymentId = session?.metadata?.paymentId;
                console.log(
                    `Received webhook checkout.session.completed for paymentId=${paymentId}`
                );
            }

            if (result && result.handled) {
                return res.status(200).json({ received: true });
            } else {
                return res
                    .status(200)
                    .json({ received: true, note: 'unhandled_event' });
            }
        } catch (err: unknown) {
            const errorMessage =
                err instanceof Error ? err.message : String(err);
            console.error('Stripe webhook error:', err);
            return res.status(400).send(`Webhook Error: ${errorMessage}`);
        }
    };

    public stripeReturn = async (req: Request, res: Response) => {
        const sessionId = (req.query.session_id ?? req.query.sessionId) as
            | string
            | undefined;
        if (!sessionId) throw new ApiError(ErrorMessage.PAYMENT_FAILED);

        try {
            const { default: Stripe } = await import('stripe');
            const secret = (process.env.STRIPE_SECRET_KEY || '').trim();
            const stripe = new Stripe(secret);

            const session = await stripe.checkout.sessions.retrieve(sessionId);
            const paymentId = session?.metadata?.paymentId as
                | string
                | undefined;
            const paid = session?.payment_status === 'paid';

            let status: PaymentStatus = PaymentStatus.FAILED;

            if (paymentId) {
                const payment = await Payment.findById(
                    paymentId
                ).lean<PaymentType | null>();
                if (payment?.status === PaymentStatus.SUCCEEDED || paid) {
                    status = PaymentStatus.SUCCEEDED;
                }
            } else if (paid) {
                status = PaymentStatus.SUCCEEDED;
            }

            const frontend = (process.env.FRONTEND_URL || '').trim();
            if (!frontend) {
                return res
                    .status(200)
                    .json({ sessionId, paymentId: paymentId ?? null, status });
            }

            const redirectUrl = new URL('/payment/callback', frontend);
            redirectUrl.searchParams.set('paymentId', paymentId ?? '');
            redirectUrl.searchParams.set('status', String(status));

            return res.redirect(302, redirectUrl.toString());
        } catch (err) {
            console.error('Stripe return error:', err);
            throw new ApiError(ErrorMessage.PAYMENT_FAILED);
        }
    };

    public getTransactionById = async (req: Request, res: Response) => {
        const payment = await paymentService.getTransactionById(req.params.id);
        res.status(200).json(
            new ApiResponse(SuccessMessage.GET_PAYMENT_SUCCESS, payment)
        );
    };

    public getTransactions = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        const { status, type, gateway, page, limit } = req.query;

        const result = await paymentService.getTransactions({
            userId: userId as string,
            status: status as string,
            type: type as string,
            gateway: gateway as string,
            page: page ? parseInt(page as string, 1) : 1,
            limit: limit ? parseInt(limit as string, 10) : 10,
        });
        res.status(200).json(
            new ApiResponse(SuccessMessage.GET_SUCCESS, result)
        );
    };

    public useToken = async (req: Request, res: Response) => {
        const { tokens, promoCode, description } = req.body;
        const result = await paymentService.useToken({
            userId: req.user?.id,
            tokens,
            promoCode,
            description,
        });

        res.status(200).json(
            new ApiResponse(SuccessMessage.USE_TOKEN_SUCCESS, result)
        );
    };
    public createPayment = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) throw new ApiError(ErrorMessage.USER_NOT_FOUND);

        const { credits, paymentGateway, description, promoCode } = req.body;

        if (credits === undefined || credits === null)
            throw new ApiError(ErrorMessage.TOKENS_REQUIRED);
        if (!paymentGateway)
            throw new ApiError(ErrorMessage.PAYMENT_GATEWAY_NOT_FOUND);

        let ipAddr = '127.0.0.1';

        const result = await paymentService.createPayment(userId!, ipAddr, {
            tokens: credits,
            paymentGateway,
            description,
            promoCode,
        });

        return res
            .status(201)
            .json(
                new ApiResponse(SuccessMessage.CREATE_PAYMENT_SUCCESS, result)
            );
    };

    public vnPayReturn = async (req: Request, res: Response) => {
        const params = req.query as Record<string, unknown>;

        // Convert query params to proper string record
        const paramRecord: Record<string, string> = {};
        Object.keys(params).forEach((key) => {
            const value = params[key];
            if (typeof value === 'string') {
                paramRecord[key] = value;
            }
        });

        type VnPaySuccess = {
            success: true;
            redirectUrl: string;
            paymentId: string;
            status: string | number;
        };

        type VnPayFail = {
            success: false | boolean;
            message?: string;
            paymentId?: string;
            status?: string | number;
        };

        type VnPayResult = VnPaySuccess | VnPayFail;

        const result = (await vnpayService.handleVnPayReturn(
            paramRecord
        )) as VnPayResult;
        if (!result) throw new ApiError(ErrorMessage.PAYMENT_FAILED);

        // Expect the service to return a redirectUrl on success
        if (
            'redirectUrl' in result &&
            typeof result.redirectUrl === 'string' &&
            result.redirectUrl
        ) {
            return res.redirect(302, result.redirectUrl);
        } else {
            // Failure: redirect to frontend callback with status=failed
            const FRONTEND_URL = (process.env.FRONTEND_URL || '').trim();
            if (!FRONTEND_URL) {
                // If frontend URL is not set, throw an error so monitoring/logging will catch it
                const fail = result as VnPayFail;
                const msg = fail.message
                    ? fail.message.toString()
                    : ErrorMessage.PAYMENT_FAILED.message;
                throw new ApiError({ message: msg });
            }

            const callbackUrl = `${FRONTEND_URL.replace(/\/$/, '')}/payment/callback?status=failed`;
            return res.redirect(302, callbackUrl);
        }
    };

    public vnPayIpn = async (req: Request, res: Response) => {
        const params = req.query;

        // Convert query params to proper string record
        const paramRecord: Record<string, string> = {};
        Object.keys(params).forEach((key) => {
            const value = params[key];
            if (typeof value === 'string') {
                paramRecord[key] = value;
            }
        });

        const result = await vnpayService.handleVnPayIpn(paramRecord);
        return res.status(200).json(result);
    };

    public getCredit = async (req: Request, res: Response) => {
        if (!req.user || !req.user.id) {
            return res
                .status(401)
                .json(new ApiError(ErrorMessage.UNAUTHORIZED));
        }
        const userId = req.user.id;
        const user = (await User.findById(
            userId
        ).lean()) as unknown as UserType;
        if (!user) {
            return res
                .status(404)
                .json(new ApiError(ErrorMessage.USER_NOT_FOUND));
        }
        return res.status(200).json(
            new ApiResponse(SuccessMessage.GET_SUCCESS, {
                credits: user.credits,
            })
        );
    };
}

export default new PaymentController();
