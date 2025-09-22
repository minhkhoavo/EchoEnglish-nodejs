import { Schema, InferSchemaType } from 'mongoose';

const baseEntitySchema = new Schema(
    {
        isDeleted: {
            type: Boolean,
            default: false,
        },
    },
    { _id: false, timestamps: true }
);

export type BaseEntity = InferSchemaType<typeof baseEntitySchema>;
export { baseEntitySchema };
