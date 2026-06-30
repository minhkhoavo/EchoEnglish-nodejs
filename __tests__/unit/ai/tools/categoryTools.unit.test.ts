/* eslint-disable @typescript-eslint/no-explicit-any */
import CategoryFlashcardService from '~/services/categoryFlashcardService.js';

// Setup prototype mocks before importing the tools because it instantiates at top level
const createCategorySpy = jest
    .spyOn(CategoryFlashcardService.prototype, 'createCategory')
    .mockImplementation();
const getCategoryByIdSpy = jest
    .spyOn(CategoryFlashcardService.prototype, 'getCategoryById')
    .mockImplementation();
const updateCategorySpy = jest
    .spyOn(CategoryFlashcardService.prototype, 'updateCategory')
    .mockImplementation();
const deleteCategorySpy = jest
    .spyOn(CategoryFlashcardService.prototype, 'deleteCategory')
    .mockImplementation();
const getCategoriesSpy = jest
    .spyOn(CategoryFlashcardService.prototype, 'getCategories')
    .mockImplementation();

import { categoryTools } from '~/ai/tools/categoryTools.js';

describe('categoryTools', () => {
    const [
        createCategoryTool,
        getCategoryTool,
        updateCategoryTool,
        deleteCategoryTool,
        listCategoriesTool,
    ] = categoryTools as any[];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('createCategoryTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(
                createCategoryTool.invoke({ name: 'test' }, {})
            ).rejects.toThrow('userId required');
        });

        it('should create category and return ID', async () => {
            createCategorySpy.mockResolvedValue({ _id: 'cat-123' } as any);

            const result = await createCategoryTool.invoke(
                { name: 'test', description: 'desc' },
                { configurable: { userId: 'user-1' } }
            );

            expect(createCategorySpy).toHaveBeenCalledWith(
                { name: 'test', description: 'desc' },
                'user-1'
            );
            expect(result).toBe('Category ID: cat-123');
        });
    });

    describe('getCategoryTool', () => {
        it('should throw Error if id or userId is missing', async () => {
            await expect(
                getCategoryTool.invoke({ id: 'cat-1' }, {})
            ).rejects.toThrow('categoryId & userId required');

            await expect(
                getCategoryTool.invoke(
                    { id: '' },
                    { configurable: { userId: 'user-1' } }
                )
            ).rejects.toThrow('categoryId & userId required');
        });

        it('should get category and return stringified JSON', async () => {
            const mockCat = { _id: 'cat-1', name: 'test' };
            getCategoryByIdSpy.mockResolvedValue(mockCat as any);

            const result = await getCategoryTool.invoke(
                { id: 'cat-1' },
                { configurable: { userId: 'user-1' } }
            );

            expect(getCategoryByIdSpy).toHaveBeenCalledWith('cat-1', 'user-1');
            expect(result).toBe(JSON.stringify(mockCat));
        });
    });

    describe('updateCategoryTool', () => {
        it('should throw Error if id or userId is missing', async () => {
            await expect(
                updateCategoryTool.invoke({ id: 'cat-1' }, {})
            ).rejects.toThrow('categoryId & userId required');
        });

        it('should update category and return stringified JSON', async () => {
            const mockCat = { _id: 'cat-1', name: 'new-name' };
            updateCategorySpy.mockResolvedValue(mockCat as any);

            const result = await updateCategoryTool.invoke(
                { id: 'cat-1', name: 'new-name', description: 'desc' },
                { configurable: { userId: 'user-1' } }
            );

            expect(updateCategorySpy).toHaveBeenCalledWith(
                'cat-1',
                { name: 'new-name', description: 'desc' },
                'user-1'
            );
            expect(result).toBe(`Updated: ${JSON.stringify(mockCat)}`);
        });
    });

    describe('deleteCategoryTool', () => {
        it('should throw Error if id or userId is missing', async () => {
            await expect(
                deleteCategoryTool.invoke({ id: 'cat-1' }, {})
            ).rejects.toThrow('categoryId & userId required');
        });

        it('should delete category and return success message', async () => {
            deleteCategorySpy.mockResolvedValue(true as any);

            const result = await deleteCategoryTool.invoke(
                { id: 'cat-1' },
                { configurable: { userId: 'user-1' } }
            );

            expect(deleteCategorySpy).toHaveBeenCalledWith('cat-1', 'user-1');
            expect(result).toBe('Deleted cat-1');
        });
    });

    describe('listCategoriesTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(listCategoriesTool.invoke({}, {})).rejects.toThrow(
                'userId required'
            );
        });

        it('should list categories and return stringified JSON', async () => {
            const mockCats = [{ _id: 'cat-1' }, { _id: 'cat-2' }];
            getCategoriesSpy.mockResolvedValue(mockCats as any);

            const result = await listCategoriesTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );

            expect(getCategoriesSpy).toHaveBeenCalledWith('user-1');
            expect(result).toBe(JSON.stringify(mockCats));
        });
    });
});
