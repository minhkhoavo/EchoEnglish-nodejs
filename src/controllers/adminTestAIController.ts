import { Request, Response } from 'express';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { testAuthoringAIService } from '~/ai/service/testAuthoringAIService.js';

class AdminTestAIController {
    /**
     * Generic AI runner. The frontend builds the prompt for each action and
     * posts it here; we forward it to Gemini and return the parsed JSON.
     */
}

export default new AdminTestAIController();
