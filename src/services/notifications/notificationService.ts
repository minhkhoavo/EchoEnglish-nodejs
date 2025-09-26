import {
    Notifications,
    NotificationsType,
} from '~/models/notificationModel.js';
import socketService from './socketService.js';
import { PaginationHelper } from '~/utils/pagination.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { Types } from 'mongoose';

class NotificationService {
    // Hàm gửi thông báo
    public pushNotification = async (
        id: string,
        payload: Partial<NotificationsType>
    ) => {
        const notification = await Notifications.create({
            title: payload.title,
            body: payload.body,
            deep_link: payload.deep_link,
            userIds: payload.userIds,
            creatBy: id,
            readBy: [],
        });

        const outPayload = {
            _id: notification._id.toString(),
            title: notification.title,
            body: notification.body,
            deep_link: notification.deep_link,
            createdAt: notification.createdAt,
            isRead: false,
        };

        if (!payload.userIds || payload.userIds.length === 0) {
            socketService.emitToAll('notifications', outPayload);
        } else {
            const userIds = payload.userIds.map((p: Types.ObjectId) =>
                p.toString()
            );
            socketService.emitToUsers(userIds, 'notifications', outPayload);
        }

        return notification;
    };

    // Hàm lấy tất cả thông báo của user
    public getAllUserNotifications = async (
        userId: string,
        page: number,
        limit: number
    ) => {
        console.log(userId);
        if (!userId) throw new ApiError(ErrorMessage.USER_NOT_FOUND);

        const notifications = await PaginationHelper.paginate(
            Notifications,
            { $or: [{ userIds: { $size: 0 } }, { userIds: userId }] },
            { page, limit }
        );

        return notifications.data.map((n) => ({
            _id: n._id,
            title: n.title,
            body: n.body,
            deep_link: n.deep_link,
            createdAt: n.createdAt,
            isRead: Array.isArray(n.readBy)
                ? n.readBy.some(
                      (r: { userId: string; readAt: Date }) =>
                          r.userId === userId
                  )
                : false,
        }));
    };

    // Hàm lấy thông báo admin
    public getBroadcastNotfications = async (
        adminId: string,
        page: number,
        limit: number
    ) => {
        const query = { userIds: { $size: 0 }, creatBy: adminId };

        const notifications = await PaginationHelper.paginate(
            Notifications,
            query,
            { page, limit }
        );

        return notifications.data.map((n) => ({
            _id: n._id,
            title: n.title,
            body: n.body,
            deep_link: n.deep_link,
            createdAt: n.createdAt,
            readBy: n.readBy,
        }));
    };

    // Hàm đánh dấu đã đọc
    public markAsRead = async (userId: string, notificationId: string) => {
        const alreadyRead = await Notifications.exists({
            _id: notificationId,
            'readBy.userId': userId,
        });

        if (alreadyRead)
            throw new ApiError(ErrorMessage.NOTIFICATION_ALREADY_MARK);

        const updated = await Notifications.findByIdAndUpdate(
            notificationId,
            { $addToSet: { readBy: { userId, readAt: new Date() } } },
            { new: true }
        ).lean();
        if (updated) {
            socketService.emitToUser(userId, 'notifications_read', {
                message: SuccessMessage.MARK_AS_READ_SUCCESS,
                notificationId,
            });
        }

        return updated;
    };

    // Hàm đánh dấu đã đọc tất cả
    public markAllAsRead = async (userId: string) => {
        const updateNotifications = await Notifications.updateMany(
            {
                $or: [{ userIds: { $size: 0 } }, { userIds: userId }],
                'readBy.userId': { $ne: userId },
            },
            { $push: { readBy: { userId: userId, readAt: new Date() } } }
        );

        if (updateNotifications.modifiedCount === 0)
            throw new ApiError(ErrorMessage.NOTIFICATION_ALREADY_MARK_ALL);
        else {
            socketService.emitToUser(userId, 'notifications_read_all', {
                message: SuccessMessage.MARK_AS_READ_SUCCESS,
                timestamp: new Date(),
            });
            return updateNotifications.modifiedCount > 0;
        }
    };

    // Hàm đếm số thông báo chưa đọc
    public getUnreadCount = async (userId: string) => {
        const count = await Notifications.countDocuments({
            $or: [{ userIds: { $size: 0 } }, { userIds: userId }],
            'readBy.userId': { $ne: userId },
        });
        return count;
    };
}

export default new NotificationService();
