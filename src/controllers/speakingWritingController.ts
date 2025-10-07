import { Request, Response } from 'express';
import SpeakingWritingService from '~/services/speakingWritingService.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';

class SpeakingWritingController {
    public getAllTests = async (req: Request, res: Response) => {
        const { type } = req.query;
        const query: Record<string, unknown> = {};

        if (type && typeof type === 'string') {
            query.type = type;
        }

        const tests = await SpeakingWritingService.getAllTests(query);
        const responseData = Array.isArray(tests) ? tests : [];
        return res
            .status(200)
            .json(
                new ApiResponse(
                    SuccessMessage.GET_ALL_TESTS_SUCCESS,
                    responseData
                )
            );
    };

    public getTestById = async (req: Request, res: Response) => {
        const { id } = req.params;
        const { parts } = req.query;

        // Parse parts (nếu có)
        const partNumbers =
            typeof parts === 'string'
                ? parts
                      .split(',')
                      .map((num) => parseInt(num.trim(), 10))
                      .filter((n) => !isNaN(n))
                : [];

        const test = await SpeakingWritingService.getTestById(id, partNumbers);

        return res
            .status(200)
            .json(
                new ApiResponse(
                    parts
                        ? SuccessMessage.GET_TEST_BY_PART_SUCCESS
                        : SuccessMessage.GET_TEST_BY_ID_SUCCESS,
                    test
                )
            );
    };
}

export default new SpeakingWritingController();
