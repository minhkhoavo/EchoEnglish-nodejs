import { Request, Response } from "express";
import ApiResponse from "~/dto/response/apiResponse";
import { ErrorMessage } from "~/enum/errorMessage";
import { SuccessMessage } from "~/enum/successMessage";
import { ApiError } from "~/middleware/apiError";
import paymentService from "~/services/payment/paymentService";
import vnpayService from "~/services/payment/vnpayService";
class PaymentController {
    public getTransactionById = async (req: Request, res: Response) => {
        const payment = await paymentService.getTransactionById(req.params.id);
        res.status(200).json(new ApiResponse(SuccessMessage.GET_PAYMENT_SUCCESS, payment));
    };
    
    public getTransactions = async (req: Request, res: Response) =>{
        const userId = req.user?.id;
        const {status, type, gateway, page, limit} = req.query;

        const result = await paymentService.getTransactions({
            userId: userId as string,
            status: status as string,
            type: type as string,
            gateway:gateway as string,
            page: page ? parseInt(page as string, 1) : 1,
            limit: limit ? parseInt(limit as string, 10) : 10,
        })
        res.status(200).json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    }

    public useToken = async (req: Request, res: Response) =>{
        const { tokens, description} = req.body;
        const result = await paymentService.useToken({
            userId: req.user?.id,
            tokens,
            description,
        })

        res.status(200).json(new ApiResponse(SuccessMessage.USE_TOKEN_SUCCESS, result));
        
    }

    public createPayment = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if(!userId) 
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);

        const {token, paymentGateway, description} = req.body;

        if (token === undefined || token === null) 
            throw new ApiError(ErrorMessage.TOKENS_REQUIRED);
        if (!paymentGateway) 
            throw new ApiError(ErrorMessage.PAYMENT_GATEWAY_NOT_FOUND);

        let ipAddr = "127.0.0.1";

        const result = await paymentService.createPayment(userId!, ipAddr, {
            tokens: token,
            paymentGateway,
            description}
        );

        return res.status(201).json(new ApiResponse(SuccessMessage.CREATE_PAYMENT_SUCCESS, result));
    }

    public vnPayReturn = async (req: Request, res: Response) => {
        const params = req.query as Record<string, any>;
        const result = await vnpayService.handleVnPayReturn({...params});
        if (!result) 
            throw new ApiError(ErrorMessage.PAYMENT_FAILED);
        
        if (!result.success) {
            throw new ApiError({ message: result.message.toString() });
        }
        return res.status(200).json(new ApiResponse(result.message.toString(), {
            paymentId: result.paymentId,
            status: result.status
        }));
    }

    public vnPayIpn = async (req: Request, res: Response) => {
        const params = req.query;
        const result = await vnpayService.handleVnPayIpn({...params});
        return res.status(200).json(result);
    }
}

export default new PaymentController();