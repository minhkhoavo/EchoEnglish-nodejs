import { OtpPurpose } from '~/enum/otpPurpose.js';
import crypto from 'crypto';
import { Otp, OtpType } from '~/models/otpModel.js';
import { mailTransporter } from '~/config/configEmail.js';
import { User } from '~/models/userModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

const OTP_EXPIRY_MINUTES = 10;

export class OtpEmailService {
    private senderEmail: string;

    constructor() {
        this.senderEmail = process.env.SMTP_USER || '';
    }

    public sendOtp = async (
        email: string,
        purpose: OtpPurpose
    ): Promise<string> => {
        const normalizedEmail = email.trim().toLowerCase();
        const otpCode = this.generateOtp();
        const expiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

        await Otp.create({
            email: normalizedEmail,
            otp: otpCode,
            purpose,
            expiryTime: expiry,
        } as Partial<OtpType>);

        await this.sendOtpEmail(normalizedEmail, otpCode, purpose);

        return otpCode;
    };

    private generateOtp(): string {
        const n = crypto.randomInt(100_000, 1_000_000); // 6 chữ số
        return String(n);
    }

    private sendOtpEmail = async (
        recipientEmail: string,
        otpCode: string,
        purpose: OtpPurpose
    ): Promise<void> => {
        const subject =
            purpose === OtpPurpose.REGISTER
                ? 'Confirm Your Registration'
                : 'OTP for Password Reset';

        await mailTransporter.sendMail({
            from: this.senderEmail,
            to: recipientEmail,
            subject,
            html: this.generateHtmlContent(otpCode, purpose),
        });
    };

    private generateHtmlContent(otpCode: string, purpose: OtpPurpose): string {
        const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; padding:20px; border:1px solid #eee; border-radius:8px;">
        <h2 style="color:#00466a; text-align:center;">Echo English</h2>
        <p>Hi,</p>
        <p>Use the following OTP to ${purpose === OtpPurpose.REGISTER ? 'complete your registration' : 'reset your password'}. OTP is valid for ${OTP_EXPIRY_MINUTES} minutes.</p>
        <div style="text-align:center; margin:20px 0;">
          <span style="font-size:32px; font-weight:bold; color:#fff; background-color:#00466a; padding:10px 20px; border-radius:6px;">
            ${otpCode}
          </span>
        </div>
        <p>Regards,<br/>Echo English Team</p>
        <hr style="border:none; border-top:1px solid #eee; margin-top:20px;"/>
        <p style="font-size:12px; color:#aaa; text-align:center;">Echo Inc, 1600 Amphitheatre Parkway, California</p>
      </div>
    `;
        return htmlContent;
    }

    public verifyOtp = async (
        email: string,
        otpCode: string,
        purpose: OtpPurpose
    ): Promise<void> => {
        const normalizedEmail = email.toLowerCase();

        const otpDoc = await Otp.findOne({
            email: normalizedEmail,
            otp: otpCode,
            purpose,
        }).exec();
        if (!otpDoc) throw new ApiError(ErrorMessage.OTP_INVALID);

        if (otpDoc.expiryTime < new Date()) {
            await Otp.deleteOne({ _id: otpDoc._id }).exec();
            throw new ApiError(ErrorMessage.OTP_EXPIRED);
        }

        await Otp.deleteMany({ email: normalizedEmail, purpose }).exec();
        if (purpose === OtpPurpose.REGISTER) {
            const user = await User.findOne({
                email: normalizedEmail,
            }).exec();
            if (!user) throw new ApiError(ErrorMessage.USER_NOT_FOUND);
            user.isDeleted = false;
            await user.save();
        }
    };
}
