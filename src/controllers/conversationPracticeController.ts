import { Request, Response } from 'express';
import {
    conversationPracticeService,
    ConversationPracticeMessageRequest,
} from '~/ai/service/conversationPracticeService.js';
import { ApiError } from '~/middleware/apiError.js';

class ConversationPracticeController {
    /**
     * Get all conversation topics grouped by categories
     */
    public getAllTopics = async (_req: Request, res: Response) => {
        try {
            const categoriesWithTopics =
                conversationPracticeService.getCategoriesWithTopics();
            return res.status(200).json({
                success: true,
                data: categoriesWithTopics,
            });
        } catch (error) {
            console.error(
                '[ConversationPracticeController] getAllTopics error:',
                error
            );
            throw new ApiError({
                message: 'Failed to get conversation topics',
            });
        }
    };

    /**
     * Start a new conversation practice session
     * Returns the starter message and initial checklist
     * Can use either topicId OR userPrompt (or both)
     * If only userPrompt provided, AI generates custom topic and tasks
     */
    public startConversation = async (req: Request, res: Response) => {
        try {
            const { topicId, userPrompt } = req.body;

            // Either topicId or userPrompt must be provided
            if (!topicId && !userPrompt) {
                throw new ApiError({
                    message: 'Either topicId or userPrompt must be provided',
                    status: 400,
                });
            }

            const result = await conversationPracticeService.startConversation({
                topicId,
                userPrompt,
            });

            return res.status(200).json({
                success: true,
                data: result,
            });
        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            }
            console.error(
                '[ConversationPracticeController] startConversation error:',
                error
            );
            throw new ApiError({ message: 'Failed to start conversation' });
        }
    };

    /**
     * Send a message in the conversation and get AI response
     * Frontend sends: topicId, userMessage, chatHistory, checklist
     * Returns: assistantMessage, updated checklist, completion status
     */
    public sendMessage = async (req: Request, res: Response) => {
        try {
            const { topicId, userMessage, chatHistory, checklist } =
                req.body as ConversationPracticeMessageRequest;

            // Validate required fields
            if (!topicId) {
                throw new ApiError({
                    message: 'topicId is required',
                    status: 400,
                });
            }

            if (!userMessage || userMessage.trim().length === 0) {
                throw new ApiError({
                    message: 'userMessage is required',
                    status: 400,
                });
            }

            if (!Array.isArray(chatHistory)) {
                throw new ApiError({
                    message: 'chatHistory must be an array',
                    status: 400,
                });
            }

            if (!Array.isArray(checklist)) {
                throw new ApiError({
                    message: 'checklist must be an array',
                    status: 400,
                });
            }

            const result =
                await conversationPracticeService.processConversation({
                    topicId,
                    userMessage,
                    chatHistory,
                    checklist,
                });

            return res.status(200).json({
                success: true,
                data: result,
            });
        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            }
            console.error(
                '[ConversationPracticeController] sendMessage error:',
                error
            );
            throw new ApiError({ message: 'Failed to process message' });
        }
    };
}

export default new ConversationPracticeController();
