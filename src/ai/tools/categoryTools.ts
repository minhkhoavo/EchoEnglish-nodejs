import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import CategoryFlashcardService from '~/services/categoryFlashcardService.js';

const svc = new CategoryFlashcardService();

const createCategoryTool = tool(
    async ({ name, description }, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');
        const cat = await svc.createCategory({ name, description }, userId);
        return `Category ID: ${cat._id}`;
    },
    {
        name: 'create_category',
        description:
            'Create a category, if category does not exist or default, fill it null',
        schema: z.object({
            name: z.string(),
            description: z.string().optional(),
        }),
    }
);

const getCategoryTool = tool(
    async ({ id }, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!id || !userId) throw new Error('categoryId & userId required');
        const category = await svc.getCategoryById(id, userId);
        return JSON.stringify(category);
    },
    {
        name: 'get_category',
        description: 'Get category by id',
        schema: z.object({
            id: z.string(),
        }),
    }
);

const updateCategoryTool = tool(
    async ({ id, name, description }, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!id || !userId) throw new Error('categoryId & userId required');
        const updated = await svc.updateCategory(
            id,
            { name, description },
            userId
        );
        return `Updated: ${JSON.stringify(updated)}`;
    },
    {
        name: 'update_category',
        description: 'Update category',
        schema: z.object({
            id: z.string(),
            name: z.string().optional(),
            description: z.string().optional(),
        }),
    }
);

const deleteCategoryTool = tool(
    async ({ id }, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!id || !userId) throw new Error('categoryId & userId required');
        await svc.deleteCategory(id, userId);
        return `Deleted ${id}`;
    },
    {
        name: 'delete_category',
        description: 'Delete category',
        schema: z.object({
            id: z.string(),
        }),
    }
);

const listCategoriesTool = tool(
    async (_, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');
        const categories = await svc.getCategories(userId);
        return JSON.stringify(categories);
    },
    {
        name: 'list_categories',
        description: 'List categories',
        schema: z.object({}),
    }
);

export const categoryTools = [
    createCategoryTool,
    getCategoryTool,
    updateCategoryTool,
    deleteCategoryTool,
    listCategoriesTool,
];

export type CategoryTool = (typeof categoryTools)[number];
