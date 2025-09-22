import { Request, Response, NextFunction } from 'express';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ApiError } from './apiError.js';
import mongoose from 'mongoose';
import { ErrorMessage } from '~/enum/errorMessage.js';

/* Handler exception error */
/* cách dùng: throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND); */
/* cách dùng: throw new ApiError({message: 'Khong ton tai nhe', status: 450}) */
/* cách dùng: throw new ApiError('CATEGORY_NOT_FOUND') */
class ErrorMiddleware {
    public handleError(
        err: Error,
        req: Request,
        res: Response,
        next: NextFunction
    ) {
        // Lỗi do mình throw ra
        if (err instanceof ApiError) {
            return res.status(err.status).json(new ApiResponse(err.message));
        }

        // Lỗi id không hợp lệ
        if (err instanceof mongoose.Error.CastError) {
            return res
                .status(ErrorMessage.INVALID_ID.status)
                .json(new ApiResponse(ErrorMessage.INVALID_ID.message));
        }

        // Lỗi validate của mongoose
        if (err instanceof mongoose.Error.ValidationError) {
            const messages = Object.values(err.errors).map((e) => {
                const key = e.message as keyof typeof ErrorMessage;
                return ErrorMessage[key]?.message || e.message;
            });
            return res.status(400).json(new ApiResponse(messages.join(', ')));
        }

        // Lỗi không xác định (Fallback)
        console.error('Unhandled error:', err);
        return res.status(500).json(new ApiResponse('Internal Server Error'));
    }
}

export default new ErrorMiddleware();
