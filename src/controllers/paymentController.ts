import { Request, Response } from "express";
import ApiResponse from "~/dto/response/apiResponse";
import { ErrorMessage } from "~/enum/errorMessage";
import { SuccessMessage } from "~/enum/successMessage";
import { ApiError } from "~/middleware/apiError";
import paymentService from "~/services/payment/paymentService";
import vnpayService from "~/services/payment/vnpayService";
class PaymentController {
    public createPayment = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        console.log("UserID:", userId);
        const {token, paymentGateway, description} = req.body;
        console.log("Request Body:", req.body);
        let ipAddr = "127.0.0.1";

        const result = await paymentService.createPayment(userId!, ipAddr, {
            tokens: token,
            paymentGateway,
            description}
        );

        return res.status(201).json(new ApiResponse(SuccessMessage.CREATE_PAYMENT_SUCCESS, result));
    }

    public vnPayReturn = async (req: Request, res: Response) => {
        try {
            const params = req.query;
            const result = await vnpayService.handleVnPayReturn({...params});
            if (!result) throw new ApiError(ErrorMessage.PAYMENT_FAILED);
            console.log(result);
            if (!result.success) {
                throw new ApiError({ message: result.message.toString() });
            }
            return res.status(200).json(new ApiResponse(result.message.toString(), {
                paymentId: result.paymentId,
                status: result.status
            }));
        } catch (err: any) {
            return res.status(400).json(new ApiResponse(err.message || "Payment failed"));
        }
    }

    public vnPayIpn = async (req: Request, res: Response) => {
        try {
            const params = req.query;
            const result = await vnpayService.handleVnPayIpn({...params});
            return res.status(200).json(result);
        } catch (err) {
            return res.status(500).send("99");
        }
    }
}

export default new PaymentController();