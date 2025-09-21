import { Request, Response, NextFunction } from 'express';
import UserService from '~/services/userService';
import { UserCreateRequest } from '~/dto/request/iam/userCreateRequest';
import ApiResponse from '~/dto/response/apiResponse';
import { SuccessMessage } from '~/enum/successMessage';
import { ErrorMessage } from '~/enum/errorMessage';
import { ApiError } from '~/middleware/apiError';
import { UserResponseType, UserUpdateResponseType } from "../models/userModel";

class UserController {
    public userService = new UserService();

    public getUserById = async (req: Request, res: Response) => {
        const { id } = req.params;
        const user = await this.userService.getUserById(id);
        return res.status(200).json(new ApiResponse('success', user));
    };

    public createUser = async (req: Request, res: Response, next: NextFunction) => {
        const userDto = new UserCreateRequest(req.body);
        await this.userService
            .createUser(userDto)
            .then((user: UserResponseType) => {
                res.status(201).json(new ApiResponse(SuccessMessage.CREATE_USER_SUCCESS, user));
            })
            .catch((err: any) => {
                res.status(400).json({ error: err.message });
            });
    };

    public updateUser = async (req: Request, res: Response, next: NextFunction) => {
        const userId = req.params.id;
        const updateData = req.body;
        await this.userService
            .updateUser(userId, updateData)
            .then((user: UserUpdateResponseType) => {
                res.status(200).json(new ApiResponse(SuccessMessage.UPDATE_USER_SUCCESS, user));
            })
            .catch((err: any) => {
                res.status(400).json(new ApiError(ErrorMessage.UPDATE_USER_FAIL));
            });
    };

    public updateProfileUser = async (req: Request, res: Response, next: NextFunction) => {
        if (!req.user || !req.user.id) {
            return res.status(401).json(new ApiError(ErrorMessage.UNAUTHORIZED));
        }
        const userId = req.user.id;
        const updateData = req.body;
        await this.userService
            .updateProfileUser(userId, updateData)
            .then((user: any) => {
                res.status(200).json(new ApiResponse(SuccessMessage.UPDATE_USER_SUCCESS, user));
            })
            .catch((err: any) => {
                res.status(400).json(new ApiError(ErrorMessage.UPDATE_USER_FAIL));
            });
    };

    public softDeleteUser = async (req: Request, res: Response, next: NextFunction) => {
        const userId = req.params.id;
        await this.userService
            .softDelete(userId)
            .then((user: any) => {
                res.status(200).json(new ApiResponse(SuccessMessage.DELETE_USER_SUCCESS));
            })
            .catch((err: any) => {
                res.status(400).json(new ApiError(ErrorMessage.DELETE_USER_FAIL));
            });
    };
}

export default UserController;
