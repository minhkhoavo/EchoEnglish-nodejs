import { Schema, model, InferSchemaType, Types, models } from "mongoose";

const promoCodeSchema = new Schema({
  code: {
    type: String,
    required: [true, "CODE_REQUIRED"],
    unique: true,
    uppercase: true,
    trim: true,
  },
  discount_vnd: {
    type: Number,
    required: [true, "DISCOUNT_REQUIRED"],
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
}, { timestamps: true });

export type PromoCodeType = InferSchemaType<typeof promoCodeSchema> & { _id: Types.ObjectId };
export const PromoCode = models.PromoCode || model<PromoCodeType>("PromoCode", promoCodeSchema);