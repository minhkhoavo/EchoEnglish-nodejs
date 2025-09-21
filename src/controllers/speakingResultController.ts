import { Request, Response, NextFunction } from 'express';
import mongoose, { Types } from 'mongoose';
import ApiResponse from '~/dto/response/apiResponse';
import { ApiError } from '~/middleware/apiError';
import { ErrorMessage } from '~/enum/errorMessage';

class SpeakingResultController {
    private toObjectId(id: string) {
        try {
            return new Types.ObjectId(id);
        } catch {
            throw new ApiError(ErrorMessage.INVALID_ID);
        }
    }

    private async getDb() {
        if (mongoose.connection.readyState !== 1) {
            throw new ApiError(ErrorMessage.INTERNAL_ERROR);
        }
        return mongoose.connection.db!;
    }

    async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = (req.query?.id as string) || (req.body?.id as string) || (req.params?.id as string);
            if (!id) throw new ApiError({ message: 'id is required', status: 400 });

            const db = await this.getDb();

            let query: any = {};
            if (/^[a-f\d]{24}$/i.test(id)) {
                query._id = this.toObjectId(id);
            } else {
                query._id = id;
            }

            const doc = await db.collection('toeic_speaking_results').findOne(query as any);
            if (!doc) throw new ApiError(ErrorMessage.NOTFOUND);

            res.status(200).json(new ApiResponse('OK', doc));
        } catch (err) {
            next(err);
        }
    }
}

export default new SpeakingResultController();
