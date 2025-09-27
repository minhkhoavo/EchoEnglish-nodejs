import { Request, Response } from 'express';
import { flashcardAgent } from '~/ai/agent/chatbotAgent.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ApiError } from '~/middleware/apiError.js';

class ChatbotAgentController {
    public runAgent = async (req: Request, res: Response) => {
        try {
            const { prompt } = req.body;
            const userId = req.user?.id as string;

            if (!prompt) {
                throw new ApiError({ message: 'Prompt is required' });
            }
            const result = await flashcardAgent.run(prompt, userId);
            return res.status(200).json(result);
        } catch (error) {
            console.error('Error executing agent:', error);
            if (error instanceof ApiError) {
                throw error;
            }
            throw new ApiError({ message: 'Failed to execute agent' });
        }
    };
}

export default new ChatbotAgentController();
