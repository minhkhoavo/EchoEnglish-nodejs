import { Request, Response } from 'express';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import notificationService from '~/services/notifications/notificationService.js';
class NotificationsController {
    // Hàm gửi thông báo
    public pushNotification = async (req: Request, res: Response) => {
        const userId = req.user?.id;

        const result = await notificationService.pushNotification(
            userId as string,
            req.body
        );

        return req.body.userIds.length === 0
            ? res
                  .status(200)
                  .json(
                      new ApiResponse(
                          SuccessMessage.BROADCAST_NOTIFICATION_SUCCESS,
                          result
                      )
                  )
            : res
                  .status(200)
                  .json(
                      new ApiResponse(
                          SuccessMessage.PUSH_NOTIFICATION_SUCCESS,
                          result
                      )
                  );
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
        const { page, limit } = req.query;

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);

        if (isNaN(pageNum) || isNaN(limitNum)) {
            throw new ApiError(ErrorMessage.INVALID_PAGE_LIMIT);
        }

        const result = await notificationService.getBroadcastNotfications(
            pageNum,
            limitNum
        );
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    };

    // Hàm đánh dấu thông báo đã đọc
    public markAsRead = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        const notificationId = req.params.id;
        await notificationService.markAsRead(userId as string, notificationId);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.MARK_AS_READ_SUCCESS));
    };

    // Hàm đánh dấu tất cả thông báo đã đọc
    public markAllAsRead = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        await notificationService.markAllAsRead(userId as string);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.MARK_ALL_AS_READ_SUCCESS));
    };
}

export default new NotificationsController();
