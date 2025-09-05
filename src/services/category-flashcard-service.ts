import { ApiError } from '~/middleware/api_error';
import { CategoryFlashcard,CategoryFlashcardType } from './../models/category_flashcard.model';
import { ErrorMessage } from "~/enum/error_message";
import { Flashcard } from '~/models/flashcard.model';


class CategoryFlashcardService{
    async createCategory (cate: Partial<CategoryFlashcardType>){
        const category = await CategoryFlashcard.create(cate);
            return category;
    }

    async getCategories() {
        return CategoryFlashcard.find().lean();
    }

    async getCategoryById(id: string) {
        const category =await CategoryFlashcard.findOne({ _id: id}).lean();
        if(!category)
            throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
        return category;
    }

    async updateCategory(id: string, data: Partial<CategoryFlashcardType>) {
        const category =await CategoryFlashcard.findOneAndUpdate(
            { _id: id},
            data,
            { new: true }
        );

        if(!category){
            throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
        }

        return category;
    }

    // Tim category chu bi xoa thi xoa
    async deleteCategory(id: string) {
        const category = await CategoryFlashcard.findByIdAndDelete(id);

        if(!category){
            throw new ApiError(ErrorMessage.CATEGORY_NOT_FOUND);
        }
        /* xoa flashcard thuoc category nay */
        await Flashcard.deleteMany({category: id});
    }
}

export default CategoryFlashcardService;