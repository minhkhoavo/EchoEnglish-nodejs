import { Request, Response, NextFunction } from 'express';
import { UserCreateRequest } from '~/dto/request/iam/userCreateRequest';
import ApiResponse from '~/dto/response/apiResponse';
import { SuccessMessage } from '~/enum/successMessage';
import { OtpEmailService } from '~/services/otpEmailService';
import UserService from '~/services/userService';
import { OtpPurpose } from '~/enum/otpPurpose';
import { authService } from '../services/authService';
import { ApiError } from '~/middleware/apiError';
import { User, UserType } from '~/models/userModel';

const otpEmailService = new OtpEmailService();
const userService = new UserService();

class AuthenticationController {
  public getProfile = async (req: Request, res: Response) => {
    const email = req.user?.email;
    if (!email) {
      return res
        .status(401)
        .json(new ApiResponse('Unauthorized: No user information found'));
    }
    return res
      .status(200)
      .json(new ApiResponse('Success', await userService.getProfile(email)));
  };

  public loginUser = async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    return res.status(200).json(new ApiResponse('success', result));
  };

  public registerUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const userDto = new UserCreateRequest(req.body);
    userService
      .registerUser(userDto)
      .then((user: UserType) => {
        res
          .status(201)
          .json(new ApiResponse(SuccessMessage.CREATE_USER_SUCCESS, user));
      })
      .catch((err: any) => {
        res.status(400).json({ error: err.message });
      });
  };

  public verifyRegisterOtp = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    await otpEmailService
      .verifyOtp(req.body.email, req.body.otp, OtpPurpose.REGISTER)
      .then((result) => {
        if (result) {
          res
            .status(200)
            .json(new ApiResponse(SuccessMessage.OTP_VERIFIED_SUCCESS));
        } else {
          res
            .status(400)
            .json(new ApiResponse(SuccessMessage.OTP_INVALID_OR_EXPIRED));
        }
      })
      .catch((err: any) => {
        res
          .status(400)
          .json(new ApiResponse(SuccessMessage.OTP_INVALID_OR_EXPIRED));
      });
  };

  public forgotPassword = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    await otpEmailService
      .sendOtp(req.body.email, OtpPurpose.FORGOT_PASSWORD)
      .then(() => {
        res.status(200).json(new ApiResponse(SuccessMessage.OTP_SENT));
      })
      .catch((err: any) => {
        res.status(400).json({ error: err.message });
      });
  };

  public resetPassword = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    await otpEmailService
      .verifyOtp(req.body.email, req.body.otp, OtpPurpose.FORGOT_PASSWORD)
      .then(async (isValid) => {
        if (!isValid) {
          return res
            .status(400)
            .json(new ApiResponse(SuccessMessage.OTP_INVALID_OR_EXPIRED));
        }
        await userService
          .resetPassword(req.body.email, req.body.newPassword)
          .then(() => {
            res
              .status(200)
              .json(new ApiResponse(SuccessMessage.PASSWORD_RESET_SUCCESS));
          })
          .catch((err: any) => {
            res.status(400).json(new ApiError(err));
          });
      })
      .catch((err: any) => {
        res.status(400).json(new ApiError(err));
      });
  };
}

export default AuthenticationController;
