import omit from 'lodash/omit.js';
import { ApiError } from '~/middleware/apiError.js';
import {
    CategoryFlashcard,
    CategoryFlashcardType,
} from '../models/categoryFlashcardModel.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { Flashcard } from '~/models/flashcardModel.js';
import mongoose from 'mongoose';

class CategoryFlashcardService {
    async createCategory(cate: Partial<CategoryFlashcardType>, userId: string) {
        const category = await CategoryFlashcard.create({
            ...cate,
            createBy: userId,
        });
        return omit(category.toObject(), ['__v']);
    }

    async getCategories(userId: string) {
        const categories = await CategoryFlashcard.find({
            createBy: userId,
        })
            .lean()
            .select('-__v');
        const categoriesWithCount = await Promise.all(
            categories.map(async (category: unknown) => {
                const c = category as unknown as CategoryFlashcardType & {
                    [k: string]: unknown;
                };
                const flashcardCount = await Flashcard.countDocuments({
                    category: c._id,
                    createBy: userId,
                });
                return { ...c, flashcardCount };
            })
        );

        return categoriesWithCount;
    }

    async getCategoryById(id: string, userId: string) {
        const category = await CategoryFlashcard.findOne({
            _id: id,
            createBy: userId,
        })
            .lean()
            .select('-__v');
        if (!category) throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
        return category;
    }

    async updateCategory(
        id: string,
        data: Partial<CategoryFlashcardType>,
        userId: string
    ) {
        const category = await CategoryFlashcard.findOneAndUpdate(
            { _id: id, createBy: userId },
            data,
            { new: true }
        ).select('-__v');

        if (!category) {
            throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
        }

        return category;
    }

    async deleteCategory(id: string, userId: string) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const category = await CategoryFlashcard.findOne({
                _id: id,
                createBy: userId,
            }).session(session);

            if (!category) {
                throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
            }

            if (category.is_default) {
                throw new ApiError(ErrorMessage.CATEGORY_CANNOT_DELETE_DEFAULT);
            }

            await CategoryFlashcard.findOneAndDelete({
                _id: id,
                createBy: userId,
            }).session(session);

            /* xoa flashcard thuoc category nay */
            await Flashcard.deleteMany({
                category: id,
                createBy: userId,
            }).session(session);

            await session.commitTransaction();
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }
}

export default CategoryFlashcardService;
