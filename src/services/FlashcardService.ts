import { error } from "console";
import { Types } from "mongoose";
import { ErrorMessage } from "~/enum/error_message";
import { Flashcard, FlashcardType } from "~/models/flashcard.model";

class FlashCardService {
    // Hàm tạo flashcard
    public createFlashcard = async(request: Partial<FlashcardType>, userEmail: string) => {
        try {
            const newFlashcard = new Flashcard({
                front: request.front,
                back: request.back,
                category: request.category,
                difficulty: request.difficulty,
                tags: request.tags || [],
                source: request.source || "",
                isAIGenerated: request.isAIGenerated ?? false,
            });

            (newFlashcard as any)._userEmail = userEmail;

            return newFlashcard.save();
        }
        catch (err: any) {
            throw new Error(ErrorMessage.CREATE_FLASHCARD_FAIL);
        }
    }

    // Hàm cập nhật thông tin flashcard
    public updateFlashcard = async (flascardId: string, request: Partial<FlashcardType>, userEmail: string) => {
        try {
            const flashcard = await Flashcard.findOneAndUpdate({_id: flascardId, isDeleted: false},request,{new: true, userEmail: userEmail}).select("-isDeleted -createBy -updateBy -__v");
            if(!flashcard)
                throw new Error(ErrorMessage.FLASHCARD_NOT_FOUND);
            return flashcard;
        }
        catch (err: any) {
            throw new Error(ErrorMessage.UPDATE_FLASHCARD_FAIL);
        }
    }

    // Hàm xóa flashcard
    public softDeleteFlashcard = async (flashcardId: string, userEmail: string) => {
        try{
            const flashcard = await Flashcard.findByIdAndUpdate(flashcardId, {isDeleted: true}, {new: true, userEmail: userEmail});
            if(!flashcard)
                throw new Error(ErrorMessage.FLASHCARD_NOT_FOUND);
        }
        catch(err: any){
            throw new Error(ErrorMessage.DELETE_FLASHCARD_FAIL);
        }
    }

    // Hàm lấy flashcard theo category_id
    public getFlashcardByCategoryId = async (cateId: string, page: number, limit: number) => {
        try {
            if (!Types.ObjectId.isValid(cateId)) {
                throw new Error(ErrorMessage.INVALID_CATEGORY_ID);
            }

            const skip = (page - 1) * limit;

            const [flashcards, total] = await Promise.all([
                Flashcard.find({ category: cateId })
                    .populate("category", "name description")
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                Flashcard.countDocuments({ category: cateId })
            ]);

            return {
                flashcards,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                },
            };
        } 
        catch (err: any) {
            throw new Error(ErrorMessage.INVALID_CATEGORY_ID);
        }
    };
}

export default new FlashCardService();