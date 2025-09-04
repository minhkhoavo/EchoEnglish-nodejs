import {Request, Response, NextFunction} from 'express';
import ApiResponse from '~/dto/response/ApiResponse';
import { ApiError } from './api_error';
import mongoose from 'mongoose';
import { ErrorMessage } from '~/enum/error_message';

/* Handler exception error */
/* cách dùng: throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND); */
class ErrorMiddleware{
    public handleError(err: any, req: Request, res: Response, next: NextFunction ){
        if(err instanceof ApiError){
            return res.status(err.status).json(new ApiResponse(err.message));
        }

        /* loi id khong hop le */
        if(err instanceof mongoose.Error.CastError){
            return res
            .status(ErrorMessage.INVALID_ID.status)
            .json(new ApiResponse(ErrorMessage.INVALID_ID.message));
        }

        console.error('Unhandled error:', err);
        return res.status(500).json(new ApiResponse('Internal Server Error'));
    }
}

export default new ErrorMiddleware;