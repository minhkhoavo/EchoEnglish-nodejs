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
import omit from 'lodash/omit.js';

class NotificationService {
    // Hàm gửi thông báo
    public pushNotification = async (
        id: string,
        payload: Partial<NotificationsType>
    ) => {
        const notification = await Notifications.create({
            title: payload.title,
            body: payload.body,
            deepLink: payload.deepLink,
            type: payload.type,
            userIds: payload.userIds,
            createdBy: id,
            readBy: [],
        });

        const outPayload = {
            _id: notification._id.toString(),
            title: notification.title,
            body: notification.body,
            deepLink: notification.deepLink,
            type: notification.type,
            createdAt: notification.createdAt,
            createdBy: notification.createdBy,
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

        return omit(notification.toObject(), ['__v', 'readBy']);
    };

    // Hàm lấy tất cả thông báo của user
    public getAllUserNotifications = async (
        userId: string,
        page: number,
        limit: number
    ) => {
        if (!userId) throw new ApiError(ErrorMessage.USER_NOT_FOUND);

        const notifications = await PaginationHelper.paginate(
            Notifications,
            { $or: [{ userIds: { $size: 0 } }, { userIds: userId }] },
            { page, limit },
            undefined,
            '-__v',
            { createdAt: -1 }
        );

        return {
            notifications: notifications.data
                .map((n) => {
                    const readByEntry = Array.isArray(n.readBy)
                        ? n.readBy.find(
                              (r: {
                                  userId: string;
                                  readAt: Date;
                                  isDeleted?: boolean;
                              }) => r.userId.toString() === userId
                          )
                        : null;

                    // Skip deleted notifications for this user
                    if (readByEntry?.isDeleted) {
                        return null;
                    }

                    return {
                        _id: n._id,
                        title: n.title,
                        body: n.body,
                        deepLink: n.deepLink,
                        type: n.type,
                        createdAt: n.createdAt,
                        updatedAt: n.updatedAt,
                        isRead: !!readByEntry,
                    };
                })
                .filter(Boolean), // Remove null entries
            pagination: notifications.pagination,
        };
    };

    // Hàm xóa mềm thông báo cho user
    public softDeleteNotification = async (
        userId: string,
        notificationId: string
    ) => {
        if (!userId || !notificationId) {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }
        const notification = await Notifications.findById(notificationId);
        if (!notification) {
            throw new ApiError(ErrorMessage.NOTIFICATION_NOT_FOUND);
        }
        const existingEntry = notification.readBy.find(
            (r: {
                userId: Types.ObjectId;
                readAt: Date;
                isDeleted?: boolean;
            }) => r.userId.toString() === userId
        );
        if (existingEntry) {
            if (existingEntry.isDeleted) {
                // Nếu đã xóa rồi thì báo lỗi
                throw new ApiError(ErrorMessage.NOTIFICATION_NOT_FOUND);
            } else {
                // Nếu chưa xóa thì update thành true
                await Notifications.findOneAndUpdate(
                    { _id: notificationId, 'readBy.userId': userId },
                    { $set: { 'readBy.$.isDeleted': true } }
                );
            }
        } else {
            // Nếu chưa có entry thì thêm mới
            await Notifications.findByIdAndUpdate(notificationId, {
                $addToSet: {
                    readBy: {
                        userId,
                        readAt: new Date(),
                        isDeleted: true,
                    },
                },
            });
        }
        socketService.emitToUser(userId, 'notification_deleted', {
            message: 'Notification deleted successfully',
            notificationId,
        });
    };

    // Hàm đánh dấu đã đọc
    public markAsRead = async (userId: string, notificationId: string) => {
        // Lấy notification để kiểm tra trạng thái
        const notification = await Notifications.findById(notificationId);
        if (!notification)
            throw new ApiError(ErrorMessage.NOTIFICATION_NOT_FOUND);

        const readByEntry = notification.readBy.find(
            (r: {
                userId: Types.ObjectId;
                readAt: Date;
                isDeleted?: boolean;
            }) => r.userId.toString() === userId
        );

        if (readByEntry) {
            if (readByEntry.isDeleted) {
                throw new ApiError(ErrorMessage.NOTIFICATION_NOT_FOUND);
            }
            throw new ApiError(ErrorMessage.NOTIFICATION_ALREADY_MARK);
        }

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
    };

    // Hàm đánh dấu đã đọc tất cả
    public markAllAsRead = async (userId: string) => {
        const updateNotifications = await Notifications.updateMany(
            {
                $or: [{ userIds: { $size: 0 } }, { userIds: userId }],
                readBy: { $not: { $elemMatch: { userId: userId } } },
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
        }
    };

    // Hàm đếm số thông báo chưa đọc
    public getUnreadCount = async (userId: string) => {
        const count = await Notifications.countDocuments({
            $or: [{ userIds: { $size: 0 } }, { userIds: userId }],
            readBy: { $not: { $elemMatch: { userId: userId } } },
        });
        return count;
    };
}

export default new NotificationService();
