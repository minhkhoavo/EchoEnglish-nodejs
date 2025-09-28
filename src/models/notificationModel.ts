import mongoose, { InferSchemaType, model, Schema, Types } from 'mongoose';
import { setBaseOptions } from './baseEntity.js';
import { NotificationType } from '~/enum/notificationType.js';

const notificationSchema = new Schema(
    {
        title: {
            type: String,
            required: [true, 'Tile is required'],
        },
        body: {
            type: String,
        },
        deepLink: {
            type: String,
        },
        type: {
            type: String,
            enum: Object.values(NotificationType),
            default: NotificationType.INFO,
            required: true,
        },
        userIds: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        readBy: [
            {
                userId: {
                    type: Schema.Types.ObjectId,
                    ref: 'User',
                    required: true,
                },
                readAt: {
                    type: Date,
                    default: Date.now,
                },
                isDeleted: {
                    type: Boolean,
                    default: false,
                },
            },
        ],
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    {
        collection: 'notifications',
    }
);

setBaseOptions(notificationSchema);

export type NotificationsType = InferSchemaType<typeof notificationSchema> & {
    _id: Types.ObjectId;
};

export const Notifications =
    mongoose.models.Notifications ||
    model<NotificationsType>('Notifications', notificationSchema);
