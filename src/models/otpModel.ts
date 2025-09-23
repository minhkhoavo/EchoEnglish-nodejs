import { Schema, model, InferSchemaType } from 'mongoose';
import { OtpPurpose } from '~/enum/otpPurpose.js';
import { setBaseOptions } from './baseEntity.js';

const otpSchema = new Schema(
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
    {
        collection: 'otps',
    }
);

setBaseOptions(otpSchema);

export type OtpType = InferSchemaType<typeof otpSchema>;
export const Otp = model('Otp', otpSchema);
