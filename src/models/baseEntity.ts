import { Schema, InferSchemaType, Types } from 'mongoose';

const baseEntitySchema = new Schema(
    {
        createBy: {
            type: String,
        },
        updateBy: {
            type: String,
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
    },
    { _id: false, timestamps: false }
);

const baseEntityNoSoftDelSchema = new Schema(
    {
        createBy: {
            type: String,
        },
        updateBy: {
            type: String,
        },
    },
    { _id: false, timestamps: false }
);

export type BaseEntity = InferSchemaType<typeof baseEntitySchema>;
export type BaseEntityNoSoftDel = InferSchemaType<typeof baseEntityNoSoftDelSchema>;
export { baseEntitySchema, baseEntityNoSoftDelSchema };

export function applyBaseEntityMiddleware(schema: Schema) {
    schema.pre('save', function (next) {
        const userId = (this as any).UserId;
        if (this.isNew && userId) {
            this.set('createBy', userId);
        }
        this.set('updateBy', userId);
        next();
    });

    schema.pre(['updateOne', 'findOneAndUpdate'], function (next: any) {
        const userId = (this as any).getOptions().userId;
        if (userId) {
            this.set('updateBy', userId);
        }
        next();
    });
}
