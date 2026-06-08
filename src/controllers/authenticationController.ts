import { Request, Response } from 'express';
import { UserCreateRequest } from '~/types/user.types.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { OtpEmailService } from '~/services/otpEmailService.js';
import UserService from '~/services/userService.js';
import { OtpPurpose } from '~/enum/otpPurpose.js';
import { authService } from '~/services/authService.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

const otpEmailService = new OtpEmailService();
const userService = new UserService();

class AuthenticationController {
    public getProfile = async (
        req: Request,
        res: Response
    ): Promise<Response> => {
        const email = req.user?.email;
        if (!email) {
            throw new ApiError(ErrorMessage.EMAIL_NOT_FOUND_IN_TOKEN);
        }
        return res
            .status(200)
            .json(
                new ApiResponse(
                    SuccessMessage.GET_PROFILE_SUCCESS,
                    await userService.getProfile(email)
                )
            );
    };

    public loginUser = async (
        req: Request,
        res: Response
    ): Promise<Response> => {
        const { email, password } = req.body;
        const result = await authService.login(email, password);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.LOGIN_SUCCESS, result));
    };

    public registerUser = async (
        req: Request,
        res: Response
    ): Promise<Response> => {
        const userDto: UserCreateRequest = req.body;
        const user = await userService.registerUser(userDto);
        return res
            .status(201)
            .json(new ApiResponse(SuccessMessage.REGISTER_SUCCESS, user));
    };

    public verifyRegisterOtp = async (
        req: Request,
        res: Response
    ): Promise<Response> => {
        await otpEmailService.verifyOtp(
            req.body.email,
            req.body.otp,
            OtpPurpose.REGISTER
        );
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.OTP_VERIFIED_SUCCESS));
    };

    public forgotPassword = async (
        req: Request,
        res: Response
    ): Promise<Response> => {
        await otpEmailService.sendOtp(
            req.body.email,
            OtpPurpose.FORGOT_PASSWORD
        );
        return res.status(200).json(new ApiResponse(SuccessMessage.OTP_SENT));
    };

    public resetPassword = async (
        req: Request,
        res: Response
    ): Promise<Response> => {
        await userService.resetPasswordWithOtp(
            req.body.email,
            req.body.newPassword,
            req.body.otp
        );
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.PASSWORD_RESET_SUCCESS));
    };
}

export default AuthenticationController;
