import { ErrorMessage } from "~/enum/errorMessage"
import { PaymentGateway } from "~/enum/paymentGateway";
import { PaymentStatus } from "~/enum/paymentStatus";
import { TransactionType } from "~/enum/transactionType";
import { ApiError } from "~/middleware/apiError"
import { Payment, PaymentType } from "~/models/payment";
import { PromoCode } from "~/models/promoCode";
import vnpayService from "./vnpayService";
import { User, UserType } from "../../models/userModel";

class PaymentService {
   public async getTransactionById(id: string): Promise<PaymentType | null> {
    const payment = await Payment.findById(id).lean<PaymentType>().exec();
    if(!payment){
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
    const query: any = {};
    if (userId) {
      query.user = userId;
    }

    if (status != null) {
      if (Object.values(PaymentStatus).includes(status as PaymentStatus)) {
        query.status = status;
      } else {
        throw new ApiError(ErrorMessage.PAYMENT_STATUS_NOT_FOUND);
      }
    }

    if (type != null) {
      if (Object.values(TransactionType).includes(type as TransactionType)) {
        query.type = type;
      } else {
        throw new ApiError(ErrorMessage.TRANSACTION_TYPE_NOT_FOUND);
      }
    }

    if (gateway != null) {
      if (
        gateway &&
        Object.values(PaymentGateway).includes(gateway as PaymentGateway)
      ) {
        query.paymentGateway = gateway;
      } else {
        throw new ApiError(ErrorMessage.PAYMENT_GATEWAY_NOT_FOUND);
      }
    }

    const skip = (page - 1) * limit;
    const [transaction, total] = await Promise.all([
      Payment.find(query).sort({ createAt: -1 }).skip(skip).limit(limit).lean(),
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
  useToken = async ({ userId, tokens, description }: UseTokenInput) => {
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

    if (user.token < tokens) {
      throw new ApiError(ErrorMessage.NOT_ENOUGH_TOKENS);
    }

    // Trừ token
    await User.updateOne({ _id: user._id }, { $inc: { token: -tokens } });

    // Lưu transaction
    const transaction = await Payment.create({
      user: user._id,
      type: TransactionType.DEDUCTION,
      tokens,
      description,
      amount: 0,
      status: PaymentStatus.SUCCEEDED,
    });

    return {
      transactionId: transaction._id,
      status: transaction.status,
      tokensDeducted: tokens,
      userTokenBalance: user.token,
    };
  };

    public createPayment = async (userId: string,  ipAddr: string, request: Partial<PaymentType>) => {
        if(request.tokens! <= 0)
            throw new ApiError(ErrorMessage.TOKEN_INVALID);

        let discount = 0;
        // Kiểm tra nếu có mã giảm giá, áp dụng mã giảm giá
        if(request.promoCode) {
            const promotion = await PromoCode.findOne({
                code: request.promoCode,
                active: true,
                $or: [{ expiration: { $exists: false } }, { expiration: { $gt: new Date() } }],
            });

            if(!promotion || promotion.usedCount >= promotion.usageLimit) {
                throw new ApiError(ErrorMessage.PROMOTION_NOT_FOUND);
            }

            discount = promotion.discount;
        }

        const amount = Math.max(request.tokens! * 1000 - discount, 0);
        const now = new Date();
        const expiredAt = new Date(now.getTime() + 15 * 60 * 1000); // Hết hạn sau 15 phút

        const payment = new Payment({
            user: userId,
            type: TransactionType.PURCHASE,
            tokens: request.tokens,
            description: request.description,
            amount,
            discount,
            promoCode: request.promoCode,
            status: PaymentStatus.INITIATED,
            paymentGateway: request.paymentGateway,
            expiredAt,
        });

        await payment.save();

        let vnpUrl = "";
        if(payment.paymentGateway == PaymentGateway.VNPAY) {
            vnpUrl = await vnpayService.createVnpayPaymentUrl(payment, ipAddr);
            payment.payUrl = vnpUrl;
            await payment.save();
        }
        

        return {
            paymentId: payment._id,
            payUrl: vnpUrl, 
            amount: payment.amount,
            status: payment.status,
            expiredAt: payment.expiredAt,
        };
        
    }
}

interface UseTokenInput {
  userId?: string;
  tokens: number;
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