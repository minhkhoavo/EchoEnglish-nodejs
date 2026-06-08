import { OtpPurpose } from '~/enum/otpPurpose.js';
import crypto from 'crypto';
import { Otp, OtpType } from '~/models/otpModel.js';
import { mailTransporter } from '~/config/configEmail.js';
import { User } from '~/models/userModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { emailQueue } from './emailQueue.js';

const OTP_EXPIRY_MINUTES = 10;

export class OtpEmailService {
    private senderEmail: string;

    constructor() {
        this.senderEmail = process.env.SMTP_USER || '';
        // Register this service as email sender for the queue
        emailQueue.setEmailSender(this);
        // this = object có method sendOtpEmail → khớp interface EmailSender
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

        // Add to queue instead of sending immediately
        emailQueue.addJob(normalizedEmail, otpCode, purpose);

        return otpCode;
    };

    private generateOtp(): string {
        const n = crypto.randomInt(100_000, 1_000_000); // 6 chữ số
        return String(n);
    }

    // Public method for queue to call
    public sendOtpEmail = async (
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
            html: this.generateHtmlContent(otpCode, purpose, recipientEmail),
        });
    };

    private generateHtmlContent(
        otpCode: string,
        purpose: OtpPurpose,
        email?: string
    ): string {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const verifyLink =
            purpose === OtpPurpose.REGISTER
                ? `${frontendUrl}/verify-otp?email=${encodeURIComponent(email || '')}&otp=${otpCode}`
                : `${frontendUrl}/reset-password?email=${encodeURIComponent(email || '')}&otp=${otpCode}`;

        const htmlContent = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width:480px; margin:0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding:2px; border-radius:12px;">
        <div style="background:#ffffff; border-radius:10px; padding:25px 20px;">
          <!-- Header -->
          <div style="text-align:center; margin-bottom:20px;">
            <h1 style="color:#1e293b; margin:0; font-size:22px; font-weight:700;">Echo English</h1>
          </div>

          <!-- Welcome -->
          <div style="text-align:center; margin-bottom:20px;">
            <h2 style="color:#334155; margin:0 0 8px; font-size:18px; font-weight:600;">
              ${purpose === OtpPurpose.REGISTER ? '🎉 Welcome!' : '🔐 Password Reset'}
            </h2>
            <p style="color:#64748b; margin:0; font-size:14px;">
              ${
                  purpose === OtpPurpose.REGISTER
                      ? 'Please verify your email to get started.'
                      : "Here's your verification code."
              }
            </p>
          </div>

          <!-- OTP Code -->
          <div style="text-align:center; margin:25px 0;">
            <div style="display:inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding:18px 30px; border-radius:10px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
              <div style="color:#ffffff; font-size:11px; font-weight:600; margin-bottom:6px; letter-spacing:1px;">CODE</div>
              <span style="font-size:28px; font-weight:800; color:#ffffff; font-family:monospace; letter-spacing:3px;">
                ${otpCode}
              </span>
            </div>
          </div>

          <!-- Expiry -->
          <div style="background:#fef3c7; border-radius:6px; padding:10px; margin:15px 0; text-align:center;">
            <span style="color:#92400e; font-size:12px; font-weight:500;">
              ⏰ Expires in ${OTP_EXPIRY_MINUTES} minutes
            </span>
          </div>

          <!-- Button -->
          <div style="text-align:center; margin:25px 0;">
            <a href="${verifyLink}" style="display:inline-block; padding:14px 35px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color:#ffffff; text-decoration:none; border-radius:8px; font-weight:700; font-size:15px; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);">
              ${purpose === OtpPurpose.REGISTER ? '✅ Verify Now' : '🔑 Reset Password'}
            </a>
          </div>

          <!-- Footer -->
          <div style="text-align:center; margin-top:20px; padding-top:15px; border-top:1px solid #e2e8f0;">
            <p style="color:#94a3b8; margin:0; font-size:11px;">
              Didn't request this? Ignore this email.
            </p>
          </div>
        </div>
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
            user.deletedReason = null;
            await user.save();
        }
    };
}
