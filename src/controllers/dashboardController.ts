import { Request, Response } from 'express';
import ApiResponse from '~/dto/response/apiResponse.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import dashboardService from '~/services/dashboardService.js';
class DashboardController {
    public getUserStats = async (req: Request, res: Response) => {
        const { from, to, by } = req.query;
        const data = await dashboardService.getUserStats(
            from as string,
            to as string,
            (by as string) || 'month'
        );
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, data));
    };

    public getTestStats = async (req: Request, res: Response) => {
        const { from, to, by } = req.query;
        const data = await dashboardService.getTestStats(
            from as string,
            to as string,
            (by as string) || 'month'
        );
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, data));
    };

    public getPaymentStats = async (req: Request, res: Response) => {
        const { from, to, by } = req.query;
        const data = await dashboardService.getPaymentStats(
            from as string,
            to as string,
            (by as string) || 'month'
        );
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, data));
    };

    public getResourceStats = async (req: Request, res: Response) => {
        const data = await dashboardService.getResourceStats();
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, data));
    };
}

export default new DashboardController();
