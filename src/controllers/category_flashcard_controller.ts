import ApiResponse from "~/dto/response/api_response";
import { CategoryFlashcard } from "../models/category_flashcard_model";
import {Request, Response} from 'express';
import CategoryFlashcardService from "~/services/category_flashcard_service";
import { SuccessMessage } from "~/enum/success_message";

class CategoryFlashcardController{
    public categoryService = new CategoryFlashcardService();

    public createCategory = async (req: Request, res: Response) => {
        const category = await this.categoryService.createCategory(req.body);
        res.status(201).json(new ApiResponse("success", category));
    };

    public getCategories = async (req: Request, res: Response) => {
        const categories = await this.categoryService.getCategories();
        res.json(new ApiResponse('success', categories));
    };

    public getCategoryById = async (req: Request, res: Response) => {
        const category = await this.categoryService.getCategoryById(req.params.id);
        res.json(category);
    };

    public updateCategory = async (req: Request, res: Response) => {
        const category = await this.categoryService.updateCategory(req.params.id, req.body);
        res.json(new ApiResponse('Success', category))
    };

    public deleteCategory = async (req: Request, res: Response) => {
        const category = await this.categoryService.deleteCategory(req.params.id);
        res.json(new ApiResponse(SuccessMessage.DELETE_CATEGORY_SUCCESS, category));
    }
}

export default CategoryFlashcardController;