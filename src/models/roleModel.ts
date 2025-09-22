import mongoose, { Schema, model, InferSchemaType, Types } from 'mongoose';
import './permissionModel';
const roleSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
        },
        description: {
            type: String,
        },
        permissions: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Permission', // join qua permission.name
            },
        ],
    },
    { timestamps: true }
);

export type RoleType = InferSchemaType<typeof roleSchema> & { _id: Types.ObjectId };
export const Role = mongoose.models.Role || model<RoleType>('Role', roleSchema);
