import { TransactionType } from '~/enum/transactionType.js';
import { PaymentStatus } from '~/enum/paymentStatus.js';
import { Payment } from '~/models/payment.js';
import { PaymentGateway } from '~/enum/paymentGateway.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import { PromoCode, PromoCodeType } from '../../models/promoCode.js';

interface PromoInput {
  code: string;
  discount: number;
  expiration?: Date;
  usageLimit?: number;
}

class PromoService {
  public async deletePromo(id: string) {
    const promo = await PromoCode.findByIdAndDelete(id);
    if (!promo) {
      throw new ApiError(ErrorMessage.PROMOTION_NOT_FOUND);
    }
    return promo;
  }

  public async updatePromo(id: string, data: Partial<PromoCodeType>) {
    return await PromoCode.findByIdAndUpdate(id, data, { new: true });
  }

  public async getPromoById(id: string) {
    const promo = await PromoCode.findById(id);
    if (!promo) {
      throw new ApiError(ErrorMessage.PROMOTION_NOT_FOUND);
    }
    return promo;
  }

  /* Search promos */
  public async getAllPromos(
    search: string = '',
    page: number = 1,
    limit: number = 10
  ) {
    const query: Record<string, unknown> = {};
    if (search) {
      query.code = { $regex: search, $options: 'i' };
    }

    const total = await PromoCode.countDocuments(query);
    const promos = await PromoCode.find(query)
      .sort({ creatAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      data: promos,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  createPromoCode = async ({
    code,
    discount,
    expiration,
    usageLimit,
  }: PromoInput) => {
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

    const promo = await PromoCode.findOne({
      code: code.toUpperCase(),
      active: true,
    });
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
