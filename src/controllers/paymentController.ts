import {Request, Response, NextFunction} from 'express'
import PaymentService from '../services/payment/paymentService'
import ApiResponse from '~/dto/response/apiResponse';
import { SuccessMessage } from '~/enum/successMessage';
import { ErrorMessage } from '~/enum/errorMessage';
import { ApiError } from '~/middleware/apiError';
class PaymentController {
    public paymentService = new PaymentService();

    useToken = async (req: Request, res: Response) =>{
        const { tokens, description} = req.body;
        const result = await this.paymentService.useToken({
            userId: req.user?.id,
            tokens,
            description,
        })

        res.status(200).json(new ApiResponse(SuccessMessage.CREATE_USER_SUCCESS, result));
        
    }

    getTransactions = async (req: Request, res: Response) =>{
        const userId = req.user?.id;
        const {status, type, gateway, page, limit} = req.query;

        const result = await this.paymentService.getTransactions({
            userId: userId as string,
            status: status as string,
            type: type as string,
            gateway:gateway as string,
            page: page ? parseInt(page as string, 1) : 1,
            limit: limit ? parseInt(limit as string, 10) : 10,
        })

        res.status(200).json(new ApiResponse(SuccessMessage.CREATE_USER_SUCCESS, result));

    }
}

export default PaymentController;