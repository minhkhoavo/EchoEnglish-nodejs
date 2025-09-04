import { ApiError } from '~/middleware/api_error';
import { CategoryFlashcard,CategoryFlashcardType } from './../models/category_flashcard.model';
import { ErrorMessage } from "~/enum/error_message";


class CategoryFlashcardService{
    async createCategory (cate: any){
        const category = await CategoryFlashcard.create(cate);
            return category;
    }

    async getCategories() {
        return CategoryFlashcard.find({ isDeleted: false }).lean();
    }

    async getCategoryById(id: string) {
        const category =await CategoryFlashcard.findOne({ _id: id, isDeleted: false }).lean();
        if(!category)
            throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
        return category;
    }

    async updateCategory(id: string, data: Partial<CategoryFlashcardType>) {
        const category =  CategoryFlashcard.findOneAndUpdate(
            { _id: id, isDeleted: false },
            data,
            { new: true }
        );

        if(!category){
            throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
        }

        return category;
    }

    async deleteCategory(id: string) {
        return CategoryFlashcard.findByIdAndUpdate(
            id,
            { isDeleted: true },
            { new: true }
        );
    }
}

export default CategoryFlashcardService;