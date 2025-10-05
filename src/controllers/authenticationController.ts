import { Request, Response } from 'express';
import { UserCreateRequest } from '~/types/user.types.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { OtpEmailService } from '~/services/otpEmailService.js';
import UserService from '~/services/userService.js';
import { OtpPurpose } from '~/enum/otpPurpose.js';
import { authService } from '../services/authService.js';

const otpEmailService = new OtpEmailService();
const userService = new UserService();

class AuthenticationController {
    public getProfile = async (req: Request, res: Response) => {
        const email = req.user?.email;
        if (!email) {
            return res
                .status(401)
                .json(
                    new ApiResponse('Unauthorized: No user information found')
                );
        }
        return res
            .status(200)
            .json(
                new ApiResponse('Success', await userService.getProfile(email))
            );
    };

    public loginUser = async (req: Request, res: Response) => {
        const { email, password } = req.body;
        const result = await authService.login(email, password);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.LOGIN_SUCCESS, result));
    };

    public registerUser = async (req: Request, res: Response) => {
        const userDto: UserCreateRequest = req.body;
        const user = await userService.registerUser(userDto);
        res.status(201).json(
            new ApiResponse(SuccessMessage.CREATE_USER_SUCCESS, user)
        );
    };

    public verifyRegisterOtp = async (req: Request, res: Response) => {
        await otpEmailService.verifyOtp(
            req.body.email,
            req.body.otp,
            OtpPurpose.REGISTER
        );
        res.status(200).json(
            new ApiResponse(SuccessMessage.OTP_VERIFIED_SUCCESS)
        );
    };

    public forgotPassword = async (req: Request, res: Response) => {
        await otpEmailService.sendOtp(
            req.body.email,
            OtpPurpose.FORGOT_PASSWORD
        );
        res.status(200).json(new ApiResponse(SuccessMessage.OTP_SENT));
    };

    public resetPassword = async (req: Request, res: Response) => {
        await userService.resetPasswordWithOtp(
            req.body.email,
            req.body.newPassword,
            req.body.otp
        );
        res.status(200).json(
            new ApiResponse(SuccessMessage.PASSWORD_RESET_SUCCESS)
        );
    };
}

export default AuthenticationController;
