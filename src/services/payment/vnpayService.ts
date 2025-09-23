import { Payment, PaymentType } from '~/models/payment.js';
import crypto from 'crypto';
import { PaymentStatus } from '~/enum/paymentStatus.js';
import { User } from '~/models/userModel.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import moment from 'moment-timezone';
import QueryString from 'qs';
class VnPayService {
    private VNP_TMNCODE = process.env.VNP_TMNCODE!;
    private VNP_HASHSECRET = process.env.VNP_HASH_SECRET!;
    private VNP_URL = process.env.VNP_URL!;
    private VNP_RETURNURL = process.env.VNP_RETURN_URL!;

    // Hàm sắp xếp các tham số theo thứ tự tên tham số (tăng dần)
    private sortObject = (
        obj: Record<string, string | number>
    ): Record<string, string> => {
        let sorted: Record<string, string> = {};
        let str: string[] = [];
        let key: string;
        for (key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                str.push(encodeURIComponent(key));
            }
        }
        str.sort();
        for (let i = 0; i < str.length; i++) {
            sorted[str[i]] = encodeURIComponent(String(obj[str[i]])).replace(
                /%20/g,
                '+'
            );
        }
        return sorted;
    };

    // Hàm định dạng ngày tháng theo chuẩn của VNPay
    private formatDate(date: Date): string {
        return moment(date).format('YYYYMMDDHHmmss');
    }

    // Hàm tạo chữ ký bảo mật
    public generateSecureHash = (params: Record<string, string | number>) => {
        const sortedParams = this.sortObject(params);
        const signData = QueryString.stringify(sortedParams, { encode: false });
        return crypto
            .createHmac('sha512', this.VNP_HASHSECRET.trim())
            .update(signData)
            .digest('hex');
    };

    // Hàm tạo URL thanh toán VNPay nạp tiền
    public createVnpayPaymentUrl = async (
        payment: Partial<PaymentType>,
        ipAddress: string
    ) => {
        console.log(payment._id);
        const nowDate = new Date();
        let params: Record<string, string | number> = {
            vnp_Version: '2.1.0',
            vnp_Command: 'pay',
            vnp_TmnCode: this.VNP_TMNCODE.trim(),
            vnp_Locale: 'vn',
            vnp_CurrCode: 'VND',
            vnp_TxnRef: payment._id?.toString() || '',
            vnp_OrderInfo: `Mua ${payment.tokens} token`,
            vnp_OrderType: 'other',
            vnp_Amount: payment.amount! * 100,
            vnp_ReturnUrl: this.VNP_RETURNURL.trim(),
            vnp_ExpireDate: this.formatDate(
                new Date(nowDate.getTime() + 15 * 60 * 1000)
            ),
            vnp_IpAddr: ipAddress,
            vnp_CreateDate: this.formatDate(nowDate),
        };

        const signedParams = {
            ...params,
            vnp_SecureHash: this.generateSecureHash(params),
        };
        return `${this.VNP_URL}?${QueryString.stringify(signedParams, { encode: false })}`;
    };

    // Hàm xử lý phản hồi từ VNPay sau khi thanh toán
    public handleVnPayReturn = async (params: Record<string, string>) => {
        if (!params) throw new ApiError(ErrorMessage.PAYMENT_FAILED);

        let secureHash = params.vnp_SecureHash;

        if (!secureHash) throw new ApiError(ErrorMessage.SIGNATURE_INVALID);

        delete params.vnp_SecureHash;
        delete params.vnp_SecureHashType;

        const signed = this.generateSecureHash(params);

        const payment = await Payment.findOne({ _id: params.vnp_TxnRef });

        if (!payment) throw new ApiError(ErrorMessage.PROMOTION_NOT_FOUND);

        if (secureHash !== signed) {
            payment.status = PaymentStatus.FAILED;
            await payment.save();
            throw new ApiError(ErrorMessage.SIGNATURE_INVALID);
        }

        const isSuccess =
            params.vnp_ResponseCode === '00' &&
            params.vnp_TransactionStatus === '00';

        const receivedAmount = params.vnp_Amount
            ? parseInt(params.vnp_Amount) / 100
            : NaN;
        if (
            !Number.isNaN(receivedAmount) &&
            payment.amount !== receivedAmount
        ) {
            payment.status = PaymentStatus.FAILED;
            await payment.save();
            throw new ApiError(ErrorMessage.AMOUNT_NOT_MATCH);
        }

        payment.status = isSuccess
            ? PaymentStatus.SUCCEEDED
            : PaymentStatus.FAILED;
        await payment.save();

        return {
            success: isSuccess,
            message: isSuccess
                ? SuccessMessage.PAYMENT_STATUS_SUCCESS
                : ErrorMessage.PAYMENT_FAILED,
            paymentId: payment._id.toString(),
            status: payment.status,
        };
    };

    // Hàm xử lý IPN từ VNPay
    public handleVnPayIpn = async (params: Record<string, string>) => {
        try {
            if (!params) return { RspCode: '99', Message: 'No params' };
            const secureHash = params.vnp_SecureHash;

            if (!secureHash)
                return { RspCode: '97', Message: 'Missing signature' };

            delete params.vnp_SecureHash;
            delete params.vnp_SecureHashType;

            const signed = this.generateSecureHash(params);

            const payment = await Payment.findOne({ _id: params.vnp_TxnRef });

            if (!payment)
                return { RspCode: '01', Message: 'Payment not found' };

            if (secureHash !== signed)
                return { RspCode: '97', Message: 'Invalid signature' };

            if (payment.status === PaymentStatus.SUCCEEDED)
                return { RspCode: '02', Message: 'Already confirmed' };

            const receivedAmount = parseInt(params.vnp_Amount) / 100;

            if (receivedAmount !== payment.amount) {
                payment.status = PaymentStatus.FAILED;
                await payment.save();
                return { RspCode: '04', Message: 'Amount mismatch' };
            }

            const isSuccess =
                params.vnp_ResponseCode === '00' &&
                params.vnp_TransactionStatus === '00' &&
                receivedAmount === payment.amount;

            if (isSuccess) {
                payment.status = PaymentStatus.SUCCEEDED;
                await payment.save();

                const user = await User.findById(payment.user);

                if (user) {
                    await User.findByIdAndUpdate(payment.user, {
                        $inc: { credits: payment.tokens },
                    });
                }
                return { RspCode: '00', Message: 'Confirm Success' };
            } else {
                payment.status = PaymentStatus.FAILED;
                await payment.save();
                return { RspCode: '99', Message: 'Unknown Error' };
            }
        } catch (err) {
            console.error('IPN error:', err);
            return { RspCode: '99', Message: 'Internal error' };
        }
    };

    // Hàm hoàn tiền token nếu giao dịch thất bại
    public refundTokens = async (payment: Partial<PaymentType>) => {
        if (payment.status === PaymentStatus.SUCCEEDED || payment.tokens! <= 0)
            return;
        const user = await User.findById(payment.user);
        if (user && payment.tokens! > 0) {
            user.credits = (user.credits || 0) + payment.tokens;
            await user.save();
            await new Payment({
                user: payment.user,
                type: 'refund',
                tokens: payment.tokens,
                description: `Giao dịch thất bại ${payment._id}`,
                status: PaymentStatus.SUCCEEDED,
            }).save();
        }
    };
}

export default new VnPayService();
