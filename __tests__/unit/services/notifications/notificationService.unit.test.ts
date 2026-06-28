/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import notificationService from '~/services/notifications/notificationService.js';
import { Notifications } from '~/models/notificationModel.js';
import socketService from '~/services/notifications/socketService.js';
import { PaginationHelper } from '~/utils/pagination.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { Types } from 'mongoose';

jest.mock('~/models/notificationModel.js');
jest.mock('~/services/notifications/socketService.js');
jest.mock('~/utils/pagination.js');

const mockedNotifications = Notifications as jest.Mocked<typeof Notifications>;
const mockedSocketService = socketService as jest.Mocked<typeof socketService>;
const mockedPaginationHelper = PaginationHelper as jest.Mocked<
    typeof PaginationHelper
>;

function buildMockNotification(overrides: Record<string, any> = {}) {
    return {
        _id: new Types.ObjectId(),
        title: 'Title',
        body: 'Body',
        deepLink: 'link',
        type: 'type',
        userIds: [],
        createdBy: 'admin',
        readBy: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        toObject: function () {
            return this;
        },
        ...overrides,
    };
}

describe('NotificationService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('pushNotification', () => {
        it('should emit to all if userIds is empty', async () => {
            const mockNotif = buildMockNotification();
            (mockedNotifications.create as any) = jest
                .fn()
                .mockResolvedValue(mockNotif);

            await notificationService.pushNotification('admin-id', {
                title: 'T',
                body: 'B',
            });

            expect(mockedSocketService.emitToAll).toHaveBeenCalledWith(
                'notifications',
                expect.any(Object)
            );
            expect(mockedSocketService.emitToUsers).not.toHaveBeenCalled();
        });

        it('should emit to specific users if userIds provided', async () => {
            const uid1 = new Types.ObjectId();
            const mockNotif = buildMockNotification({ userIds: [uid1] });
            (mockedNotifications.create as any) = jest
                .fn()
                .mockResolvedValue(mockNotif);

            await notificationService.pushNotification('admin-id', {
                title: 'T',
                body: 'B',
                userIds: [uid1] as any,
            });

            expect(mockedSocketService.emitToUsers).toHaveBeenCalledWith(
                [uid1.toString()],
                'notifications',
                expect.any(Object)
            );
            expect(mockedSocketService.emitToAll).not.toHaveBeenCalled();
        });
    });

    describe('getAllUserNotifications', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(
                notificationService.getAllUserNotifications('', 1, 10)
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                notificationService.getAllUserNotifications('', 1, 10)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        it('should return mapped notifications and pagination', async () => {
            const uid = new Types.ObjectId().toString();
            const mockNotif1 = buildMockNotification({
                readBy: [
                    { userId: new Types.ObjectId(uid), readAt: new Date() },
                ],
            });
            const mockNotif2 = buildMockNotification({
                readBy: [],
            });
            const mockNotif3 = buildMockNotification({
                readBy: { find: () => null } as any, // test when readBy is not an array or find returns null
            });

            (mockedPaginationHelper.paginate as any) = jest
                .fn()
                .mockResolvedValue({
                    data: [mockNotif1, mockNotif2, mockNotif3],
                    pagination: { total: 3 },
                });

            const result = await notificationService.getAllUserNotifications(
                uid,
                1,
                10
            );
            expect(result.pagination).toEqual({ total: 3 });
            expect(result.notifications).toHaveLength(3);
            expect(result.notifications[0].isRead).toBe(true);
            expect(result.notifications[1].isRead).toBe(false);
            expect(result.notifications[2].isRead).toBe(false);
        });
    });

    describe('softDeleteNotification', () => {
        it('should throw error if userId or notificationId is missing', async () => {
            await expect(
                notificationService.softDeleteNotification('', 'nid')
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                notificationService.softDeleteNotification('uid', '')
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw error if notification not found', async () => {
            (mockedNotifications.findById as any) = jest
                .fn()
                .mockResolvedValue(null);
            await expect(
                notificationService.softDeleteNotification('uid', 'nid')
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw error if already soft deleted', async () => {
            const uid = new Types.ObjectId();
            const mockNotif = buildMockNotification({
                readBy: [{ userId: uid, readAt: new Date(), isDeleted: true }],
            });
            (mockedNotifications.findById as any) = jest
                .fn()
                .mockResolvedValue(mockNotif);

            await expect(
                notificationService.softDeleteNotification(
                    uid.toString(),
                    'nid'
                )
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                notificationService.softDeleteNotification(
                    uid.toString(),
                    'nid'
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.NOTIFICATION_NOT_FOUND.status,
            });
        });

        it('should update to isDeleted true if entry exists but not deleted', async () => {
            const uid = new Types.ObjectId();
            const mockNotif = buildMockNotification({
                readBy: [{ userId: uid, readAt: new Date() }],
            });
            (mockedNotifications.findById as any) = jest
                .fn()
                .mockResolvedValue(mockNotif);
            (mockedNotifications.findOneAndUpdate as any) = jest
                .fn()
                .mockResolvedValue({});

            await notificationService.softDeleteNotification(
                uid.toString(),
                'nid'
            );

            expect(mockedNotifications.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: 'nid', 'readBy.userId': uid.toString() },
                { $set: { 'readBy.$.isDeleted': true } }
            );
            expect(mockedSocketService.emitToUser).toHaveBeenCalledWith(
                uid.toString(),
                'notification_deleted',
                expect.any(Object)
            );
        });

        it('should add new entry with isDeleted true if no entry exists', async () => {
            const uid = new Types.ObjectId();
            const mockNotif = buildMockNotification({ readBy: [] });
            (mockedNotifications.findById as any) = jest
                .fn()
                .mockResolvedValue(mockNotif);
            (mockedNotifications.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue({});

            await notificationService.softDeleteNotification(
                uid.toString(),
                'nid'
            );

            expect(mockedNotifications.findByIdAndUpdate).toHaveBeenCalledWith(
                'nid',
                {
                    $addToSet: {
                        readBy: {
                            userId: uid.toString(),
                            readAt: expect.any(Date),
                            isDeleted: true,
                        },
                    },
                }
            );
            expect(mockedSocketService.emitToUser).toHaveBeenCalledWith(
                uid.toString(),
                'notification_deleted',
                expect.any(Object)
            );
        });
    });

    describe('markAsRead', () => {
        it('should throw error if notification not found', async () => {
            (mockedNotifications.findById as any) = jest
                .fn()
                .mockResolvedValue(null);
            await expect(
                notificationService.markAsRead('uid', 'nid')
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw error if already deleted', async () => {
            const uid = new Types.ObjectId();
            const mockNotif = buildMockNotification({
                readBy: [{ userId: uid, readAt: new Date(), isDeleted: true }],
            });
            (mockedNotifications.findById as any) = jest
                .fn()
                .mockResolvedValue(mockNotif);

            await expect(
                notificationService.markAsRead(uid.toString(), 'nid')
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                notificationService.markAsRead(uid.toString(), 'nid')
            ).rejects.toMatchObject({
                status: ErrorMessage.NOTIFICATION_NOT_FOUND.status,
            });
        });

        it('should throw error if already marked as read', async () => {
            const uid = new Types.ObjectId();
            const mockNotif = buildMockNotification({
                readBy: [{ userId: uid, readAt: new Date() }],
            });
            (mockedNotifications.findById as any) = jest
                .fn()
                .mockResolvedValue(mockNotif);

            await expect(
                notificationService.markAsRead(uid.toString(), 'nid')
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                notificationService.markAsRead(uid.toString(), 'nid')
            ).rejects.toMatchObject({
                status: ErrorMessage.NOTIFICATION_ALREADY_MARK.status,
            });
        });

        it('should add new entry and emit if updated successfully', async () => {
            const uid = new Types.ObjectId();
            const mockNotif = buildMockNotification({ readBy: [] });
            (mockedNotifications.findById as any) = jest
                .fn()
                .mockResolvedValue(mockNotif);
            (mockedNotifications.findByIdAndUpdate as any) = jest
                .fn()
                .mockReturnValue({
                    lean: jest.fn().mockResolvedValue(true),
                });

            await notificationService.markAsRead(uid.toString(), 'nid');

            expect(mockedNotifications.findByIdAndUpdate).toHaveBeenCalledWith(
                'nid',
                {
                    $addToSet: {
                        readBy: {
                            userId: uid.toString(),
                            readAt: expect.any(Date),
                        },
                    },
                },
                { new: true }
            );
            expect(mockedSocketService.emitToUser).toHaveBeenCalledWith(
                uid.toString(),
                'notifications_read',
                expect.any(Object)
            );
        });

        it('should not emit if updated returns falsy', async () => {
            const uid = new Types.ObjectId();
            const mockNotif = buildMockNotification({ readBy: [] });
            (mockedNotifications.findById as any) = jest
                .fn()
                .mockResolvedValue(mockNotif);
            (mockedNotifications.findByIdAndUpdate as any) = jest
                .fn()
                .mockReturnValue({
                    lean: jest.fn().mockResolvedValue(null),
                });

            await notificationService.markAsRead(uid.toString(), 'nid');
            expect(mockedSocketService.emitToUser).not.toHaveBeenCalled();
        });
    });

    describe('markAllAsRead', () => {
        it('should throw error if no notification modified', async () => {
            (mockedNotifications.updateMany as any) = jest
                .fn()
                .mockResolvedValue({ modifiedCount: 0 });
            await expect(
                notificationService.markAllAsRead('uid')
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                notificationService.markAllAsRead('uid')
            ).rejects.toMatchObject({
                status: ErrorMessage.NOTIFICATION_ALREADY_MARK_ALL.status,
            });
        });

        it('should emit to user if notifications modified', async () => {
            (mockedNotifications.updateMany as any) = jest
                .fn()
                .mockResolvedValue({ modifiedCount: 1 });
            await notificationService.markAllAsRead('uid');
            expect(mockedSocketService.emitToUser).toHaveBeenCalledWith(
                'uid',
                'notifications_read_all',
                expect.any(Object)
            );
        });
    });

    describe('getUnreadCount', () => {
        it('should return unread count', async () => {
            (mockedNotifications.countDocuments as any) = jest
                .fn()
                .mockResolvedValue(5);
            const result = await notificationService.getUnreadCount('uid');
            expect(result).toBe(5);
            expect(mockedNotifications.countDocuments).toHaveBeenCalledWith(
                expect.any(Object)
            );
        });
    });
});
