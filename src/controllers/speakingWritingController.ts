import { Request, Response } from 'express';
import SpeakingWritingService from '~/services/speakingWritingService';
import ApiResponse from '~/dto/response/apiResponse';
import { ApiError } from '~/middleware/apiError';
import { ErrorMessage } from '~/enum/errorMessage';

class SpeakingWritingController {
  public getAllTests = async (req: Request, res: Response) => {
    try {
      const tests = await SpeakingWritingService.getAllTests();
      return res
        .status(200)
        .json(new ApiResponse('Get all speaking-writing tests success', tests));
    } catch (error) {
      console.error('Error fetching all speaking-writing tests:', error);
      return res
        .status(500)
        .json(new ApiResponse(ErrorMessage.INTERNAL_ERROR.message));
    }
  };

  public getTestById = async (req: Request, res: Response) => {
    try {
      const { testId } = req.params;
      const test = await SpeakingWritingService.getTestById(testId);

      if (!test) {
        return res
          .status(ErrorMessage.TEST_NOT_FOUND.status)
          .json(new ApiResponse(ErrorMessage.TEST_NOT_FOUND.message));
      }
      return res
        .status(200)
        .json(new ApiResponse('Get speaking-writing test by ID success', test));
    } catch (error) {
      console.error('Error fetching speaking-writing test by ID:', error);
      return res
        .status(500)
        .json(new ApiResponse(ErrorMessage.INTERNAL_ERROR.message));
    }
  };
}

export default new SpeakingWritingController();
