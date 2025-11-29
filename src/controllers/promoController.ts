import { Request, Response, NextFunction } from 'express';
import PaymentService from '../services/payment/paymentService.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import PromoService from '~/services/payment/promoService.js';
class PromoController {
    public promoService = new PromoService();

    updatePromo = async (req: Request, res: Response) => {
        const {
            code,
            discount,
            expiration,
            usageLimit,
            active,
            maxUsesPerUser,
            minOrderValue,
            maxDiscountAmount,
        } = req.body;

        if (code != null && typeof code !== 'string') {
            throw new ApiError(ErrorMessage.INVALID_ID);
        }

        if (
            discount != null &&
            (typeof discount !== 'number' || discount < 0)
        ) {
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

        if (
            maxUsesPerUser != null &&
            (typeof maxUsesPerUser !== 'number' || maxUsesPerUser < 1)
        ) {
            throw new ApiError(ErrorMessage.INVALID_PROMO_DATA);
        }

        if (
            minOrderValue != null &&
            (typeof minOrderValue !== 'number' || minOrderValue < 0)
        ) {
            throw new ApiError(ErrorMessage.INVALID_PROMO_DATA);
        }

        if (
            maxDiscountAmount != null &&
            (typeof maxDiscountAmount !== 'number' || maxDiscountAmount < 0)
        ) {
            throw new ApiError(ErrorMessage.INVALID_PROMO_DATA);
        }

        const promo = await this.promoService.updatePromo(req.params.id, {
            code,
            discount,
            expiration,
            usageLimit,
            active,
            maxUsesPerUser,
            minOrderValue,
            maxDiscountAmount,
        });
        res.status(200).json(
            new ApiResponse(SuccessMessage.UPDATE_USER_SUCCESS, promo)
        );
    };

    deletePromo = async (req: Request, res: Response) => {
        await this.promoService.deletePromo(req.params.id);
        res.status(200).json(
            new ApiResponse(SuccessMessage.DELETE_PROMO_SUCCESS)
        );
    };

    getPromoById = async (req: Request, res: Response) => {
        const promo = await this.promoService.getPromoById(req.params.id);
        res.status(200).json(
            new ApiResponse(SuccessMessage.GET_SUCCESS, promo)
        );
    };

    getAllPromos = async (req: Request, res: Response) => {
        const {
            search,
            page = 1,
            limit = 10,
            active,
            minDiscount,
            maxDiscount,
            status,
            availability,
            sort,
        } = req.query;

        const pageNum = Number(page);
        const limitNum = Number(limit);

        if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
            throw new ApiError(ErrorMessage.INVALID_PROMO_DATA);
        }

        const result = await this.promoService.getAllPromos(
            search as string,
            pageNum,
            limitNum,
            {
                active: active as string,
                minDiscount: minDiscount as string,
                maxDiscount: maxDiscount as string,
                status: status as string,
                availability: availability as string,
                sort: sort as string,
            }
        );

        res.status(200).json(
            new ApiResponse(SuccessMessage.GET_SUCCESS, result)
        );
    };

    createPromoCode = async (req: Request, res: Response) => {
        const {
            code,
            discount,
            expiration,
            usageLimit,
            maxUsesPerUser,
            minOrderValue,
            maxDiscountAmount,
        } = req.body;

        const promo = await this.promoService.createPromoCode({
            code,
            discount,
            expiration,
            usageLimit,
            maxUsesPerUser,
            minOrderValue,
            maxDiscountAmount,
        });

        res.status(201).json(
            new ApiResponse(SuccessMessage.CREATE_SUCCESS, promo)
        );
    };

    validatePromoCode = async (req: Request, res: Response) => {
        const { code, credits } = req.body;
        const userId = req.user?.id as string;
        const orderValue = credits * 1000;
        const result = await this.promoService.validatePromoCode(
            code as string,
            userId,
            orderValue
        );
        res.status(200).json(new ApiResponse('SUCCESS', result));
    };
}

export default PromoController;
