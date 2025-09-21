import ApiResponse from "~/dto/response/apiResponse";
import { CategoryFlashcard } from "../models/categoryFlashcardModel";
import {Request, Response} from 'express';
import CategoryFlashcardService from "~/services/categoryFlashcardService";
import { SuccessMessage } from "~/enum/successMessage";

class CategoryFlashcardController{
    public categoryService = new CategoryFlashcardService();

    public createCategory = async (req: Request, res: Response) => {
        const userId = req.user?.id!;
        const category = await this.categoryService.createCategory(req.body, userId);
        res.status(201).json(new ApiResponse("success", category));
    };

    public getCategories = async (req: Request, res: Response) => {
        const userId = req.user?.id!;
        const categories = await this.categoryService.getCategories(userId);
        res.json(new ApiResponse('success', categories));
    };

    public getCategoryById = async (req: Request, res: Response) => {
        const userId = req.user?.id!;
        const category = await this.categoryService.getCategoryById(req.params.id, userId);
        res.json(category);
    };

    public updateCategory = async (req: Request, res: Response) => {
        const userId = req.user?.id!;
        const category = await this.categoryService.updateCategory(req.params.id, req.body, userId);
        res.json(new ApiResponse('Success', category))
    };

    public deleteCategory = async (req: Request, res: Response) => {
        const userId = req.user?.id!;
        const category = await this.categoryService.deleteCategory(req.params.id, userId);
        res.json(new ApiResponse(SuccessMessage.DELETE_CATEGORY_SUCCESS, category));
    }
}

export default CategoryFlashcardController;