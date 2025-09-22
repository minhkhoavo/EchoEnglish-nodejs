import mongoose, { Schema, model, InferSchemaType, Types } from 'mongoose';

const permissionSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
        },
        description: {
            type: String,
        },
    },
    {
        collection: 'permissions',
    }
);

export type PermissionType = InferSchemaType<typeof permissionSchema> & {
    _id: Types.ObjectId;
};
export const Permission =
    mongoose.models.Permission ||
    model<PermissionType>('Permission', permissionSchema);
