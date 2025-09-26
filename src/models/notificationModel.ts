import mongoose, { InferSchemaType, model, Schema, Types } from 'mongoose';
import { setBaseOptions } from './baseEntity.js';

const notificationSchema = new Schema(
    {
        title: {
            type: String,
            required: [true, 'Tile is required'],
        },
        body: {
            type: String,
        },
        deep_link: {
            type: String,
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
            },
        ],
        createBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    {
        collection: 'notifications',
        timestamps: true,
    }
);

setBaseOptions(notificationSchema);

export type NotificationsType = InferSchemaType<typeof notificationSchema> & {
    _id: Types.ObjectId;
};

export const Notifications =
    mongoose.models.Notifications ||
    model<NotificationsType>('Notifications', notificationSchema);
