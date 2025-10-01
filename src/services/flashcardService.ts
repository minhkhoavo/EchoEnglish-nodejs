import { ErrorMessage } from '~/enum/errorMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import { CategoryFlashcard } from '~/models/categoryFlashcardModel.js';
import { Flashcard, FlashcardType } from '~/models/flashcardModel.js';
import { Types } from 'mongoose';
import { PaginationHelper } from '~/utils/pagination.js';
import omit from 'lodash/omit.js';

class FlashCardService {
    public createFlashcard = async (
        request: Partial<FlashcardType>,
        userId: string
    ) => {
        let categoryId = request.category;
        if (!categoryId) {
            const defaultCategory = await CategoryFlashcard.findOne({
                createBy: userId,
                is_default: true,
            });
            if (defaultCategory) {
                categoryId = defaultCategory._id;
            } else {
                throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
            }
        }
        const newFlashcard = new Flashcard({
            front: request.front,
            back: request.back,
            category: categoryId,
            difficulty: request.difficulty,
            tags: request.tags || [],
            source: request.source || '',
            isAIGenerated: request.isAIGenerated ?? false,
            createBy: userId,
        });

        const flashcardSaved = await newFlashcard.save();

        return omit(flashcardSaved.toObject(), ['__v', 'createBy']);
    };

    public updateFlashcard = async (
        flascardId: string,
        request: Partial<FlashcardType>,
        userId: string
    ) => {
        const flashcard = await Flashcard.findOneAndUpdate(
            { _id: flascardId, createBy: userId },
            request,
            {
                new: true,
            }
        ).select('-__v -createBy');
        if (!flashcard) throw new ApiError(ErrorMessage.FLASHCARD_NOT_FOUND);
        return flashcard;
    };

    public deleteFlashcard = async (flashcardId: string, userId: string) => {
        const result = await Flashcard.deleteOne({
            _id: flashcardId,
            createBy: userId,
        });

        if (result.deletedCount === 0) {
            throw new ApiError(ErrorMessage.FLASHCARD_NOT_FOUND);
        }
    };

    public getFlashcardById = async (id: string, userId: string) => {
        try {
            const flashcard = await Flashcard.findOne({
                _id: id,
                createBy: userId,
            }).select('-isDeleted -createBy -updateBy -__v');
            if (!flashcard) {
                throw new ApiError(ErrorMessage.FLASHCARD_NOT_FOUND);
            }
            return flashcard;
        } catch (err: unknown) {
            if (err instanceof ApiError) throw err;
            throw new ApiError({ message: 'Unknown error occurred' });
        }
    };

    public getFlashcardByCategoryId = async (
        cateId: string,
        userId: string,
        page: number,
        limit: number
    ) => {
        const category = await CategoryFlashcard.findOne({
            _id: cateId,
            createBy: userId,
        });
        if (!category) {
            throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
        }

        const result = await PaginationHelper.paginate(
            Flashcard,
            { category: cateId, createBy: userId },
            { page, limit },
            { path: 'category', select: 'name description' },
            '-__v -createBy',
            { createdAt: -1 }
        );

        return {
            flashcards: result.data,
            pagination: result.pagination,
        };
    };

    public getAllFlashcard = async (
        userId: string,
        page?: number,
        limit?: number
    ) => {
        if (page && limit) {
            const result = await PaginationHelper.paginate(
                Flashcard,
                { createBy: userId },
                { page, limit },
                undefined,
                undefined,
                { createdAt: -1 }
            );

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
            const flashcards = await Flashcard.find({
                createBy: userId,
            })
                .select('-createBy -__v')
                .sort({ createdAt: -1 });

            if (!flashcards || flashcards.length === 0) {
                throw new ApiError(ErrorMessage.FLASHCARD_NOT_FOUND);
            }

            return flashcards;
        }
    };

    public getAllFlashcardBySource = async (source: string, userId: string) => {
        const query = {
            createBy: userId,
            source: source,
        };

        const flashcards = await Flashcard.find(query)
            .populate('category', 'name description')
            .select('-createBy -__v')
            .sort({ createdAt: -1 });

        return flashcards;
    };

    public bulkUpdateFlashcards = async (
        updates: Array<{
            id: string;
            data: Partial<
                FlashcardType & { category?: string | Types.ObjectId }
            >;
        }>,
        userId: string
    ) => {
        const session = await Flashcard.startSession();
        session.startTransaction();

        try {
            const results = [];

            for (const update of updates) {
                const flashcard = await Flashcard.findOneAndUpdate(
                    { _id: update.id, createBy: userId },
                    update.data,
                    { new: true, session }
                ).select('-__v -createBy');

                if (!flashcard) {
                    throw new ApiError({
                        message: `Flashcard with ID ${update.id} not found`,
                    });
                }

                results.push(flashcard);
            }

            await session.commitTransaction();
            return results;
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    };

    public bulkCreateFlashcards = async (
        flashcards: Array<
            Partial<FlashcardType & { category?: string | Types.ObjectId }>
        >,
        userId: string
    ) => {
        const session = await Flashcard.startSession();
        session.startTransaction();

        try {
            // Get default category if needed
            let defaultCategoryId: string | undefined;

            const results = [];

            for (const flashcardData of flashcards) {
                let categoryId: string | Types.ObjectId | undefined =
                    flashcardData.category;

                if (!categoryId) {
                    if (!defaultCategoryId) {
                        const defaultCategory = await CategoryFlashcard.findOne(
                            {
                                createBy: userId,
                                is_default: true,
                            }
                        ).session(session);

                        if (!defaultCategory) {
                            throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
                        }
                        defaultCategoryId = defaultCategory._id.toString();
                    }
                    categoryId = defaultCategoryId;
                }

                const newFlashcard = new Flashcard({
                    front: flashcardData.front,
                    back: flashcardData.back,
                    category: categoryId,
                    difficulty: flashcardData.difficulty,
                    tags: flashcardData.tags || [],
                    source: flashcardData.source || '',
                    isAIGenerated: flashcardData.isAIGenerated ?? true,
                    createBy: userId,
                });

                const savedFlashcard = await newFlashcard.save({ session });
                results.push(
                    omit(savedFlashcard.toObject(), ['__v', 'createBy'])
                );
            }

            await session.commitTransaction();
            return results;
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    };
}

export default new FlashCardService();
