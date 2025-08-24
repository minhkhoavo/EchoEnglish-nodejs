import {Request, Response, NextFunction } from "express";
import { User } from "~/models/user.model";
import { createUser } from "~/services/UserService";


class UserController {
    async createUser(req: Request,res: Response,next: NextFunction) {
        try{
            const user = await createUser(req.body);
            res.status(201).json(user);
        }
        catch(err: any){
            res.status(400).json({error: err.message});
        }
    }
}

export default UserController;


