import { Request, Response } from 'express';
import TestService from '../services/testService.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';

class TestController {
    public getAllTests = async (req: Request, res: Response) => {
        try {
            const tests = await TestService.getAllTests();
            const responseData = Array.isArray(tests) ? tests : [];
            return res
                .status(200)
                .json(
                    new ApiResponse(
                        SuccessMessage.GET_ALL_TESTS_SUCCESS,
                        responseData
                    )
                );
        } catch (error) {
            console.error('Error fetching all tests:', error);
            return res
                .status(500)
                .json(new ApiResponse(ErrorMessage.INTERNAL_ERROR.message));
        }
    };

    public getTestById = async (req: Request, res: Response) => {
        try {
            const { testId } = req.params;
            const test = await TestService.getTestById(testId);

            if (!test) {
                return res
                    .status(ErrorMessage.TEST_NOT_FOUND.status)
                    .json(new ApiResponse(ErrorMessage.TEST_NOT_FOUND.message));
            }
            return res
                .status(200)
                .json(
                    new ApiResponse(SuccessMessage.GET_TEST_BY_ID_SUCCESS, test)
                );
        } catch (error) {
            console.error('Error fetching test by ID:', error);
            return res
                .status(500)
                .json(new ApiResponse(ErrorMessage.INTERNAL_ERROR.message));
        }
    };

    public getTestByPart = async (req: Request, res: Response) => {
        try {
            const { testId, partNumber } = req.params;
            const partNum = parseInt(partNumber);

            const test = await TestService.getTestByPart(testId, partNum);

            if (!test) {
                return res
                    .status(ErrorMessage.TEST_NOT_FOUND.status)
                    .json(new ApiResponse(ErrorMessage.TEST_NOT_FOUND.message));
            }

            return res
                .status(200)
                .json(
                    new ApiResponse(
                        SuccessMessage.GET_TEST_BY_PART_SUCCESS,
                        test
                    )
                );
        } catch (error) {
            console.error('Error fetching test by part:', error);
            return res
                .status(500)
                .json(new ApiResponse(ErrorMessage.INTERNAL_ERROR.message));
        }
    };
}

export default new TestController();
