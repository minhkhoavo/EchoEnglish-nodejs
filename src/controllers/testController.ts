import { Request, Response } from 'express';
import TestService from '../services/testService';
import ApiResponse from '~/dto/response/apiResponse';
import { ApiError } from '~/middleware/apiError';
import { ErrorMessage } from '~/enum/errorMessage';

class TestController {
  public getAllTests = async (req: Request, res: Response) => {
    try {
      const tests = await TestService.getAllTests();
      return res
        .status(200)
        .json(new ApiResponse('Get all tests success', tests));
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
        .json(new ApiResponse('Get test by ID success', test));
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

      if (isNaN(partNum) || partNum < 1 || partNum > 7) {
        return res
          .status(ErrorMessage.INVALID_PART_NUMBER.status)
          .json(new ApiResponse(ErrorMessage.INVALID_PART_NUMBER.message));
      }

      const test = await TestService.getTestByPart(testId, partNum);

      if (!test) {
        return res
          .status(ErrorMessage.TEST_NOT_FOUND.status)
          .json(new ApiResponse(ErrorMessage.TEST_NOT_FOUND.message));
      }

      return res
        .status(200)
        .json(new ApiResponse('Get test by part success', test));
    } catch (error) {
      console.error('Error fetching test by part:', error);
      return res
        .status(500)
        .json(new ApiResponse(ErrorMessage.INTERNAL_ERROR.message));
    }
  };
}

export default new TestController();
