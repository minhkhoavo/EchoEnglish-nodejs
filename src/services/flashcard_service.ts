import { ErrorMessage } from "~/enum/error_message";
import { ApiError } from "~/middleware/api_error";
import { CategoryFlashcard } from "~/models/category_flashcard_model";
import { Flashcard, FlashcardType } from "~/models/flashcard_model";
import { User } from "~/models/user_model";

class FlashCardService {
    // Hàm tạo flashcard
    public createFlashcard = async(request: Partial<FlashcardType>, userId: string) => {
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

            (newFlashcard as any)._userId = userId;

            const savedFlashcard = await newFlashcard.save();
            console.log(savedFlashcard);
            return {
                id: savedFlashcard._id,
                front: savedFlashcard.front,
                back: savedFlashcard.back,
                category: savedFlashcard.category,
                difficulty: savedFlashcard.difficulty,
                tags: savedFlashcard.tags,
                source: savedFlashcard.source,
                isAIGenerated: savedFlashcard.isAIGenerated
            }
        }
        catch (err: any) {
            throw new ApiError(ErrorMessage.CREATE_FLASHCARD_FAIL);
        }
    }

    // Hàm cập nhật thông tin flashcard
    public updateFlashcard = async (flascardId: string, request: Partial<FlashcardType>, userId: string) => {
        try {
            const flashcard = await Flashcard.findOneAndUpdate({_id: flascardId, isDeleted: false},request,{new: true, userId: userId}).select("-isDeleted -createBy -updateBy -__v");
            if(!flashcard)
                throw new ApiError(ErrorMessage.FLASHCARD_NOT_FOUND);
            return flashcard;
        }
        catch (err: any) {
            throw new ApiError(ErrorMessage.UPDATE_FLASHCARD_FAIL);
        }
    }

    // Hàm xóa flashcard
    public deleteFlashcard = async (flashcardId: string) => {
        try{
            const result = await Flashcard.deleteOne({ _id: flashcardId });

            if (result.deletedCount === 0) {
                throw new ApiError(ErrorMessage.FLASHCARD_NOT_FOUND);
            }
        }
        catch(err: any){
            throw new ApiError(ErrorMessage.DELETE_FLASHCARD_FAIL);
        }
    }

    // Hàm lấy flashcard theo category_id
    public getFlashcardByCategoryId = async (cateId: string, page: number, limit: number) => {
        const category = await CategoryFlashcard.findOne({_id: cateId});
        if(!category){
            throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
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
        
    };

    // Hàm lấy tất cả flashcard theo userId
    public getAllFlashcard = async (userId: string) => {
        const user = User.findOne({_id: userId});
        if(!user){
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        const flashcard = await Flashcard.find({ createBy: userId }).select("-isDeleted -__v");

        if (!flashcard || flashcard.length === 0) {
            throw new ApiError(ErrorMessage.FLASHCARD_NOT_FOUND);
        }

        return flashcard.map(fc => ({
            id: fc._id,
            front: fc.front,
            back: fc.back,
            category: fc.category,
            difficulty: fc.difficulty,
            tags: fc.tags,
            source: fc.source,
            isAIGenerated: fc.isAIGenerated
        }));
    }
}

export default new FlashCardService();