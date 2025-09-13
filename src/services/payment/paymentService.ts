import { ErrorMessage } from "~/enum/errorMessage"
import { PaymentGateway } from "~/enum/paymentGateway";
import { PaymentStatus } from "~/enum/paymentStatus";
import { TransactionType } from "~/enum/transactionType";
import { ApiError } from "~/middleware/apiError"
import { Payment, PaymentType } from "~/models/payment";
import { PromoCode } from "~/models/promoCode";
import vnpayService from "./vnpayService";

class PaymentService {
    public createPayment = async (userId: string,  ipAddr: string, request: Partial<PaymentType>) => {
        if(request.tokens! <= 0)
            throw new ApiError(ErrorMessage.TOKEN_INVALID);

        const amount = request.tokens! * 1000;
        const now = new Date();
        const expiredAt = new Date(now.getTime() + 15 * 60 * 1000); // Hết hạn sau 15 phút

        const payment = new Payment({
            user: userId,
            type: TransactionType.PURCHASE,
            tokens: request.tokens,
            description: request.description,
            amount,
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

export default new PaymentService();