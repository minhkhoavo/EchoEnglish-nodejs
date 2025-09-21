import { Request, Response } from 'express';
import { testResultService } from '../services/testResultService';
import { SubmitTestResultRequest } from '../dto/request/testResultRequest';
import { SuccessMessage } from '../enum/successMessage';
import { ErrorMessage } from '../enum/errorMessage';

export class TestResultController {
  async submitTestResult(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: ErrorMessage.UNAUTHORIZED.message,
        });
      }

      const requestData: SubmitTestResultRequest = req.body;

      // Validate required fields
      if (
        !requestData.testId ||
        !requestData.testTitle ||
        !requestData.userAnswers ||
        !Array.isArray(requestData.userAnswers)
      ) {
        console.log('❌ Validation failed:', {
          hasTestId: !!requestData.testId,
          hasTestTitle: !!requestData.testTitle,
          hasUserAnswers: !!requestData.userAnswers,
          isArrayUserAnswers: Array.isArray(requestData.userAnswers),
        });
        return res.status(400).json({
          success: false,
          message: 'Missing required fields',
        });
      }

      const result = await testResultService.submitTestResult(
        userId,
        requestData
      );

      res.status(201).json({
        success: true,
        message: SuccessMessage.CREATE_SUCCESS,
        data: result,
      });
    } catch (error: any) {
      console.error(
        '[submitTestResult] ERROR:',
        error && error.stack ? error.stack : error
      );
      res.status(500).json({
        success: false,
        message:
          error && error.message
            ? error.message
            : ErrorMessage.INTERNAL_ERROR.message,
      });
    }
  }

  async getTestHistory(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: ErrorMessage.UNAUTHORIZED.message,
        });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const filterUserId = (req.query.userId as string) || undefined;
      const testId = (req.query.testId as string) || undefined;

      const result = await testResultService.getTestHistory(
        filterUserId || userId,
        page,
        limit,
        testId
      );

      res.status(200).json({
        success: true,
        message: SuccessMessage.GET_SUCCESS,
        data: result.results,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || ErrorMessage.INTERNAL_ERROR.message,
      });
    }
  }

  async getTestResultDetail(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: ErrorMessage.UNAUTHORIZED.message,
        });
      }

      const { resultId } = req.params;
      if (!resultId) {
        return res.status(400).json({
          success: false,
          message: 'Result ID is required',
        });
      }

      const result = await testResultService.getTestResultDetail(
        userId,
        resultId
      );

      res.status(200).json({
        success: true,
        message: SuccessMessage.GET_SUCCESS,
        data: result,
      });
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || ErrorMessage.INTERNAL_ERROR.message,
      });
    }
  }

  async getUserStats(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: ErrorMessage.UNAUTHORIZED.message,
        });
      }

      const stats: any = await testResultService.getUserStats(userId);

      res.status(200).json({
        success: true,
        message: SuccessMessage.GET_SUCCESS,
        data: stats,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || ErrorMessage.INTERNAL_ERROR.message,
      });
    }
  }
}

export const testResultController = new TestResultController();
