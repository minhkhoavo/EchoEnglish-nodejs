import { ErrorMessage } from '~/enum/errorMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import { CategoryFlashcard } from '~/models/categoryFlashcardModel.js';
import { Flashcard, FlashcardType } from '~/models/flashcardModel.js';
import { Types } from 'mongoose';
import { PaginationHelper } from '~/utils/pagination.js';
import omit from 'lodash/omit.js';
import spacedRepetitionService, {
    ReviewResult,
} from './spacedRepetitionService.js';

class FlashCardService {
    public createFlashcard = async (
        request: Partial<FlashcardType>,
        userId: string
    ) => {
        if (!userId) {
            throw new ApiError({ message: 'User ID is required' });
        }
        let categoryId = request.category;
        if (!categoryId) {
            const defaultCategory = await CategoryFlashcard.findOne({
                createBy: userId,
                is_default: true,
            });
            if (defaultCategory) {
                categoryId = defaultCategory._id;
            } else {
                // Create default "Uncategorized" category for new users
                const newDefaultCategory = new CategoryFlashcard({
                    name: 'Uncategorized',
                    description: 'Default category for flashcards',
                    color: '#6B7280',
                    is_default: true,
                    createBy: userId,
                });
                const savedCategory = await newDefaultCategory.save();
                categoryId = savedCategory._id;
            }
        }
        // Set nextReviewDate to now so new cards are immediately available for review
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        const newFlashcard = new Flashcard({
            front: request.front,
            back: request.back,
            category: categoryId,
            difficulty: request.difficulty,
            tags: request.tags || [],
            source: request.source || '',
            phonetic: request.phonetic || '',
            isAIGenerated: request.isAIGenerated ?? false,
            level_memory: 0,
            nextReviewDate: now,
            reviewCount: 0,
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
        const results = [];

        for (const update of updates) {
            const flashcard = await Flashcard.findOneAndUpdate(
                { _id: update.id, createBy: userId },
                update.data,
                { new: true }
            ).select('-__v -createBy');

            if (!flashcard) {
                throw new ApiError({
                    message: `Flashcard with ID ${update.id} not found`,
                });
            }

            results.push(flashcard);
        }

        return results;
    };

    public bulkCreateFlashcards = async (
        flashcards: Array<
            Partial<FlashcardType & { category?: string | Types.ObjectId }>
        >,
        userId: string
    ) => {
        if (!userId) {
            throw new ApiError({ message: 'User ID is required' });
        }

        // Get default category if needed
        let defaultCategoryId: string | undefined;

        const results = [];

        for (const flashcardData of flashcards) {
            let categoryId: string | Types.ObjectId | undefined =
                flashcardData.category;

            if (!categoryId) {
                if (!defaultCategoryId) {
                    const defaultCategory = await CategoryFlashcard.findOne({
                        createBy: userId,
                        is_default: true,
                    });

                    if (!defaultCategory) {
                        // Create default "Uncategorized" category for new users
                        const newDefaultCategory = new CategoryFlashcard({
                            name: 'Uncategorized',
                            description: 'Default category for flashcards',
                            color: '#6B7280',
                            is_default: true,
                            createBy: userId,
                        });
                        const savedCategory = await newDefaultCategory.save();
                        defaultCategoryId = savedCategory._id.toString();
                    } else {
                        defaultCategoryId = defaultCategory._id.toString();
                    }
                }
                categoryId = defaultCategoryId;
            }

            // Set nextReviewDate to now so new cards are immediately available for review
            const now = new Date();
            now.setHours(0, 0, 0, 0);

            const newFlashcard = new Flashcard({
                front: flashcardData.front,
                back: flashcardData.back,
                category: categoryId,
                difficulty: flashcardData.difficulty,
                tags: flashcardData.tags || [],
                source: flashcardData.source || '',
                phonetic: flashcardData.phonetic || '',
                isAIGenerated: flashcardData.isAIGenerated ?? true,
                level_memory: 0,
                nextReviewDate: now,
                reviewCount: 0,
                createBy: userId,
            });

            const savedFlashcard = await newFlashcard.save();
            results.push(omit(savedFlashcard.toObject(), ['__v', 'createBy']));
        }

        return results;
    };

    // ============ Spaced Repetition Methods ============

    /**
     * Get flashcards that are due for review
     * @param userId - User ID
     * @param limit - Maximum number of cards to return
     * @param categoryId - Optional: filter by category
     */
    public getFlashcardsForReview = async (
        userId: string,
        limit: number = 20,
        categoryId?: string
    ) => {
        const query: { createBy: string; category?: string } = {
            createBy: userId,
        };

        if (categoryId) {
            query.category = categoryId;
        }

        // Get all flashcards and filter by due date
        const flashcards = await Flashcard.find(query)
            .populate('category', 'name description color')
            .select('-__v -createBy')
            .sort({ nextReviewDate: 1, level_memory: 1 })
            .limit(limit * 2); // Get more than needed, then filter

        // Filter to only cards that are due
        const dueCards = flashcards.filter((card) =>
            spacedRepetitionService.isDueForReview(card.nextReviewDate)
        );

        // Return up to limit
        return dueCards.slice(0, limit);
    };

    /**
     * Update flashcard after review
     * @param flashcardId - Flashcard ID
     * @param userId - User ID
     * @param reviewResult - User's performance result
     */
    public updateReviewResult = async (
        flashcardId: string,
        userId: string,
        reviewResult: ReviewResult
    ) => {
        const flashcard = await Flashcard.findOne({
            _id: flashcardId,
            createBy: userId,
        });

        if (!flashcard) {
            throw new ApiError(ErrorMessage.FLASHCARD_NOT_FOUND);
        }

        // Calculate next review schedule
        const currentLevel = flashcard.level_memory || 0;
        const schedule = spacedRepetitionService.calculateNextReview(
            currentLevel,
            reviewResult
        );

        // Update flashcard
        flashcard.level_memory = schedule.level_memory;
        flashcard.nextReviewDate = schedule.nextReviewDate;
        flashcard.lastReviewDate = new Date();
        flashcard.reviewCount = (flashcard.reviewCount || 0) + 1;

        await flashcard.save();

        return omit(flashcard.toObject(), ['__v', 'createBy']);
    };

    /**
     * Get review statistics for user's flashcards
     * @param userId - User ID
     * @param categoryId - Optional: filter by category
     */
    public getReviewStatistics = async (
        userId: string,
        categoryId?: string
    ) => {
        const query: { createBy: string; category?: string } = {
            createBy: userId,
        };
        if (categoryId) {
            query.category = categoryId;
        }

        // Get all user's categories to validate flashcards belong to existing categories
        const validCategories = await CategoryFlashcard.find({
            createBy: userId,
        }).select('_id');
        const validCategoryIds = validCategories.map((c) => c._id.toString());

        const flashcards = await Flashcard.find(query)
            .select('level_memory nextReviewDate category')
            .lean();

        // Filter out flashcards with deleted/invalid categories
        const validFlashcards = flashcards.filter((card) =>
            validCategoryIds.includes(card.category.toString())
        ) as Array<{ level_memory?: number; nextReviewDate?: Date }>;

        const stats =
            spacedRepetitionService.calculateProgress(validFlashcards);

        return {
            ...stats,
            recommendedDaily: spacedRepetitionService.getRecommendedDailyLimit(
                stats.dueForReview
            ), // Number of cards to review today
        };
    };

    /**
     * Reset all flashcards' review progress (for testing or user request)
     * @param userId - User ID
     */
    public resetAllReviews = async (userId: string) => {
        const result = await Flashcard.updateMany(
            { createBy: userId },
            {
                $set: {
                    level_memory: 0,
                    nextReviewDate: new Date(),
                    lastReviewDate: undefined,
                    reviewCount: 0,
                },
            }
        );

        return { modifiedCount: result.modifiedCount };
    };

    /**
     * Bulk delete flashcards by IDs
     * @param flashcardIds - Array of flashcard IDs to delete
     * @param userId - User ID (for authorization)
     */
    public bulkDeleteFlashcards = async (
        flashcardIds: string[],
        userId: string
    ) => {
        if (!userId) {
            throw new ApiError({ message: 'User ID is required' });
        }

        if (!Array.isArray(flashcardIds) || flashcardIds.length === 0) {
            throw new ApiError({
                message: 'Flashcard IDs array is required and cannot be empty',
            });
        }

        // Delete only flashcards that belong to the user
        const result = await Flashcard.deleteMany({
            _id: { $in: flashcardIds },
            createBy: userId,
        });

        return {
            deletedCount: result.deletedCount,
            requestedCount: flashcardIds.length,
        };
    };
}

export default new FlashCardService();
