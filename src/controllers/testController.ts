import { Request, Response } from 'express';
import TestService from '../services/testService.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';

class TestController {
    public getAllTests = async (req: Request, res: Response) => {
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

        const test = await TestService.getTestById(id, partNumbers);

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

    public getQuestionsByIds = async (req: Request, res: Response) => {
        const { questionIds } = req.body;

        // Validate input
        if (!Array.isArray(questionIds) || questionIds.length === 0) {
            return res
                .status(400)
                .json(
                    new ApiResponse(
                        'Question IDs array is required and cannot be empty',
                        null
                    )
                );
        }

        // Validate that all elements are strings
        if (!questionIds.every((id) => typeof id === 'string')) {
            return res
                .status(400)
                .json(
                    new ApiResponse('All question IDs must be strings', null)
                );
        }
        const result = await TestService.getQuestionsByIds(questionIds);

        return res
            .status(200)
            .json(
                new ApiResponse(SuccessMessage.GET_TEST_BY_ID_SUCCESS, result)
            );
    };

    public findRandomQuestionIds = async (req: Request, res: Response) => {
        const { skills, domains, limit } = req.body;

        // Validate input
        if (!skills && !domains) {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }

        if (limit !== undefined && (typeof limit !== 'number' || limit <= 0)) {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }

        const questionIds = await TestService.findRandomQuestionIds(
            { skills, domains },
            limit || 10 // Default limit to 10 if not provided
        );

        return res
            .status(200)
            .json(
                new ApiResponse(
                    SuccessMessage.GET_RANDOM_QUESTIONS_SUCCESS,
                    questionIds
                )
            );
    };
}

export default new TestController();
