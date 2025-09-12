import { error } from 'console';
import { Types } from 'mongoose';
import { throwDeprecation } from 'process';
import { ErrorMessage } from '~/enum/errorMessage';
import { ApiError } from '~/middleware/apiError';
import { CategoryFlashcard } from '~/models/categoryFlashcardModel';
import { Flashcard, FlashcardType } from '~/models/flashcardModel';
import { User } from '~/models/userModel';
import { PaginationHelper } from '~/utils/pagination';

class FlashCardService {
    public createFlashcard = async (request: Partial<FlashcardType>, userId: string) => {
        try {
            const newFlashcard = new Flashcard({
                front: request.front,
                back: request.back,
                category: request.category,
                difficulty: request.difficulty,
                tags: request.tags || [],
                source: request.source || '',
                isAIGenerated: request.isAIGenerated ?? false,
                createBy: userId,
            });
            return newFlashcard.save();
        } catch (err: any) {
            throw new ApiError(ErrorMessage.CREATE_FLASHCARD_FAIL);
        }
    };

    public updateFlashcard = async (flascardId: string, request: Partial<FlashcardType>, userId: string) => {
        try {
            const flashcard = await Flashcard.findOneAndUpdate({ _id: flascardId, createBy: userId }, request, {
                new: true,
            }).select('-isDeleted -createBy -updateBy -__v');
            if (!flashcard) throw new ApiError(ErrorMessage.FLASHCARD_NOT_FOUND);
            return flashcard;
        } catch (err: any) {
            console.log(err.message);
            throw new ApiError(ErrorMessage.UPDATE_FLASHCARD_FAIL);
        }
    };

    public deleteFlashcard = async (flashcardId: string, userId: string) => {
        try {
            const result = await Flashcard.deleteOne({ _id: flashcardId, createBy: userId });

            if (result.deletedCount === 0) {
                throw new ApiError(ErrorMessage.FLASHCARD_NOT_FOUND);
            }
        } catch (err: any) {
            throw new ApiError(ErrorMessage.DELETE_FLASHCARD_FAIL);
        }
    };

    public getFlashcardByCategoryId = async (cateId: string, userId: string, page: number, limit: number) => {
        try {
            const category = await CategoryFlashcard.findOne({ _id: cateId, createBy: userId });
            if (!category) {
                throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
            }

            const result = await PaginationHelper.paginate(
                Flashcard,
                { category: cateId, createBy: userId },
                { page, limit },
                { path: 'category', select: 'name description' }
            );

            return {
                flashcards: result.data,
                pagination: result.pagination,
            };
        } catch (err: any) {
            throw new ApiError(err);
        }
    };

    public getAllFlashcard = async (userId: string, page?: number, limit?: number) => {
        try {
            const user = await User.findOne({ _id: userId });
            if (!user) {
                throw new ApiError(ErrorMessage.USER_NOT_FOUND);
            }

            if (page && limit) {
                const result = await PaginationHelper.paginate(Flashcard, { createBy: userId }, { page, limit });

                return {
                    flashcards: result.data.map((fc) => ({
                        id: fc._id,
                        front: fc.front,
                        back: fc.back,
                        category: fc.category,
                        difficulty: fc.difficulty,
                        tags: fc.tags,
                        source: fc.source,
                        isAIGenerated: fc.isAIGenerated,
                        createdAt: fc.createdAt,
                        updatedAt: fc.updatedAt,
                    })),
                    pagination: result.pagination,
                };
            } else {
                const flashcards = await Flashcard.find({ createBy: userId }).select('-isDeleted -__v');

                if (!flashcards || flashcards.length === 0) {
                    throw new ApiError(ErrorMessage.FLASHCARD_NOT_FOUND);
                }

                return flashcards.map((fc) => ({
                    id: fc._id,
                    front: fc.front,
                    back: fc.back,
                    category: fc.category,
                    difficulty: fc.difficulty,
                    tags: fc.tags,
                    source: fc.source,
                    isAIGenerated: fc.isAIGenerated,
                    createdAt: fc.createdAt,
                    updatedAt: fc.updatedAt,
                }));
            }
        } catch (err: any) {
            throw new ApiError(err);
        }
    };
}

export default new FlashCardService();
