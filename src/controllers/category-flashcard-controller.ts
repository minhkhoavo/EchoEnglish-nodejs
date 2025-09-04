import ApiResponse from "~/dto/response/ApiResponse";
import { CategoryFlashcard } from "../models/category_flashcard.model";
import {Request, Response} from 'express';
import CategoryFlashcardService from "~/services/category-flashcard-service";

class CategoryFlashcardController{
    public categoryService = new CategoryFlashcardService();

    public createCategory = async (req: Request, res: Response) => {
        try {
            const category = await this.categoryService.createCategory(req.body);
            res.status(201).json(new ApiResponse("success", category));
        } catch (err: any) {
            res.status(400).json(new ApiResponse(err.message));
        }
    };

    // Read all
    public getCategories = async (req: Request, res: Response) => {
        try {
            const categories = await this.categoryService.getCategories();
            res.json(new ApiResponse('success', categories));
        } catch (err: any) {
            res.status(500).json(new ApiResponse(err.message));
        }
    };

    // Read one
    public getCategoryById = async (req: Request, res: Response) => {
        try {
            const category = await this.categoryService.getCategoryById(req.params.id);
            res.json(category);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    };

    // Update
    public updateCategory = async (req: Request, res: Response) => {
        try {
            const category = await this.categoryService.updateCategory(req.params.id, req.body);
            res.json(new ApiResponse('Success', category))
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    };

    // Delete
    public deleteCategory = async (req: Request, res: Response) => {
        try {
            // Cập nhật isDeleted thành true
            await this.categoryService.deleteCategory(req.params.id);
            res.json(new ApiResponse('Success'));
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    }
}

export default CategoryFlashcardController;