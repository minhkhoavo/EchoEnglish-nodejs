import { Request,Response,NextFunction } from "express";
import { UserCreateRequest } from "~/dto/request/iam/UserCreateRequest";
import ApiResponse from "~/dto/response/ApiResponse";
import { SuccessMessage } from "~/enum/success_message";
import { OtpEmailService } from "~/services/OtpEmailService";
import UserService from "~/services/UserService";
import { OtpPurpose } from "~/enum/otp_purpose";
import {authService} from "../services/AuthService"

const otpEmailService = new OtpEmailService();
const userService = new UserService();

class AuthenticationController {

    public getProfile = async (req: Request, res: Response)=>{
        const email = req.user.email;
        return res.status(200).json(new ApiResponse("Sucess", await userService.getProfile(email)))
    }

    //ham login
    public loginUser = async (req: Request, res: Response)=>{
        const {email, password} = req.body;
        const result = await authService.login(email, password);
        return res.status(200).json(new ApiResponse('success', result));
    }

    // Hàm đăng ký user
    public registerUser = async (req: Request, res: Response, next: NextFunction) => {
        const userDto = new UserCreateRequest(req.body);
        userService.registerUser(userDto)
        .then(user => {
            res.status(201).json(new ApiResponse(SuccessMessage.CREATE_USER_SUCCESS, user));
        })
        .catch((err: any) => {
            res.status(400).json({ error: err.message });
        });
    }

    // Hàm xác thực OTP đăng ký
    public verifyRegisterOtp = async (req: Request, res: Response, next: NextFunction) => {
        await otpEmailService.verifyOtp(req.body.email, req.body.otp, OtpPurpose.REGISTER)
        .then((result) => {
            if (result) {
                res.status(200).json(new ApiResponse(SuccessMessage.OTP_VERIFIED_SUCCESS));
            }
        })
        .catch((err: any) => {
            res.status(400).json(new ApiResponse(SuccessMessage.OTP_INVALID_OR_EXPIRED));
        });

    }

    // Hàm quên mật khẩu
    public forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
        await otpEmailService.sendOtp(req.body.email, OtpPurpose.FORGOT_PASSWORD)
        .then(() => {
            res.status(200).json(new ApiResponse(SuccessMessage.OTP_SENT));
        })
        .catch((err: any) => {
            res.status(400).json({ error: err.message });
        });
    }

    // Hàm đặt lại mật khẩu
    public resetPassword = async (req: Request, res: Response, next: NextFunction) => {
        // Xác thực OTP
        await otpEmailService.verifyOtp(req.body.email, req.body.otp, OtpPurpose.FORGOT_PASSWORD)
        .then(async (isValid) => {
            if (!isValid) {
                return res.status(400).json(new ApiResponse(SuccessMessage.OTP_INVALID_OR_EXPIRED));
            }
            // Đặt lại mật khẩu
            await userService.resetPassword(req.body.email, req.body.newPassword)
            .then(() => {
                res.status(200).json(new ApiResponse(SuccessMessage.PASSWORD_RESET_SUCCESS));
            })
            .catch((err: any) => {
                res.status(400).json({ error: err.message });
            });
        })
        .catch((err: any) => {
            res.status(400).json({ error: err.message });
        });
    }
}

export default AuthenticationController;