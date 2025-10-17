import { Request, Response } from 'express';
import UserService from '~/services/userService.js';
import { UserCreateRequest } from '~/types/user.types.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import { roadmapService } from '~/services/recommendation/RoadmapService.js';
import { Types } from 'mongoose';

class UserController {
    public userService = new UserService();

    public getUserById = async (req: Request, res: Response) => {
        const { id } = req.params;
        const user = await this.userService.getUserById(id);
        return res.status(200).json(new ApiResponse('success', user));
    };

    public createUser = async (req: Request, res: Response) => {
        const userDto: UserCreateRequest = req.body;
        const user = await this.userService.createUser(userDto);
        return res
            .status(201)
            .json(new ApiResponse(SuccessMessage.CREATE_USER_SUCCESS, user));
    };

    public updateUser = async (req: Request, res: Response) => {
        const userId = req.params.id;
        const updateData = req.body;

        const user = await this.userService.updateUser(userId, updateData);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.UPDATE_USER_SUCCESS, user));
    };

    public updateProfileUser = async (req: Request, res: Response) => {
        if (!req.user || !req.user.id) {
            return res
                .status(401)
                .json(new ApiError(ErrorMessage.UNAUTHORIZED));
        }
        const userId = req.user.id;
        const updateData = req.body;
        const user = await this.userService.updateProfileUser(
            userId,
            updateData
        );
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.UPDATE_USER_SUCCESS, user));
    };

    public softDeleteUser = async (req: Request, res: Response) => {
        const userId = req.params.id;
        await this.userService.softDelete(userId);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.DELETE_USER_SUCCESS));
    };

    public getCredit = async (req: Request, res: Response) => {
        const userId = req.user?.id as string;
        const user = await this.userService.getUserById(userId);
        if (!user) {
            return res
                .status(404)
                .json(new ApiError(ErrorMessage.USER_NOT_FOUND));
        }
        return res.status(200).json(
            new ApiResponse(SuccessMessage.GET_SUCCESS, {
                credits: user.credits,
            })
        );
    };

    public getAllUsers = async (req: Request, res: Response) => {
        const { page, limit, fields } = req.query;

        const pageNum = parseInt(page as string) || 1;
        const limitNum = parseInt(limit as string) || 10;

        if (pageNum < 1 || limitNum < 1) {
            throw new ApiError(ErrorMessage.INVALID_PAGE_LIMIT);
        }

        const result = await this.userService.getAllUsers(
            pageNum,
            limitNum,
            fields as string
        );
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    };

    public getUserPreference = async (req: Request, res: Response) => {
        const userId = req.user?.id as string;
        const preferences = await this.userService.getUserPreference(userId);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, preferences));
    };

    public setUserPreferences = async (req: Request, res: Response) => {
        if (!req.user || !req.user.id) {
            return res
                .status(401)
                .json(new ApiError(ErrorMessage.UNAUTHORIZED));
        }
        const userId = req.user.id;
        const preferencesData = req.body;

        const preferences = await this.userService.setUserPreferences(
            userId,
            preferencesData
        );
        await roadmapService.updateRoadmapScheduleFromUserPreferences(
            new Types.ObjectId(userId)
        );
        return res
            .status(200)
            .json(
                new ApiResponse(SuccessMessage.UPDATE_USER_SUCCESS, preferences)
            );
    };
}

export default UserController;
