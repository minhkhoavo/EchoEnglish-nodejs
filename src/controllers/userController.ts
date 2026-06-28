import { Request, Response } from 'express';
import UserService from '~/services/userService.js';
import { UserCreateRequest } from '~/types/user.types.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import { roadmapService } from '~/services/recommendation/RoadmapService.js';
import { Types } from 'mongoose';
import creditsService from '~/services/payment/creditsService.js';
import { User } from '~/models/userModel.js';
import { Resource } from '~/models/resource.js';

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

    public restoreUser = async (req: Request, res: Response) => {
        const userId = req.params.id;
        const user = await this.userService.restoreUser(userId);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.UPDATE_USER_SUCCESS, user));
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
        const { page, limit, fields, search, gender, includeDeleted, sortBy } =
            req.query;

        const pageNum = parseInt(page as string) || 1;
        const limitNum = parseInt(limit as string) || 10;

        if (pageNum < 1 || limitNum < 1) {
            throw new ApiError(ErrorMessage.INVALID_PAGE_LIMIT);
        }

        const result = await this.userService.getAllUsers(
            pageNum,
            limitNum,
            fields as string,
            search as string,
            gender as string,
            includeDeleted as string,
            sortBy as string
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

    public checkCanAffordFeature = async (req: Request, res: Response) => {
        if (!req.user || !req.user.id) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const userId = req.user.id;
        const { featureType } = req.query;

        if (!featureType || typeof featureType !== 'string') {
            throw new ApiError(ErrorMessage.CATEGORY_REQUIRED);
        }

        const result = await creditsService.checkCanAffordFeature(
            userId,
            featureType
        );

        return res
            .status(200)
            .json(
                new ApiResponse(
                    'Feature affordability check successful',
                    result
                )
            );
    };

    // ==================== PERSONAL RESOURCE LIBRARY ====================

    public getLibrary = async (req: Request, res: Response) => {
        const userId = req.user?.id as string;
        const user = (await User.findById(userId)
            .select('savedResources')
            .lean()) as unknown as {
            savedResources?: unknown[];
        } | null;
        return res
            .status(200)
            .json(
                new ApiResponse(
                    SuccessMessage.GET_SUCCESS,
                    user?.savedResources || []
                )
            );
    };

    public addToLibrary = async (req: Request, res: Response) => {
        const userId = req.user?.id as string;
        const { resourceId } = req.body;
        if (!resourceId) {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }

        const resource = (await Resource.findById(
            resourceId
        ).lean()) as unknown as {
            _id: Types.ObjectId;
            title?: string;
            type?: string;
        } | null;
        if (!resource) {
            throw new ApiError(ErrorMessage.RESOURCE_NOT_FOUND);
        }

        const user = await User.findById(userId);
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        user.savedResources = user.savedResources || [];
        const exists = user.savedResources.some(
            (r: { resourceId: Types.ObjectId }) =>
                r.resourceId.toString() === resourceId.toString()
        );
        if (!exists) {
            user.savedResources.push({
                resourceId: new Types.ObjectId(resourceId),
                title: resource.title,
                type: resource.type,
                addedAt: new Date(),
            });
            await user.save();
        }

        return res
            .status(200)
            .json(
                new ApiResponse(
                    SuccessMessage.UPDATE_SUCCESS,
                    user.savedResources
                )
            );
    };

    public removeFromLibrary = async (req: Request, res: Response) => {
        const userId = req.user?.id as string;
        const { resourceId } = req.params;
        await User.updateOne(
            { _id: new Types.ObjectId(userId) },
            {
                $pull: {
                    savedResources: {
                        resourceId: new Types.ObjectId(resourceId),
                    },
                },
            }
        );
        return res
            .status(200)
            .json(
                new ApiResponse(SuccessMessage.DELETE_SUCCESS, { resourceId })
            );
    };
}

export default UserController;
