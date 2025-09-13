import { Payment, PaymentType } from "~/models/payment";
import querystring from "querystring";
import crypto from "crypto";
import { PaymentStatus } from "~/enum/paymentStatus";
import { User } from "~/models/userModel";
import { ErrorMessage } from "~/enum/errorMessage";
import { SuccessMessage } from "~/enum/successMessage";
import { PromoCode } from "~/models/promoCode";
import { ApiError } from "~/middleware/apiError";
import moment from "moment-timezone";
import QueryString from "qs";
class VnPayService {
    private VNP_TMNCODE = process.env.VNP_TMNCODE!;
    private VNP_HASHSECRET = process.env.VNP_HASH_SECRET!;
    private VNP_URL = process.env.VNP_URL!;
    private VNP_RETURNURL = process.env.VNP_RETURN_URL!;

    private sortObject = (obj: Record<string, any>): Record<string, any> => {
        let sorted: Record<string,any> = {};
        let str:string[] = [];
        let key: string;
        for (key in obj){
            if (obj.hasOwnProperty(key)) {
            str.push(encodeURIComponent(key));
            }
        }
        str.sort();
        for (let i = 0; i < str.length; i++) {
            sorted[str[i]] = encodeURIComponent(obj[str[i]]).replace(/%20/g, "+");
        }
        return sorted;
    };

    private formatDate(date: Date): string {
        return moment(date).format('YYYYMMDDHHmmss');
    }

    public generateSecureHash = (params: Record<string, any>) => {
        const sortedParams = this.sortObject(params);
        const signData = QueryString.stringify(sortedParams, { encode: false });
        return crypto.createHmac("sha512", this.VNP_HASHSECRET.trim()).update(signData).digest("hex");
    };

    public createVnpayPaymentUrl = async (payment: Partial<PaymentType>, ipAddress: string) => {
        console.log(payment._id);
        const nowDate = new Date();
        let params: Record<string, any> = {
            vnp_Version: "2.1.0",
            vnp_Command: "pay",
            vnp_TmnCode: this.VNP_TMNCODE.trim(),
            vnp_Locale: "vn",
            vnp_CurrCode: "VND",
            vnp_TxnRef: payment._id?.toString() || "",
            vnp_OrderInfo: `Mua ${payment.tokens} token`,
            vnp_OrderType: "other",
            vnp_Amount: payment.amount! * 100,
            vnp_ReturnUrl: this.VNP_RETURNURL.trim(),
            vnp_ExpireDate: this.formatDate(new Date(nowDate.getTime() + 15 * 60 * 1000)),
            vnp_IpAddr: ipAddress,
            vnp_CreateDate: this.formatDate(nowDate),
        };

        const signedParams = { ...params, vnp_SecureHash: this.generateSecureHash(params) };
        console.log(signedParams);
        console.log("VNP_URL URL:", `${this.VNP_URL}?${QueryString.stringify(signedParams, { encode: false })}`);
        return `${this.VNP_URL}?${QueryString.stringify(signedParams, { encode: false })}`;
    }

    public handleVnPayReturn = async (params: Record<string, any>) => {
        let secureHash = params.vnp_SecureHash;
        delete params.vnp_SecureHash;
        delete params.vnp_SecureHashType;
        const signed = this.generateSecureHash(params);

        const payment = await Payment.findOne({ _id: params.vnp_TxnRef });
        if (!payment) throw new ApiError(ErrorMessage.PROMOTION_NOT_FOUND);

        if(secureHash !== signed){
            payment.status = PaymentStatus.FAILED;
            await payment.save();
            throw new ApiError(ErrorMessage.SIGNATURE_INVALID);
        }

        const isSuccess = params.vnp_ResponseCode === "00" && params.vnp_TransactionStatus === "00";
        payment.status = isSuccess ? PaymentStatus.PENDING : PaymentStatus.FAILED;
        await payment.save();

        return {
            success: isSuccess, 
            message: isSuccess ? SuccessMessage.PAYMENT_PENDING : ErrorMessage.PAYMENT_FAILED, 
            paymentId: payment._id.toString(), 
            status: payment.status 
        };
        
    }

    public handleVnPayIpn = async (params: Record<string, any>) => {
        const secureHash = params.vnp_SecureHash;
        delete params.vnp_SecureHash;
        delete params.vnp_SecureHashType;
        const signed = this.generateSecureHash(params);
        const payment = await Payment.findOne({ _id: params.vnp_TxnRef });
        if (!payment) return {RspCode: "01", Message: "Payment not found"};

        if(secureHash !== signed) return {RspCode: "97", Message: "Invalid signature"};
        if (payment.status === PaymentStatus.SUCCEEDED) return {RspCode: "02", Message: "Already confirmed"};

        const receivedAmount = parseInt(params.vnp_Amount) / 100;
        const isSuccess = params.vnp_ResponseCode === "00" && params.vnp_TransactionStatus === "00" && receivedAmount === payment.amount;

        if(isSuccess) {
            payment.status = PaymentStatus.SUCCEEDED;
            await payment.save();
            const user = await User.findById(payment.user);
            if(user) {
                await User.findByIdAndUpdate(payment.user, { $inc: { tokens: payment.tokens } });
            }
            if(payment.promoCode) {
                const promotion = await PromoCode.findOne({ code: payment.promoCode });
                if(promotion) {
                    promotion.usedCount += 1;
                    if(promotion.usedCount >= promotion.usageLimit) promotion.active = false;
                    await promotion.save();
                }
            }
            return {RspCode: "00", Message: "Confirm Success"};
        }
        else{
            payment.status = PaymentStatus.FAILED;
            await payment.save();
            return { RspCode: "99", Message: "Unknown Error" };;
        }
    }

    public refundTokens = async (payment: Partial<PaymentType>) => {
        if (payment.status === PaymentStatus.SUCCEEDED || payment.tokens! <=0) return; // Không hoàn nếu đã thành công
        const user = await User.findById(payment.user);
        if (user && payment.tokens! > 0) {
            user.tokens = (user.tokens || 0) + payment.tokens; // Hoàn lại token đã cộng trước đó (nếu có)
            await user.save();
            await new Payment({
                user: payment.user,
                type: "refund",
                tokens: payment.tokens,
                description: `Hoàn trả token từ giao dịch thất bại ${payment._id}`,
                status: PaymentStatus.SUCCEEDED,
            }).save();
        }
    }
}

export default new VnPayService();