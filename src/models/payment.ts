import { Schema, model, InferSchemaType, Types, models } from "mongoose";
import { PaymentStatus } from "~/enum/paymentStatus";
import { TransactionType } from "~/enum/transactionType";
import { baseEntitySchema, applyBaseEntityMiddleware, BaseEntity } from "./baseEntity";
import { PaymentGateway } from "~/enum/paymentGateway";

const paymentSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: [true, "USER_REQUIRED"],
  },
  type: {
    type: String,
    enum: Object.values(TransactionType),
    required: [true, "TYPE_REQUIRED"],
  },
  tokens: {
    type: Number,
    required: [true, "TOKENS_REQUIRED"],
  },
  description: {
    type: String,
  },
  amount: {
    type: Number,
  },
  discount: {
    type: Number,
    default: 0,
  },
  promoCode: {
    type: String,
  },
  status: {
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.INITIATED,
  },
  paymentGateway: {
    type: String,
    enum: Object.values(PaymentGateway),
    default: PaymentGateway.STRIPE,
  },
  transactionRef: {
    type: String,
  },
  payUrl: {
    type: String,
  },
  expiredAt: {
    type: Date,
  },
}, { timestamps: true });

paymentSchema.add(baseEntitySchema.obj);

applyBaseEntityMiddleware(paymentSchema);

export type PaymentType = InferSchemaType<typeof paymentSchema> & BaseEntity & { _id: Types.ObjectId };
export const Payment = models.Payment || model<PaymentType>("Payment", paymentSchema);