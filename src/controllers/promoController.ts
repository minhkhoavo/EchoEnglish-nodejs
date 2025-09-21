import { Request, Response, NextFunction } from 'express';
import PaymentService from '../services/payment/paymentService';
import ApiResponse from '~/dto/response/apiResponse';
import { SuccessMessage } from '~/enum/successMessage';
import { ErrorMessage } from '~/enum/errorMessage';
import { ApiError } from '~/middleware/apiError';
import PromoService from '~/services/payment/promoService';
class PromoController {
  public promoService = new PromoService();

  updatePromo = async (req: Request, res: Response) => {
    const { code, discount, expiration, usageLimit, active } = req.body;

    if (code != null && typeof code !== 'string') {
      throw new ApiError(ErrorMessage.INVALID_ID);
    }

    if (discount != null && (typeof discount !== 'number' || discount < 0)) {
      throw new ApiError(ErrorMessage.INVALID_DISCOUNT);
    }

    if (
      usageLimit != null &&
      (typeof usageLimit !== 'number' || usageLimit < 1)
    ) {
      throw new ApiError(ErrorMessage.INVALID_USAGE_LIMIT);
    }

    if (active != null && typeof active !== 'boolean') {
      throw new ApiError(ErrorMessage.INVALID_ACTIVE);
    }

    const promo = await this.promoService.updatePromo(req.params.id, {
      code,
      discount,
      expiration,
      usageLimit,
      active,
    });
    res
      .status(200)
      .json(new ApiResponse(SuccessMessage.UPDATE_USER_SUCCESS, promo));
  };

  deletePromo = async (req: Request, res: Response) => {
    await this.promoService.deletePromo(req.params.id);
    res.status(200).json(new ApiResponse(SuccessMessage.DELETE_PROMO_SUCCESS));
  };

  getPromoById = async (req: Request, res: Response) => {
    const promo = await this.promoService.getPromoById(req.params.id);
    res.status(200).json(new ApiResponse(SuccessMessage.GET_SUCCESS, promo));
  };

  getAllPromos = async (req: Request, res: Response) => {
    const { search, page = 1, limit = 10 } = req.query;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
      throw new ApiError(ErrorMessage.INVALID_PROMO_DATA);
    }
    const result = await this.promoService.getAllPromos(
      search as string,
      pageNum,
      limitNum
    );
    res.status(200).json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
  };

  createPromoCode = async (req: Request, res: Response, next: NextFunction) => {
    const { code, discount, expiration, usageLimit } = req.body;

    const promo = await this.promoService.createPromoCode({
      code,
      discount,
      expiration,
      usageLimit,
    });

    res.status(201).json(new ApiResponse(SuccessMessage.CREATE_SUCCESS, promo));
  };

  validatePromoCode = async (req: Request, res: Response) => {
    const { code } = req.query;

    const result = await this.promoService.validatePromoCode(code as string);
    res.status(200).json(new ApiResponse('SUCCESS', result));
  };
}

export default PromoController;
