import { Request, Response } from 'express';
import { testResultService } from '../services/testResultService.js';
import { SubmitTestResultRequest } from '../dto/request/testResultRequest.js';
import { SuccessMessage } from '../enum/successMessage.js';
import { ErrorMessage } from '../enum/errorMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import ApiResponse from '../dto/response/apiResponse.js';

export class TestResultController {
    async submitTestResult(req: Request, res: Response) {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const requestData: SubmitTestResultRequest = req.body;

        const result = await testResultService.submitTestResult(
            userId,
            requestData
        );

        return res
            .status(201)
            .json(new ApiResponse(SuccessMessage.CREATE_SUCCESS, result));
    }

    async getTestHistory(req: Request, res: Response) {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const testId = (req.query.testId as string) || undefined;

        const result = await testResultService.getTestHistory(
            userId,
            page,
            limit,
            testId
        );

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    }

    async getTestResultDetail(req: Request, res: Response) {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const { testId } = req.params;
        const result = await testResultService.getTestResultDetail(
            userId,
            testId
        );

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    }

    async getUserStats(req: Request, res: Response) {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const stats = await testResultService.getUserStats(userId);

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, stats));
    }

    async getAllListeningReadingResults(req: Request, res: Response) {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const results =
            await testResultService.getAllListeningReadingResults(userId);

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, results));
    }
}

export const testResultController = new TestResultController();
