import { Request, Response, NextFunction } from "express";
import UserService from "~/services/UserService";
import { UserCreateRequest } from "~/dto/request/iam/UserCreateRequest";
import ApiResponse from "~/dto/response/ApiResponse";
import { SuccessMessage } from "~/enum/success_message";
import { ErrorMessage } from "~/enum/error_message";

class UserController {
    public userService = new UserService();

    public getUserById = async (req: Request, res: Response)=>{
        const {id} = req.params;
        const user = await this.userService.getUserById(id);
        return res.status(200).json(new ApiResponse('success', user))
    }

    // Hàm tạo user
    public  createUser = async (req: Request, res: Response, next: NextFunction) => {
        
        const userDto = new UserCreateRequest(req.body);
        await this.userService.createUser(userDto)
        .then(user => {
            res.status(201).json(new ApiResponse(SuccessMessage.CREATE_USER_SUCCESS, user));
        })
        .catch((err: any) => {
            res.status(400).json({ error: err.message });
        });
    }

    // Hàm cập nhật user
    public updateUser = async (req: Request, res: Response, next: NextFunction) => {
        const userId = req.params.id;
        const updateData = req.body;
        await this.userService.updateUser(userId, updateData)
        .then(user => {
            res.status(200).json(new ApiResponse(SuccessMessage.UPDATE_USER_SUCCESS,user));
        })
        .catch((err: any) => {
            res.status(400).json(new ApiResponse(ErrorMessage.UPDATE_USER_FAIL));
        });
    }

    // Hàm cập nhật thông tin user
    public updateProfileUser = async (req: Request, res: Response, next: NextFunction) => {
        const userId = req.params.id;
        const updateData = req.body;
        await this.userService.updateProfileUser(userId, updateData)
        .then(user => {
            res.status(200).json(new ApiResponse(SuccessMessage.UPDATE_USER_SUCCESS, user));
        })
        .catch((err: any) => {
            res.status(400).json(new ApiResponse(ErrorMessage.UPDATE_USER_FAIL));
        });
    }

    // Hàm xóa mềm user
    public softDeleteUser = async (req: Request, res: Response, next: NextFunction) => {
        const userId = req.params.id;
        await this.userService.softDelete(userId)
        .then(user => {
            res.status(200).json(new ApiResponse(SuccessMessage.DELETE_USER_SUCCESS));
        })
        .catch((err: any) => {
            res.status(400).json(new ApiResponse(ErrorMessage.DELETE_USER_FAIL));
        });
    }

}

export default UserController;


