import { CategoryFlashcard } from './../models/category_flashcard.model';
import { ErrorMessage } from "~/enum/error_message";


class CategoryFlashcardService{
    public createCategory = async (cate: any)=>{
        try {
            const category = await CategoryFlashcard.create(cate);
            return category;
        } catch (err: any) {
            throw new Error(ErrorMessage.ERROR_INSERT);
        }
    }
}
export default CategoryFlashcardService;