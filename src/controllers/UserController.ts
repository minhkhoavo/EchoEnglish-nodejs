import { Request, Response, NextFunction } from "express";
import UserService from "~/services/UserService";
import { UserCreateRequest } from "~/dto/request/iam/UserCreateRequest";
import ApiResponse from "~/dto/response/ApiResponse";
import { SuccessMessage } from "~/enum/success_message";

class UserController {
    public userService = new UserService();

    public getUserById = async (req: Request, res: Response)=>{
        const {id} = req.params;
        return res.status(200).json(new ApiResponse('success', await this.userService.getUserById(id)))
    }

    // Hàm tạo user
    public  createUser = async (req: Request, res: Response, next: NextFunction) => {
        
        const userDto = new UserCreateRequest(req.body);
        this.userService.createUser(userDto)
        .then(user => {
            res.status(201).json(new ApiResponse(SuccessMessage.CREATE_USER_SUCCESS, user));
        })
        .catch((err: any) => {
            res.status(400).json({ error: err.message });
        });
    }
}

export default UserController;


