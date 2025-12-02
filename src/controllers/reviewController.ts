import { Request, Response } from 'express';
import ApiResponse from '../dto/response/apiResponse.js';
import FlashCardService from '../services/flashcardService.js';
import { SuccessMessage } from '../enum/successMessage.js';
import { ApiError } from '../middleware/apiError.js';
import { ReviewResult } from '../services/spacedRepetitionService.js';

class ReviewController {
    /**
     * Get flashcards due for review
     * GET /api/reviews/due?limit=20&categoryId=xxx
     */
    public getDueFlashcards = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError({ message: 'Unauthorized' });
        }
        const limit = parseInt(req.query.limit as string) || 20;
        const categoryId = req.query.categoryId as string;

        const flashcards = await FlashCardService.getFlashcardsForReview(
            userId,
            limit,
            categoryId
        );

        return res.status(200).json(
            new ApiResponse(SuccessMessage.GET_SUCCESS, {
                flashcards,
                count: flashcards.length,
            })
        );
    };

    /**
     * Submit a review result
     * POST /api/reviews/submit
     * Body: { flashcardId: string, result: "forgot" | "remember" }
     */
    public submitReview = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError({ message: 'Unauthorized' });
        }
        const { flashcardId, result } = req.body;

        if (!flashcardId) {
            throw new ApiError({ message: 'Flashcard ID is required' });
        }

        if (!result) {
            throw new ApiError({
                message: 'Result is required ("forgot" or "remember")',
            });
        }

        const validResults = ['forgot', 'remember'];
        if (!validResults.includes(result)) {
            throw new ApiError({
                message: 'Result must be "forgot" or "remember"',
            });
        }

        const reviewResult: ReviewResult = {
            remember: result === 'remember',
        };

        const updatedFlashcard = await FlashCardService.updateReviewResult(
            flashcardId,
            userId,
            reviewResult
        );

        return res
            .status(200)
            .json(
                new ApiResponse(
                    'Review submitted successfully',
                    updatedFlashcard
                )
            );
    };

    /**
     * Get review statistics
     * GET /api/reviews/statistics?categoryId=xxx
     */
    public getStatistics = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError({ message: 'Unauthorized' });
        }
        const categoryId = req.query.categoryId as string;

        const stats = await FlashCardService.getReviewStatistics(
            userId,
            categoryId
        );

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, stats));
    };

    /**
     * Reset all review progress (development/testing)
     * POST /api/reviews/reset
     */
    public resetProgress = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError({ message: 'Unauthorized' });
        }

        const result = await FlashCardService.resetAllReviews(userId);

        return res
            .status(200)
            .json(
                new ApiResponse('All review progress has been reset', result)
            );
    };
}

export default new ReviewController();
