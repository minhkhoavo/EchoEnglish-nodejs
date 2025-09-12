import { VNPay } from "vnpay";
import { TransactionModelType } from "~/models/payment";
import querystring from "querystring";
import crypto from "crypto";
class VnPayService {
    VNP_TMNCODE = process.env.VNP_TMNCODE!;
    VNP_HASHSECRET = process.env.VNP_HASH_SECRET!;
    VNP_URL = process.env.VNP_URL!;
    VNP_RETURNURL = process.env.VNP_RETURN_URL!;

    private sortObject(obj: Record<string, any>): Record<string, any> {
        const sorted: Record<string, any> = {};
        const keys = Object.keys(obj).sort();
        keys.forEach((key) => {
            sorted[key] = obj[key];
        });
        return sorted;
    }

    private formatDate(date: Date): string {
        return date.toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
    }

    public createVnpayPaymentUrl = async (transaction: Partial<TransactionModelType>, ipAddress: string, locale: string) => {
        const nowDate = new Date();
        let params: Record<string, any> = {
            vnp_Version: "2.1.0",
            vnp_Command: "pay",
            vnp_TmnCode: this.VNP_TMNCODE,
            vnp_Amount: transaction.amount_vnd! * 100,
            vnp_CreateDate: this.formatDate(nowDate),
            vnp_CurrCode: "VND",
            vnp_IpAddr: ipAddress,
            vnp_Locale: locale || "vn",
            vnp_OrderInfo: `Mua ${transaction.tokens} token`,
            vnp_OrderType: "other",
            vnp_ReturnUrl: this.VNP_RETURNURL,
            vnp_ExpireDate: this.formatDate(transaction.expiredAt || nowDate),
            vnp_TxnRef: transaction.transactionRef || "",
        };

        params = this.sortObject(params);
        const signData = querystring.stringify(params);
        const hmac = crypto.createHmac("sha512", this.VNP_HASHSECRET);
        const signed = hmac.update(Buffer.from(signData, "utf-8")).digest("hex");
        params.vnp_SecureHash = signed;

        const paymentUrl = `${this.VNP_URL}?${querystring.stringify(params)}`;
        return paymentUrl;
    }
}

export default new VnPayService();