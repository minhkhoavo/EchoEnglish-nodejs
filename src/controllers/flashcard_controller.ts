import { Flashcard } from '../models/flashcard_model';
import {Request, Response} from 'express';
import ApiResponse from '~/dto/response/api_response';
import { ErrorMessage } from '~/enum/error_message';
import { SuccessMessage } from '~/enum/success_message';
import { ApiError } from '~/middleware/api_error';
import FlashCardService from '~/services/flashcard_service';
class FlashcardController{
    // Hàm tạo flashcard
    public createFlashcard = async (req: Request, res: Response) => {
        const userId = req.user?.id!;
        console.log(userId);
        const flashcard = await FlashCardService.createFlashcard(req.body, userId);
        return res.status(200).json(new ApiResponse(SuccessMessage.CREATE_FLASHCARD_SUCCESS, flashcard));
    }

    // Hàm cập nhật flashcard
    public updateFlashcard = async (req: Request, res: Response) => {
        const userId = req.user?.id!;
        const flashcardId = req.params.id;
        const flashcard = await FlashCardService.updateFlashcard(flashcardId, req.body, userId);
        return res.status(200).json(new ApiResponse(SuccessMessage.UPDATE_FLASHCARD_SUCCESS, flashcard));
    }

    // Hàm xóa flashcard
    public deleteFlashcard = async (req: Request, res: Response) => {
        const flascardId = req.params.id;
        await FlashCardService.deleteFlashcard(flascardId);
        return res.status(200).json(new ApiResponse(SuccessMessage.DELETE_USER_SUCCESS));
    }

    // Hàm lấy flashcard theo category
    public getFlashcardByCategory = async (req: Request, res: Response) => {
        const cateId = req.params.cateId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;

        const result = await FlashCardService.getFlashcardByCategoryId(cateId, page, limit);

        return res.status(200).json(new ApiResponse("Success", result));
    }

    public getAllFlashcard = async (req: Request, res: Response) => {
        const userId = req.user?.id!;
        console.log(userId);
        const result = await FlashCardService.getAllFlashcard(userId);
        return res.status(200).json(new ApiResponse("Success", result));
    }
}

export default new FlashcardController();