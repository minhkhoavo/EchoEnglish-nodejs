import { Request, Response } from 'express';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { RoleName } from '~/enum/role.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import notificationService from '~/services/notifications/notificationService.js';
class NotificationsController {
    // Hàm gửi thông báo
    public pushNotification = async (req: Request, res: Response) => {
        let userId;
        const scope = req.user?.scope as string;
        if (scope.includes(RoleName.ADMIN)) {
            userId = req.user?.id;
        }
        const result = await notificationService.pushNotification(
            userId as string,
            req.body
        );
        return res.status(200).json(new ApiResponse('Success', result));
    };

    // Hàm lấy thông báo user
    public getAllNotificationsForUser = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        const { page, limit } = req.query;

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);

        if (isNaN(pageNum) || isNaN(limitNum)) {
            throw new ApiError(ErrorMessage.INVALID_PAGE_LIMIT);
        }

        const result = await notificationService.getAllUserNotifications(
            userId as string,
            pageNum,
            limitNum
        );
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    };

    // Hàm lấy thông báo admin
    public getBroadcastNotification = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        const { page, limit } = req.query;

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);

        if (isNaN(pageNum) || isNaN(limitNum)) {
            throw new ApiError(ErrorMessage.INVALID_PAGE_LIMIT);
        }

        const result = await notificationService.getBroadcastNotfications(
            userId as string,
            pageNum,
            limitNum
        );
        return result.length === 0
            ? res
                  .status(404)
                  .json(new ApiResponse(SuccessMessage.NO_DATA_FOUND, result))
            : res
                  .status(200)
                  .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    };

    // Hàm đánh dấu thông báo đã đọc
    public markAsRead = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        const notificationId = req.params.id;
        const result = await notificationService.markAsRead(
            userId as string,
            notificationId
        );
        return res
            .status(200)
            .json(new ApiResponse('Mark as read successfully', result));
    };

    // Hàm đánh dấu tất cả thông báo đã đọc
    public markAllAsRead = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        const result = await notificationService.markAllAsRead(
            userId as string
        );
        return res
            .status(200)
            .json(new ApiResponse('Mark all as read successfully', result));
    };

    // Hàm đếm số thông báo chưa đọc
    public getUnreadCount = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        const result = await notificationService.getUnreadCount(
            userId as string
        );
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    };
}

export default new NotificationsController();
