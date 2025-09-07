import { ApiError } from '~/middleware/api_error';
import { CategoryFlashcard,CategoryFlashcardType } from '../models/category_flashcard_model';
import { ErrorMessage } from "~/enum/error_message";
import { Flashcard } from '~/models/flashcard_model';


class CategoryFlashcardService {
    async createCategory(cate: Partial<CategoryFlashcardType>, userId: string) {
        const category = await CategoryFlashcard.create({ ...cate, createBy: userId });
        return category;
    }

    async getCategories(userId: string) {
        const categories = await CategoryFlashcard.find({ createBy: userId }).lean();
        const categoriesWithCount = await Promise.all(
            categories.map(async (category) => {
                const flashcardCount = await Flashcard.countDocuments({ 
                    category: category._id, 
                    createBy: userId 
                });
                return {
                    ...category,
                    flashcardCount
                };
            })
        );
        
        return categoriesWithCount;
    }

    async getCategoryById(id: string, userId: string) {
        const category = await CategoryFlashcard.findOne({ _id: id, createBy: userId }).lean();
        if (!category)
            throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
        return category;
    }

    async updateCategory(id: string, data: Partial<CategoryFlashcardType>, userId: string) {
        const category = await CategoryFlashcard.findOneAndUpdate(
            { _id: id, createBy: userId },
            data,
            { new: true }
        );

        if (!category) {
            throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
        }

        return category;
    }

    async deleteCategory(id: string, userId: string) {
        const category = await CategoryFlashcard.findOneAndDelete({ _id: id, createBy: userId });

        if (!category) {
            throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
        }
        /* xoa flashcard thuoc category nay */
        await Flashcard.deleteMany({ category: id, createBy: userId });
    }
}

export default CategoryFlashcardService;