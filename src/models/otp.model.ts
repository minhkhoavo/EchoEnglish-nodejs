import { Schema, model, Document } from "mongoose";

export enum OtpPurpose {
  REGISTER = "REGISTER",
  FORGOT_PASSWORD = "FORGOT_PASSWORD",
  LOGIN = "LOGIN",
}

export interface IOtp extends Document {
  email: string;
  otp: string;
  purpose: OtpPurpose;
  expiryTime: Date;
}

const otpSchema = new Schema<IOtp>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
    },
    otp: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: Object.values(OtpPurpose),
      required: true,
    },
    expiryTime: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

export const Otp = model<IOtp>("Otp", otpSchema);
