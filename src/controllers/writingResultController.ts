import { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';

class WritingResultController {
    private async getDb() {
        if (mongoose.connection.readyState !== 1) {
            throw new ApiError(ErrorMessage.INTERNAL_ERROR);
        }
        return mongoose.connection.db!;
    }

    public getAll = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const db = await this.getDb();
        const query: Record<string, unknown> = {};
        query.userId = new Types.ObjectId(userId);

        const result = await db
            .collection('toeic_writing_results')
            .find(query, { projection: { parts: 0 } })
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).json(
            new ApiResponse(SuccessMessage.GET_SUCCESS, result)
        );
    };

    public getById = async (req: Request, res: Response) => {
        const { id } = req.params;
        if (!id) {
            throw new ApiError(ErrorMessage.RESULT_ID_REQUIRED);
        }

        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const db = await this.getDb();
        const resultId = new Types.ObjectId(id);
        const userObjectId = new Types.ObjectId(userId);

        const doc = await db
            .collection('toeic_writing_results')
            .findOne({ _id: resultId, userId: userObjectId });

        if (!doc) {
            throw new ApiError(ErrorMessage.WRITING_TEST_NOT_FOUND);
        }

        res.status(200).json(new ApiResponse(SuccessMessage.GET_SUCCESS, doc));
    };
}

export default new WritingResultController();
