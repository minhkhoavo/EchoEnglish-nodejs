import mongoose, { Schema, model, InferSchemaType, Types } from 'mongoose';
import { setBaseOptions } from './baseEntity.js';

const promoCodeSchema = new Schema(
    {
        code: {
            type: String,
            required: [true, 'CODE_REQUIRED'],
            unique: true,
            uppercase: true,
            trim: true,
        },
        discount: {
            type: Number,
            required: [true, 'DISCOUNT_REQUIRED'],
            min: 0,
        },
        expiration: {
            type: Date,
        },
        usageLimit: {
            type: Number,
            default: 1,
        },
        usedCount: {
            type: Number,
            default: 0,
        },
        active: {
            type: Boolean,
            default: true,
        },
        maxUsesPerUser: {
            type: Number,
            default: null,
        },
        minOrderValue: {
            type: Number,
            default: 0,
        },
        maxDiscountAmount: {
            type: Number,
            default: null,
        },
        userUsages: {
            type: Map,
            of: Number,
            default: new Map(),
        },
    },
    {
        collection: 'promo_codes',
    }
);

setBaseOptions(promoCodeSchema);

export type PromoCodeType = InferSchemaType<typeof promoCodeSchema> & {
    _id: Types.ObjectId;
};
export const PromoCode =
    mongoose.models.PromoCode ||
    model<PromoCodeType>('PromoCode', promoCodeSchema);
