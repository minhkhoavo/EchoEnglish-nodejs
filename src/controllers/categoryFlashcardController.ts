import ApiResponse from '~/dto/response/apiResponse.js';
import { Request, Response } from 'express';
import CategoryFlashcardService from '~/services/categoryFlashcardService.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { ApiError } from '~/middleware/apiError.js';

class CategoryFlashcardController {
    public categoryService = new CategoryFlashcardService();

    public createCategory = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }
        const category = await this.categoryService.createCategory(
            req.body,
            userId
        );
        res.status(201).json(new ApiResponse('success', category));
    };

    public getCategories = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }
        const categories = await this.categoryService.getCategories(userId);
        res.json(new ApiResponse('success', categories));
    };

    public getCategoryById = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }
        const category = await this.categoryService.getCategoryById(
            req.params.id,
            userId
        );
        res.json(category);
    };

    public updateCategory = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }
        const category = await this.categoryService.updateCategory(
            req.params.id,
            req.body,
            userId
        );
        res.json(new ApiResponse('Success', category));
    };

    public deleteCategory = async (req: Request, res: Response) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }
        await this.categoryService.deleteCategory(req.params.id, userId);
        res.json(new ApiResponse(SuccessMessage.DELETE_CATEGORY_SUCCESS));
    };
}

export default new CategoryFlashcardController();
