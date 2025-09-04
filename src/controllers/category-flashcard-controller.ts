import ApiResponse from "~/dto/response/ApiResponse";
import { CategoryFlashcard } from "../models/category_flashcard.model";
import {Request, Response} from 'express';
import CategoryFlashcardService from "~/services/category-flashcard-service";

class CategoryFlashcardController{
    public categoryController = new CategoryFlashcardService();

    // Create
    public createCategory = async (req: Request, res: Response) => {
        const category = await this.categoryController.createCategory(req.body);
        return res.status(200).json(new ApiResponse('success', category));
    };

    // Read all
    public getCategories = async (req: Request, res: Response) => {
        try {
            const categories = await CategoryFlashcard.find({ isDeleted: false}).lean();
            res.json(categories);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    };

    // Read one
    public getCategoryById = async (req: Request, res: Response) => {
        try {
            const category = await CategoryFlashcard.findOne({ _id: req.params.id, isDeleted: false }).lean();
            if (!category) return res.status(404).json({ error: "Category not found" });
            res.json(category);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    };

    // Update
    public updateCategory = async (req: Request, res: Response) => {
        try {
            const category = await CategoryFlashcard.findOneAndUpdate(
                { _id: req.params.id, isDeleted: false },
                req.body,
                { new: true }
            );
            if (!category) return res.status(404).json({ error: "Category not found" });
            res.json(category);
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    };

    // Delete
    public deleteCategory = async (req: Request, res: Response) => {
        try {
            // Cập nhật isDeleted thành true
            const category = await CategoryFlashcard.findByIdAndUpdate(
                req.params.id,
                { isDeleted: true },
                { new: true } // Trả về bản ghi sau khi cập nhật
            );
            if (!category) return res.status(404).json({ error: "Category not found" });
            res.json({ message: "Category deleted" });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    }
}

export default CategoryFlashcardController;