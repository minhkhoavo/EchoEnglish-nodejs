import {Request, Response, NextFunction} from 'express'
import PaymentService from '../services/payment/paymentService'
import ApiResponse from '~/dto/response/apiResponse';
import { SuccessMessage } from '~/enum/successMessage';
import { ErrorMessage } from '~/enum/errorMessage';
import { ApiError } from '~/middleware/apiError';
import PromoService from '~/services/payment/promoService';
class PromoController {
    public promoService = new PromoService();
    createPromoCode = async (req: Request, res: Response, next: NextFunction) => {
        const { code, discount, expiration, usageLimit } = req.body;

        const promo = await this.promoService.createPromoCode({
            code,
            discount,
            expiration,
            usageLimit,
        });

        res.status(201).json(new ApiResponse("SUCCESS", promo))
    };

    validatePromoCode = async (req: Request, res: Response) =>{
        const {code} = req.query;

        const result = await this.promoService.validatePromoCode(code as string);
        res.status(200).json(new ApiResponse("SUCCESS", result))
    }
}

export default PromoController;