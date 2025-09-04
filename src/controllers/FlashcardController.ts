import { Flashcard } from './../models/flashcard.model';
import {Request, Response} from 'express';
import ApiResponse from '~/dto/response/ApiResponse';
import { ErrorMessage } from '~/enum/error_message';
import { SuccessMessage } from '~/enum/success_message';
import FlashCardService from '~/services/FlashCardService';
class FlashcardController{
    // Hàm tạo flashcard
    public createFlashcard = async (req: Request, res: Response) => {
        const userEmail = req.user?.email!;
        console.log(userEmail);
        const flashcard = await FlashCardService.createFlashcard(req.body, userEmail);
        return res.status(200).json(new ApiResponse(SuccessMessage.CREATE_FLASHCARD_SUCCESS, flashcard));
    }

    // Hàm cập nhật flashcard
    public updateFlashcard = async (req: Request, res: Response) => {
         const userEmail = req.user?.email!;
        const flashcardId = req.params.id;
        const flashcard = await FlashCardService.updateFlashcard(flashcardId, req.body, userEmail);
        return res.status(200).json(new ApiResponse(SuccessMessage.UPDATE_FLASHCARD_SUCCESS, flashcard));
    }

    // Hàm xóa flashcard
    public deleteFlashcard = async (req: Request, res: Response) => {
         const userEmail = req.user?.email!;
        const flascardId = req.params.id;
        await FlashCardService.softDeleteFlashcard(flascardId, userEmail);
        return res.status(200).json(new ApiResponse(SuccessMessage.DELETE_USER_SUCCESS));
    }

    // Hàm lấy flashcard theo category
    public getFlashcardByCategory = async (req: Request, res: Response) => {
        try {
            const cateId = req.params.cateId;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            const result = await FlashCardService.getFlashcardByCategoryId(cateId, page, limit);

            if (!result.flashcards || result.flashcards.length === 0) {
                return res.status(404).json(new ApiResponse(ErrorMessage.FLASHCARD_NOT_FOUND));
            }

            return res.status(200).json(new ApiResponse("Success", result));
        } 
        catch (error: any) {
            return res.status(400).json(new ApiResponse(error.message || "ERROR_GET_FLASHCARDS"));
        }
    }
}

export default new FlashcardController();