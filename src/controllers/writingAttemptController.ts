import { Request, Response } from 'express';
import { writingAttemptService } from '~/services/writingAttemptService.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { ApiError } from '~/middleware/apiError.js';

class WritingAttemptController {
    public submitAndScore = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const { toeicWritingTestId, answers } = req.body;
        if (!toeicWritingTestId) {
            throw new ApiError(ErrorMessage.WRITING_TEST_ID_REQUIRED);
        }
        if (!answers || typeof answers !== 'object') {
            throw new ApiError(ErrorMessage.ANSWERS_OBJECT_REQUIRED);
        }

        const result = await writingAttemptService.submitAndScore({
            userId,
            toeicWritingTestId,
            answers,
        });

        res.status(201).json(
            new ApiResponse(
                'Bài thi đã được nộp thành công! Kết quả sẽ có sau vài phút.',
                result
            )
        );
    };
}

export default new WritingAttemptController();
