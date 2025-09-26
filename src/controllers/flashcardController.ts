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
}

export default new FlashcardController();
