import { Request, Response } from 'express';
import { flashcardAgent } from '~/ai/agent/chatbotAgent.js';
import { ApiError } from '~/middleware/apiError.js';

interface MulterRequest extends Request {
    file?: Express.Multer.File;
}

class ChatbotAgentController {
    public runAgent = async (req: MulterRequest, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                throw new ApiError({ message: 'Unauthorized' });
            }
            let prompt: string;
            let image: string | undefined;
            prompt = req.body?.prompt;

            if (!prompt) {
                throw new ApiError({ message: 'Prompt is required' });
            }
            if (req.file) {
                const imageBuffer = req.file.buffer;
                const base64Image = imageBuffer.toString('base64');
                image = `data:${req.file.mimetype};base64,${base64Image}`;
            } else if (req.body.image) {
                image = req.body.image;
            }

            let enhancedPrompt = prompt;

            if (image) {
                enhancedPrompt = `[IMAGE PROVIDED] Please analyze the image and follow this prompt ${prompt}`;
            }

            const result = await flashcardAgent.run(
                enhancedPrompt,
                userId,
                image
            );
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
