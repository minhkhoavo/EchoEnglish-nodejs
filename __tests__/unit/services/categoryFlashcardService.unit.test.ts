/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import CategoryFlashcardService from '~/services/categoryFlashcardService.js';
import { CategoryFlashcard } from '~/models/categoryFlashcardModel.js';
import { Flashcard } from '~/models/flashcardModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

// Mock mongoose models
jest.mock('~/models/categoryFlashcardModel.js');
jest.mock('~/models/flashcardModel.js');

const mockedCategoryFlashcard = CategoryFlashcard as jest.Mocked<
    typeof CategoryFlashcard
>;
const mockedFlashcard = Flashcard as jest.Mocked<typeof Flashcard>;

describe('CategoryFlashcardService', () => {
    let service: CategoryFlashcardService;
    let startSessionSpy: jest.SpyInstance;

    const mockSession = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn(),
    };

    const MOCK_USER_ID = '60f8e8b4e7c8e8b4e7c8e8b4';
    const MOCK_CATEGORY_ID = '60f8e8b4e7c8e8b4e7c8e8c1';

    beforeEach(() => {
        jest.clearAllMocks();
        service = new CategoryFlashcardService();

        // Spy on mongoose.startSession
        startSessionSpy = jest
            .spyOn(mongoose, 'startSession')
            .mockResolvedValue(mockSession as any);
    });

    afterEach(() => {
        startSessionSpy.mockRestore();
    });

    // ════════════════════════════════════════════
    // createCategory()
    // ════════════════════════════════════════════
    describe('createCategory', () => {
        it('should create and return the new category (omitting __v and createBy)', async () => {
            const inputCate = {
                name: 'Vocabulary',
                color: '#FF0000',
                icon: 'book',
            };
            const mockDbCategory = {
                _id: MOCK_CATEGORY_ID,
                name: 'Vocabulary',
                color: '#FF0000',
                icon: 'book',
                createBy: MOCK_USER_ID,
                __v: 0,
                toObject: jest.fn().mockReturnValue({
                    _id: MOCK_CATEGORY_ID,
                    name: 'Vocabulary',
                    color: '#FF0000',
                    icon: 'book',
                    createBy: MOCK_USER_ID,
                    __v: 0,
                }),
            };

            (mockedCategoryFlashcard.create as jest.Mock).mockResolvedValue(
                mockDbCategory
            );

            const result = await service.createCategory(
                inputCate,
                MOCK_USER_ID
            );

            expect(mockedCategoryFlashcard.create).toHaveBeenCalledWith({
                ...inputCate,
                createBy: MOCK_USER_ID,
            });
            expect(result).toEqual({
                _id: MOCK_CATEGORY_ID,
                name: 'Vocabulary',
                color: '#FF0000',
                icon: 'book',
            });
        });
    });

    // ════════════════════════════════════════════
    // getCategories()
    // ════════════════════════════════════════════
    describe('getCategories', () => {
        it('should fetch categories with flashcard counts', async () => {
            const mockCategories = [
                { _id: 'cat-1', name: 'Cat 1' },
                { _id: 'cat-2', name: 'Cat 2' },
            ];

            const mockFindQuery = {
                lean: jest.fn().mockReturnThis(),
                select: jest.fn().mockResolvedValue(mockCategories),
            };

            (mockedCategoryFlashcard.find as jest.Mock).mockReturnValue(
                mockFindQuery
            );
            (mockedFlashcard.countDocuments as jest.Mock)
                .mockResolvedValueOnce(5) // count for cat-1
                .mockResolvedValueOnce(12); // count for cat-2

            const result = await service.getCategories(MOCK_USER_ID);

            expect(mockedCategoryFlashcard.find).toHaveBeenCalledWith({
                createBy: MOCK_USER_ID,
            });
            expect(mockedFlashcard.countDocuments).toHaveBeenNthCalledWith(1, {
                category: 'cat-1',
                createBy: MOCK_USER_ID,
            });
            expect(mockedFlashcard.countDocuments).toHaveBeenNthCalledWith(2, {
                category: 'cat-2',
                createBy: MOCK_USER_ID,
            });
            expect(result).toEqual([
                { _id: 'cat-1', name: 'Cat 1', flashcardCount: 5 },
                { _id: 'cat-2', name: 'Cat 2', flashcardCount: 12 },
            ]);
        });
    });

    // ════════════════════════════════════════════
    // getCategoryById()
    // ════════════════════════════════════════════
    describe('getCategoryById', () => {
        it('should return the category if found', async () => {
            const mockCategory = { _id: MOCK_CATEGORY_ID, name: 'Vocabulary' };
            const mockFindOneQuery = {
                lean: jest.fn().mockReturnThis(),
                select: jest.fn().mockResolvedValue(mockCategory),
            };

            (mockedCategoryFlashcard.findOne as jest.Mock).mockReturnValue(
                mockFindOneQuery
            );

            const result = await service.getCategoryById(
                MOCK_CATEGORY_ID,
                MOCK_USER_ID
            );

            expect(mockedCategoryFlashcard.findOne).toHaveBeenCalledWith({
                _id: MOCK_CATEGORY_ID,
                createBy: MOCK_USER_ID,
            });
            expect(result).toEqual(mockCategory);
        });

        it('should throw CATEGORY_NOT_FOUND when category does not exist', async () => {
            const mockFindOneQuery = {
                lean: jest.fn().mockReturnThis(),
                select: jest.fn().mockResolvedValue(null),
            };

            (mockedCategoryFlashcard.findOne as jest.Mock).mockReturnValue(
                mockFindOneQuery
            );

            await expect(
                service.getCategoryById(MOCK_CATEGORY_ID, MOCK_USER_ID)
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                service.getCategoryById(MOCK_CATEGORY_ID, MOCK_USER_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.CATEGORY_NOT_FOUND.status,
                message: ErrorMessage.CATEGORY_NOT_FOUND.message,
            });
        });
    });

    // ════════════════════════════════════════════
    // updateCategory()
    // ════════════════════════════════════════════
    describe('updateCategory', () => {
        it('should update and return the category if found', async () => {
            const updateData = { name: 'Grammar' };
            const mockUpdatedCategory = {
                _id: MOCK_CATEGORY_ID,
                name: 'Grammar',
            };
            const mockFindOneAndUpdateQuery = {
                select: jest.fn().mockResolvedValue(mockUpdatedCategory),
            };

            (
                mockedCategoryFlashcard.findOneAndUpdate as jest.Mock
            ).mockReturnValue(mockFindOneAndUpdateQuery);

            const result = await service.updateCategory(
                MOCK_CATEGORY_ID,
                updateData,
                MOCK_USER_ID
            );

            expect(
                mockedCategoryFlashcard.findOneAndUpdate
            ).toHaveBeenCalledWith(
                { _id: MOCK_CATEGORY_ID, createBy: MOCK_USER_ID },
                updateData,
                { new: true }
            );
            expect(result).toEqual(mockUpdatedCategory);
        });

        it('should throw CATEGORY_NOT_FOUND when category does not exist to update', async () => {
            const mockFindOneAndUpdateQuery = {
                select: jest.fn().mockResolvedValue(null),
            };

            (
                mockedCategoryFlashcard.findOneAndUpdate as jest.Mock
            ).mockReturnValue(mockFindOneAndUpdateQuery);

            await expect(
                service.updateCategory(
                    MOCK_CATEGORY_ID,
                    { name: 'Grammar' },
                    MOCK_USER_ID
                )
            ).rejects.toBeInstanceOf(ApiError);
        });
    });

    // ════════════════════════════════════════════
    // deleteCategory()
    // ════════════════════════════════════════════
    describe('deleteCategory', () => {
        it('should delete the category and associated flashcards', async () => {
            const mockCategory = { _id: MOCK_CATEGORY_ID, is_default: false };

            const mockFindOneQuery = {
                session: jest.fn().mockResolvedValue(mockCategory),
            };
            const mockDeleteManyQuery = {
                session: jest.fn().mockResolvedValue({ acknowledged: true }),
            };
            const mockFindOneAndDeleteQuery = {
                session: jest.fn().mockResolvedValue(mockCategory),
            };

            (mockedCategoryFlashcard.findOne as jest.Mock).mockReturnValue(
                mockFindOneQuery
            );
            (mockedFlashcard.deleteMany as jest.Mock).mockReturnValue(
                mockDeleteManyQuery
            );
            (
                mockedCategoryFlashcard.findOneAndDelete as jest.Mock
            ).mockReturnValue(mockFindOneAndDeleteQuery);

            await service.deleteCategory(MOCK_CATEGORY_ID, MOCK_USER_ID);

            expect(mongoose.startSession).toHaveBeenCalled();
            expect(mockSession.startTransaction).toHaveBeenCalled();
            expect(mockedCategoryFlashcard.findOne).toHaveBeenCalledWith({
                _id: MOCK_CATEGORY_ID,
                createBy: MOCK_USER_ID,
            });
            expect(mockedFlashcard.deleteMany).toHaveBeenCalledWith({
                category: MOCK_CATEGORY_ID,
                createBy: MOCK_USER_ID,
            });
            expect(
                mockedCategoryFlashcard.findOneAndDelete
            ).toHaveBeenCalledWith({
                _id: MOCK_CATEGORY_ID,
                createBy: MOCK_USER_ID,
            });
            expect(mockSession.commitTransaction).toHaveBeenCalled();
            expect(mockSession.endSession).toHaveBeenCalled();
        });

        it('should throw CATEGORY_NOT_FOUND if category does not exist', async () => {
            const mockFindOneQuery = {
                session: jest.fn().mockResolvedValue(null),
            };

            (mockedCategoryFlashcard.findOne as jest.Mock).mockReturnValue(
                mockFindOneQuery
            );

            await expect(
                service.deleteCategory(MOCK_CATEGORY_ID, MOCK_USER_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.CATEGORY_NOT_FOUND.status,
            });

            expect(mockSession.abortTransaction).toHaveBeenCalled();
            expect(mockSession.endSession).toHaveBeenCalled();
        });

        it('should throw CATEGORY_CANNOT_DELETE_DEFAULT if category is default', async () => {
            const mockCategory = { _id: MOCK_CATEGORY_ID, is_default: true };
            const mockFindOneQuery = {
                session: jest.fn().mockResolvedValue(mockCategory),
            };

            (mockedCategoryFlashcard.findOne as jest.Mock).mockReturnValue(
                mockFindOneQuery
            );

            await expect(
                service.deleteCategory(MOCK_CATEGORY_ID, MOCK_USER_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.CATEGORY_CANNOT_DELETE_DEFAULT.status,
            });

            expect(mockSession.abortTransaction).toHaveBeenCalled();
            expect(mockSession.endSession).toHaveBeenCalled();
        });

        it('should abort transaction and rethrow if an error occurs during deletion', async () => {
            const mockCategory = { _id: MOCK_CATEGORY_ID, is_default: false };

            const mockFindOneQuery = {
                session: jest.fn().mockResolvedValue(mockCategory),
            };
            const mockDeleteManyQuery = {
                session: jest.fn().mockRejectedValue(new Error('DB Error')),
            };

            (mockedCategoryFlashcard.findOne as jest.Mock).mockReturnValue(
                mockFindOneQuery
            );
            (mockedFlashcard.deleteMany as jest.Mock).mockReturnValue(
                mockDeleteManyQuery
            );

            await expect(
                service.deleteCategory(MOCK_CATEGORY_ID, MOCK_USER_ID)
            ).rejects.toThrow('DB Error');

            expect(mockSession.abortTransaction).toHaveBeenCalled();
            expect(mockSession.endSession).toHaveBeenCalled();
        });
    });
});
