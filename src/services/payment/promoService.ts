import { TransactionType } from "./../../enum/transactionType";
import { PaymentStatus } from "~/enum/paymentStatus";
import { Payment } from "../../models/payment";
import { PaymentGateway } from "~/enum/paymentGateway";
import { ErrorMessage } from "~/enum/errorMessage";
import { ApiError } from "~/middleware/apiError";
import { PromoCode, PromoCodeType } from "../../models/PromoCode";
import { token } from "morgan";

interface PromoInput {
  code: string;
  discount: number;
  expiration?: Date;
  usageLimit?: number;
}

class PromoService {
    createPromoCode = async ({ code, discount, expiration, usageLimit }: PromoInput) => {
        if (!code || !discount) {
            throw new ApiError(ErrorMessage.INVALID_PROMO_DATA);
        }

        const existing = await PromoCode.findOne({ code: code.toUpperCase() });
        if (existing) {
            throw new ApiError(ErrorMessage.PROMO_ALREADY_EXISTS);
        }

        const promo = await PromoCode.create({
            code: code.toUpperCase(),
            discount,
            expiration,
            usageLimit,
        });

        return promo;
    };
    
    validatePromoCode = async (code: string) => {
        if (!code) {
            throw new ApiError(ErrorMessage.PROMO_CODE_REQUIRED);
        }

        const promo = await PromoCode.findOne({ code: code.toUpperCase(), active: true });
        if (!promo) {
            throw new ApiError(ErrorMessage.PROMO_NOT_FOUND);
        }

        if (promo.expiration && promo.expiration < new Date()) {
            throw new ApiError(ErrorMessage.PROMO_EXPIRED);
        }

        if (promo.usedCount >= promo.usageLimit) {
            throw new ApiError(ErrorMessage.PROMO_USAGE_LIMIT_REACHED);
        }

        return {
            code: promo.code,
            discount: promo.discount,
            expiration: promo.expiration,
            remaining: promo.usageLimit - promo.usedCount,
            active: promo.active,
        };
    };
}

export default PromoService;