import { Request, Response } from 'express';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import FlashCardService from '~/services/flashcardService.js';
class FlashcardController {
    public createFlashcard = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }
        const flashcard = await FlashCardService.createFlashcard(
            req.body,
            userId
        );
        return res
            .status(200)
            .json(
                new ApiResponse(
                    SuccessMessage.CREATE_FLASHCARD_SUCCESS,
                    flashcard
                )
            );
    };

    public updateFlashcard = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }
        const flashcardId = req.params.id;
        const flashcard = await FlashCardService.updateFlashcard(
            flashcardId,
            req.body,
            userId
        );
        return res
            .status(200)
            .json(
                new ApiResponse(
                    SuccessMessage.UPDATE_FLASHCARD_SUCCESS,
                    flashcard
                )
            );
    };

    public deleteFlashcard = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }
        const flashcardId = req.params.id;
        await FlashCardService.deleteFlashcard(flashcardId, userId);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.DELETE_FLASHCARD_SUCCESS));
    };

    public getFlashcardByCategory = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }
        const cateId = req.params.cateId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;

        const result = await FlashCardService.getFlashcardByCategoryId(
            cateId,
            userId,
            page,
            limit
        );

        return res.status(200).json(new ApiResponse('Success', result));
    };

    public getAllFlashcard = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }
        const page = req.query.page
            ? parseInt(req.query.page as string)
            : undefined;
        const limit = req.query.limit
            ? parseInt(req.query.limit as string)
            : undefined;
        const result = await FlashCardService.getAllFlashcard(
            userId,
            page,
            limit
        );
        return res.status(200).json(new ApiResponse('Success', result));
    };

    public getFlashcardBySource = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) throw new ApiError(ErrorMessage.UNAUTHORIZED);

        const { source } = req.body;
        if (!source) {
            throw new ApiError(ErrorMessage.SOURCE_REQUIRED);
        }

        const result = await FlashCardService.getAllFlashcardBySource(
            source,
            userId
        );

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    };

    public bulkUpdateFlashcards = async (req: Request, res: Response) => {
        const userId = req.user?.id as string;
        const { updates } = req.body;
        if (!Array.isArray(updates) || updates.length === 0) {
            throw new ApiError({
                message: 'Updates array is required and cannot be empty',
            });
        }

        // Transform updates format: { id, category } -> { id, data: { category } }
        const transformedUpdates = updates.map((update) => ({
            id: update.id, // id of the flashcard
            data: { category: update.category }, // category
        }));

        const flashcards = await FlashCardService.bulkUpdateFlashcards(
            transformedUpdates,
            userId
        );

        return res.status(200).json(
            new ApiResponse(SuccessMessage.BULK_UPDATE_FLASHCARD_SUCCESS, {
                flashcards,
                count: flashcards.length,
            })
        );
    };

    public bulkCreateFlashcards = async (req: Request, res: Response) => {
        const userId = req.user?.id as string;
        const { flashcards } = req.body;
        if (!Array.isArray(flashcards) || flashcards.length === 0) {
            throw new ApiError({
                message: 'Flashcards array is required and cannot be empty',
            });
        }

        const createdFlashcards = await FlashCardService.bulkCreateFlashcards(
            flashcards,
            userId
        );

        return res.status(201).json(
            new ApiResponse(SuccessMessage.BULK_CREATE_FLASHCARD_SUCCESS, {
                flashcards: createdFlashcards,
                count: createdFlashcards.length,
            })
        );
    };

    public bulkDeleteFlashcards = async (req: Request, res: Response) => {
        const userId = req.user?.id as string;
        const { flashcardIds } = req.body;
        if (!Array.isArray(flashcardIds) || flashcardIds.length === 0) {
            throw new ApiError({
                message: 'Flashcard IDs array is required and cannot be empty',
            });
        }

        const result = await FlashCardService.bulkDeleteFlashcards(
            flashcardIds,
            userId
        );

        return res
            .status(200)
            .json(
                new ApiResponse(SuccessMessage.DELETE_FLASHCARD_SUCCESS, result)
            );
    };
}

export default new FlashcardController();
