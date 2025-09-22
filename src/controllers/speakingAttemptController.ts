import { Request, Response, NextFunction } from 'express';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { speakingAttemptService } from '~/services/speakingAttemptService.js';

class SpeakingAttemptController {
  async start(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as Record<string, unknown>)?.id as string;
      if (!userId) throw new ApiError(ErrorMessage.UNAUTHORIZED);

      const { toeicSpeakingTestId } = req.body || {};
      if (!toeicSpeakingTestId) {
        throw new ApiError({
          message: 'Toeic Speaking TestId is required',
          status: 400,
        });
      }

      const result = await speakingAttemptService.startAttempt({
        userId,
        toeicSpeakingTestId,
      });
      res.status(201).json(new ApiResponse('Attempt started', result));
    } catch (err) {
      next(err);
    }
  }

  async submitQuestion(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as Record<string, unknown>)?.id as string;
      if (!userId) throw new ApiError(ErrorMessage.UNAUTHORIZED);

      const { testAttemptId } = req.params;
      const questionNumberRaw = (req.body?.questionNumber ??
        req.query?.questionNumber) as unknown;
      const questionNumber = parseInt(questionNumberRaw as string, 10);
      if (!testAttemptId)
        throw new ApiError({
          message: 'Test Attempt ID is required',
          status: 400,
        });
      if (!Number.isFinite(questionNumber)) {
        throw new ApiError({
          message: 'Question Number is required',
          status: 400,
        });
      }
      if (!req.file)
        throw new ApiError({ message: 'Audio file is required', status: 400 });
      const mime = req.file.mimetype || '';
      const isWav = /audio\/(wav|wave)/i.test(mime);
      if (!isWav) {
        throw new ApiError({
          message: 'Only WAV audio is supported at the moment',
          status: 400,
        });
      }

      const result = await speakingAttemptService.submitQuestion({
        attemptId: testAttemptId,
        userId,
        questionNumber,
        file: {
          buffer: req.file.buffer,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
        },
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async finish(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as Record<string, unknown>)?.id as string;
      if (!userId) throw new ApiError(ErrorMessage.UNAUTHORIZED);
      const { testAttemptId } = req.params;
      if (!testAttemptId)
        throw new ApiError({
          message: 'Test Attempt ID is required',
          status: 400,
        });

      const result = await speakingAttemptService.finishAttempt({
        attemptId: testAttemptId,
        userId,
      });
      res.status(200).json(new ApiResponse('Attempt finished', result));
    } catch (err) {
      next(err);
    }
  }
}

export default new SpeakingAttemptController();
