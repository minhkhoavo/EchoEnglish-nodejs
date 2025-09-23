import { ErrorMessage } from '~/enum/errorMessage.js';
import { PaymentGateway } from '~/enum/paymentGateway.js';
import { PaymentStatus } from '~/enum/paymentStatus.js';
import { TransactionType } from '~/enum/transactionType.js';
import { ApiError } from '~/middleware/apiError.js';
import { Payment, PaymentType } from '~/models/payment.js';
import { PromoCode, PromoCodeType } from '~/models/promoCode.js';
import vnpayService from './vnpayService.js';
import { User, UserType } from '../../models/userModel.js';
import stripeService from './stripeService.js';

class PaymentService {
    public async getTransactionById(id: string): Promise<PaymentType | null> {
        const payment = await Payment.findById(id).lean<PaymentType>().exec();
        if (!payment) {
            throw new ApiError(ErrorMessage.PAYMENT_NOT_FOUND);
        }
        return payment;
    }

    /* Lay danh sach payment */
    getTransactions = async ({
        userId,
        status,
        type,
        gateway,
        page,
        limit,
    }: TransactionFilter) => {
        const query: Record<string, unknown> = {};
        if (userId) {
            query.user = userId;
        }

        if (status != null) {
            if (
                Object.values(PaymentStatus).includes(status as PaymentStatus)
            ) {
                query.status = status;
            } else {
                throw new ApiError(ErrorMessage.PAYMENT_STATUS_NOT_FOUND);
            }
        }

        if (type != null) {
            if (
                Object.values(TransactionType).includes(type as TransactionType)
            ) {
                query.type = type;
            } else {
                throw new ApiError(ErrorMessage.TRANSACTION_TYPE_NOT_FOUND);
            }
        }

        if (gateway != null) {
            if (
                gateway &&
                Object.values(PaymentGateway).includes(
                    gateway as PaymentGateway
                )
            ) {
                query.paymentGateway = gateway;
            } else {
                throw new ApiError(ErrorMessage.PAYMENT_GATEWAY_NOT_FOUND);
            }
        }

        const skip = (page - 1) * limit;
        const [transaction, total] = await Promise.all([
            Payment.find(query)
                .sort({ createAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Payment.countDocuments(query),
        ]);

        return {
            transaction,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    };

    /* Sử dụng token cua user để thanh toan */
    useToken = async ({
        userId,
        tokens,
        promoCode,
        description,
    }: UseTokenInput) => {
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        if (!tokens || tokens <= 0) {
            throw new ApiError(ErrorMessage.INVALID_TOKEN_AMOUNT);
        }

        const user = await User.findById(userId).lean<UserType>().exec();
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }

        /* xu ly promo */
        let promo;
        if (promoCode) {
            promo = await PromoCode.findOne({ code: promoCode, active: true })
                .lean<PromoCodeType>()
                .exec();
            if (!promo) {
                throw new ApiError(ErrorMessage.PROMOTION_NOT_FOUND);
            }

            if (promo.usageLimit && promo.usageLimit <= promo.usedCount) {
                throw new ApiError(ErrorMessage.PROMO_USAGE_LIMIT_REACHED);
            }
            /* het han dung */
            if (promo.expiration && promo.expiration <= new Date()) {
                throw new ApiError(ErrorMessage.PROMO_EXPIRED);
            }
            /* Giam tien */
            let discountedTokens = tokens - promo.discount;
            if (discountedTokens < 0) {
                discountedTokens = 0;
            }

            tokens = discountedTokens;
            await PromoCode.updateOne(
                { _id: promo._id },
                { $inc: { usedCount: 1 } }
            );
        }

        /* Sau giam gia van khong du tien */
        if (user.credits < tokens) {
            throw new ApiError(ErrorMessage.NOT_ENOUGH_TOKENS);
        }

        // cập nhật token user
        const userUpdated = await User.findByIdAndUpdate(
            { _id: user._id },
            { $inc: { credits: -tokens } },
            { new: true }
        )
            .lean<UserType>()
            .exec();

        // Lưu transaction
        const transaction = await Payment.create({
            user: user._id,
            type: TransactionType.DEDUCTION,
            tokens,
            description,
            promoCode: promo?._id,
            amount: 0,
            status: PaymentStatus.SUCCEEDED,
        });

        return {
            transactionId: transaction._id,
            status: transaction.status,
            tokensDeducted: tokens,
            userTokenBalance: userUpdated?.credits,
        };
    };

    /* Tạo payment nạp tiền (cộng token) */
    public createPayment = async (
        userId: string,
        ipAddr: string,
        request: Partial<PaymentType>
    ) => {
        if (!request.tokens && request.tokens! <= 0)
            throw new ApiError(ErrorMessage.TOKEN_INVALID);

        let amount = request.tokens! * 1000;
        if (request.promoCode) {
            const promo = await PromoCode.findOne({ code: request.promoCode });
            amount = amount * (1 - promo.discount / 100);
        }

        if (amount < 0) throw new ApiError(ErrorMessage.AMOUNT_INVALID);

        const now = new Date();
        const expiredAt = new Date(now.getTime() + 15 * 60 * 1000); // Hết hạn sau 15 phút

        const payment = new Payment({
            user: userId,
            type: TransactionType.PURCHASE,
            tokens: request.tokens,
            description: request.description,
            amount,
            promoCode: request.promoCode,
            status: PaymentStatus.PENDING,
            paymentGateway: request.paymentGateway,
            expiredAt,
        });

        await payment.save();

        let payUrl = ''; // chung cho cả gateway
        /* Thanh toan = vnpay */
        if (payment.paymentGateway == PaymentGateway.VNPAY) {
            const vnpUrl = await vnpayService.createVnpayPaymentUrl(
                payment,
                ipAddr
            );
            payment.payUrl = vnpUrl;
            await payment.save();
            payUrl = vnpUrl;
        }
        /* Thanh toan = stripe */
        if (payment.paymentGateway == PaymentGateway.STRIPE) {
            const session = await stripeService.createCheckoutSession(payment);
            if (session && session.url) {
                payment.payUrl = session.url;
                await payment.save();
                payUrl = session.url;
            }
        }

        return {
            paymentId: payment._id,
            payUrl,
            amount: payment.amount,
            status: payment.status,
            expiredAt: payment.expiredAt,
        };
    };

    public triggerExpiredPayment = async () => {
        const now = new Date();
        const result = await Payment.updateMany(
            {
                status: PaymentStatus.PENDING,
                expiredAt: { $lte: now },
            },
            { $set: { status: PaymentStatus.EXPIRED } }
        );

        if (result.modifiedCount > 0) {
            console.log(`Expired ${result.modifiedCount} payments`);
        }
    };
}

interface UseTokenInput {
    userId?: string;
    tokens: number;
    promoCode?: string;
    description?: string;
}

interface TransactionFilter {
    userId: string;
    status?: string;
    type?: string;
    gateway?: string;
    page: number;
    limit: number;
}

export default new PaymentService();
