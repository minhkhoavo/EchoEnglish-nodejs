/* eslint-disable @typescript-eslint/no-explicit-any */
import flashcardService from '~/services/flashcardService.js';
import { Flashcard } from '~/models/flashcardModel.js';
import { CategoryFlashcard } from '~/models/categoryFlashcardModel.js';
import { PaginationHelper } from '~/utils/pagination.js';
import spacedRepetitionService from '~/services/spacedRepetitionService.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

// Mock models and pagination helper
jest.mock('~/models/flashcardModel.js');
jest.mock('~/models/categoryFlashcardModel.js');
jest.mock('~/utils/pagination.js');

const mockedFlashcard = Flashcard as jest.Mocked<typeof Flashcard>;
const mockedCategoryFlashcard = CategoryFlashcard as jest.Mocked<
    typeof CategoryFlashcard
>;
const mockedPaginationHelper = PaginationHelper as jest.Mocked<
    typeof PaginationHelper
>;

describe('FlashCardService', () => {
    const MOCK_USER_ID = '60f8e8b4e7c8e8b4e7c8e8b4';
    const MOCK_FLASHCARD_ID = '60f8e8b4e7c8e8b4e7c8e8c1';
    const MOCK_CATEGORY_ID = '60f8e8b4e7c8e8b4e7c8e8d2';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ──────────────────────────────────────────────
    // createFlashcard()
    // ──────────────────────────────────────────────
    describe('createFlashcard', () => {
        it('should throw ApiError if userId is not provided', async () => {
            await expect(
                flashcardService.createFlashcard({}, '')
            ).rejects.toThrow('User ID is required');
        });

        it('should use default category if request does not provide one and default category exists', async () => {
            const mockDefaultCategory = {
                _id: MOCK_CATEGORY_ID,
                is_default: true,
            };
            (mockedCategoryFlashcard.findOne as jest.Mock).mockResolvedValue(
                mockDefaultCategory
            );

            const mockFlashcardDoc = {
                _id: MOCK_FLASHCARD_ID,
                front: 'hello',
                back: 'xin chào',
                category: MOCK_CATEGORY_ID,
                toObject: jest.fn().mockReturnValue({
                    _id: MOCK_FLASHCARD_ID,
                    front: 'hello',
                    back: 'xin chào',
                    category: MOCK_CATEGORY_ID,
                    __v: 0,
                    createBy: MOCK_USER_ID,
                }),
                save: jest.fn().mockReturnThis(),
            };
            (mockedFlashcard as any).mockImplementation(() => mockFlashcardDoc);

            const result = await flashcardService.createFlashcard(
                { front: 'hello', back: 'xin chào' },
                MOCK_USER_ID
            );

            expect(mockedCategoryFlashcard.findOne).toHaveBeenCalledWith({
                createBy: MOCK_USER_ID,
                is_default: true,
            });
            expect(result).toEqual({
                _id: MOCK_FLASHCARD_ID,
                front: 'hello',
                back: 'xin chào',
                category: MOCK_CATEGORY_ID,
            });
        });

        it('should create a new default category if none exists', async () => {
            (mockedCategoryFlashcard.findOne as jest.Mock).mockResolvedValue(
                null
            );

            const mockSavedCategory = { _id: 'new-default-cat-id' };
            const mockCategoryConstructorDoc = {
                _id: 'new-default-cat-id',
                save: jest.fn().mockResolvedValue(mockSavedCategory),
            };
            (mockedCategoryFlashcard as any).mockImplementation(
                () => mockCategoryConstructorDoc
            );

            const mockFlashcardDoc = {
                _id: MOCK_FLASHCARD_ID,
                toObject: jest.fn().mockReturnValue({
                    _id: MOCK_FLASHCARD_ID,
                    __v: 0,
                    createBy: MOCK_USER_ID,
                }),
                save: jest.fn().mockReturnThis(),
            };
            (mockedFlashcard as any).mockImplementation(() => mockFlashcardDoc);

            await flashcardService.createFlashcard(
                { front: 'hello' },
                MOCK_USER_ID
            );

            expect(mockedCategoryFlashcard).toHaveBeenCalledWith({
                name: 'Uncategorized',
                description: 'Default category for flashcards',
                color: '#6B7280',
                is_default: true,
                createBy: MOCK_USER_ID,
            });
            expect(mockCategoryConstructorDoc.save).toHaveBeenCalled();
        });

        it('should create flashcard with AI generated options', async () => {
            const mockFlashcardDoc = {
                _id: MOCK_FLASHCARD_ID,
                toObject: jest.fn().mockReturnValue({
                    _id: MOCK_FLASHCARD_ID,
                    __v: 0,
                    createBy: MOCK_USER_ID,
                }),
                save: jest.fn().mockReturnThis(),
            };
            (mockedFlashcard as any).mockImplementation(() => mockFlashcardDoc);

            await flashcardService.createFlashcard(
                {
                    front: 'hi',
                    category: MOCK_CATEGORY_ID as any,
                    isAIGenerated: true,
                },
                MOCK_USER_ID
            );

            expect(mockedFlashcard).toHaveBeenCalledWith(
                expect.objectContaining({
                    front: 'hi',
                    category: MOCK_CATEGORY_ID,
                    isAIGenerated: true,
                })
            );
        });
    });

    // ──────────────────────────────────────────────
    // updateFlashcard()
    // ──────────────────────────────────────────────
    describe('updateFlashcard', () => {
        it('should update and return the flashcard if found', async () => {
            const mockDoc = { _id: MOCK_FLASHCARD_ID, front: 'new-front' };
            const mockQuery = {
                select: jest.fn().mockResolvedValue(mockDoc),
            };
            (mockedFlashcard.findOneAndUpdate as jest.Mock).mockReturnValue(
                mockQuery
            );

            const result = await flashcardService.updateFlashcard(
                MOCK_FLASHCARD_ID,
                { front: 'new-front' },
                MOCK_USER_ID
            );

            expect(mockedFlashcard.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: MOCK_FLASHCARD_ID, createBy: MOCK_USER_ID },
                { front: 'new-front' },
                { new: true }
            );
            expect(result).toEqual(mockDoc);
        });

        it('should throw FLASHCARD_NOT_FOUND when flashcard does not exist', async () => {
            const mockQuery = {
                select: jest.fn().mockResolvedValue(null),
            };
            (mockedFlashcard.findOneAndUpdate as jest.Mock).mockReturnValue(
                mockQuery
            );

            await expect(
                flashcardService.updateFlashcard(
                    MOCK_FLASHCARD_ID,
                    {},
                    MOCK_USER_ID
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.FLASHCARD_NOT_FOUND.status,
            });
        });
    });

    // ──────────────────────────────────────────────
    // deleteFlashcard()
    // ──────────────────────────────────────────────
    describe('deleteFlashcard', () => {
        it('should delete the flashcard successfully', async () => {
            (mockedFlashcard.deleteOne as jest.Mock).mockResolvedValue({
                deletedCount: 1,
            });

            await expect(
                flashcardService.deleteFlashcard(
                    MOCK_FLASHCARD_ID,
                    MOCK_USER_ID
                )
            ).resolves.toBeUndefined();
            expect(mockedFlashcard.deleteOne).toHaveBeenCalledWith({
                _id: MOCK_FLASHCARD_ID,
                createBy: MOCK_USER_ID,
            });
        });

        it('should throw FLASHCARD_NOT_FOUND when deletedCount is 0', async () => {
            (mockedFlashcard.deleteOne as jest.Mock).mockResolvedValue({
                deletedCount: 0,
            });

            await expect(
                flashcardService.deleteFlashcard(
                    MOCK_FLASHCARD_ID,
                    MOCK_USER_ID
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.FLASHCARD_NOT_FOUND.status,
            });
        });
    });

    // ──────────────────────────────────────────────
    // getFlashcardById()
    // ──────────────────────────────────────────────
    describe('getFlashcardById', () => {
        it('should return flashcard if found', async () => {
            const mockDoc = { _id: MOCK_FLASHCARD_ID, front: 'hello' };
            const mockQuery = {
                select: jest.fn().mockResolvedValue(mockDoc),
            };
            (mockedFlashcard.findOne as jest.Mock).mockReturnValue(mockQuery);

            const result = await flashcardService.getFlashcardById(
                MOCK_FLASHCARD_ID,
                MOCK_USER_ID
            );

            expect(mockedFlashcard.findOne).toHaveBeenCalledWith({
                _id: MOCK_FLASHCARD_ID,
                createBy: MOCK_USER_ID,
            });
            expect(result).toEqual(mockDoc);
        });

        it('should throw FLASHCARD_NOT_FOUND if flashcard is not found', async () => {
            const mockQuery = {
                select: jest.fn().mockResolvedValue(null),
            };
            (mockedFlashcard.findOne as jest.Mock).mockReturnValue(mockQuery);

            await expect(
                flashcardService.getFlashcardById(
                    MOCK_FLASHCARD_ID,
                    MOCK_USER_ID
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.FLASHCARD_NOT_FOUND.status,
            });
        });

        it('should wrap and propagate unknown errors', async () => {
            const mockQuery = {
                select: jest.fn().mockRejectedValue(new Error('Some DB error')),
            };
            (mockedFlashcard.findOne as jest.Mock).mockReturnValue(mockQuery);

            await expect(
                flashcardService.getFlashcardById(
                    MOCK_FLASHCARD_ID,
                    MOCK_USER_ID
                )
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                flashcardService.getFlashcardById(
                    MOCK_FLASHCARD_ID,
                    MOCK_USER_ID
                )
            ).rejects.toMatchObject({
                message: 'Unknown error occurred',
            });
        });
    });

    // ──────────────────────────────────────────────
    // getFlashcardByCategoryId()
    // ──────────────────────────────────────────────
    describe('getFlashcardByCategoryId', () => {
        it('should throw CATEGORY_NOT_FOUND if category does not exist', async () => {
            (mockedCategoryFlashcard.findOne as jest.Mock).mockResolvedValue(
                null
            );

            await expect(
                flashcardService.getFlashcardByCategoryId(
                    MOCK_CATEGORY_ID,
                    MOCK_USER_ID,
                    1,
                    10
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.CATEGORY_NOT_FOUND.status,
            });
        });

        it('should paginate flashcards by category id', async () => {
            (mockedCategoryFlashcard.findOne as jest.Mock).mockResolvedValue({
                _id: MOCK_CATEGORY_ID,
            });
            mockedPaginationHelper.paginate.mockResolvedValue({
                data: [{ _id: MOCK_FLASHCARD_ID, front: 'hello' } as any],
                pagination: {
                    total: 1,
                    page: 1,
                    limit: 10,
                    totalPages: 1,
                    hasNext: false,
                    hasPrev: false,
                },
            });

            const result = await flashcardService.getFlashcardByCategoryId(
                MOCK_CATEGORY_ID,
                MOCK_USER_ID,
                1,
                10
            );

            expect(mockedPaginationHelper.paginate).toHaveBeenCalledWith(
                Flashcard,
                { category: MOCK_CATEGORY_ID, createBy: MOCK_USER_ID },
                { page: 1, limit: 10 },
                { path: 'category', select: 'name description' },
                '-__v -createBy',
                { createdAt: -1 }
            );
            expect(result).toEqual({
                flashcards: [{ _id: MOCK_FLASHCARD_ID, front: 'hello' }],
                pagination: {
                    total: 1,
                    page: 1,
                    limit: 10,
                    totalPages: 1,
                    hasNext: false,
                    hasPrev: false,
                },
            });
        });
    });

    // ──────────────────────────────────────────────
    // getAllFlashcard()
    // ──────────────────────────────────────────────
    describe('getAllFlashcard', () => {
        it('should paginate flashcards if page and limit are specified', async () => {
            mockedPaginationHelper.paginate.mockResolvedValue({
                data: [
                    {
                        _id: MOCK_FLASHCARD_ID,
                        front: 'hello',
                        back: 'xin chào',
                        category: MOCK_CATEGORY_ID,
                        difficulty: 'Medium',
                        tags: ['tag1'],
                        source: 'web',
                        isAIGenerated: true,
                        createdAt: 'date1',
                        updatedAt: 'date2',
                    } as any,
                ],
                pagination: {
                    total: 1,
                    page: 1,
                    limit: 10,
                    totalPages: 1,
                    hasNext: false,
                    hasPrev: false,
                },
            });

            const result = await flashcardService.getAllFlashcard(
                MOCK_USER_ID,
                1,
                10
            );

            expect(mockedPaginationHelper.paginate).toHaveBeenCalledWith(
                Flashcard,
                { createBy: MOCK_USER_ID },
                { page: 1, limit: 10 },
                undefined,
                undefined,
                { createdAt: -1 }
            );
            expect(result).toEqual({
                flashcards: [
                    {
                        id: MOCK_FLASHCARD_ID,
                        front: 'hello',
                        back: 'xin chào',
                        category: MOCK_CATEGORY_ID,
                        difficulty: 'Medium',
                        tags: ['tag1'],
                        source: 'web',
                        isAIGenerated: true,
                        createdAt: 'date1',
                        updatedAt: 'date2',
                    },
                ],
                pagination: {
                    total: 1,
                    page: 1,
                    limit: 10,
                    totalPages: 1,
                    hasNext: false,
                    hasPrev: false,
                },
            });
        });

        it('should return all flashcards (unpaginated) if page or limit is not specified', async () => {
            const mockList = [{ _id: MOCK_FLASHCARD_ID, front: 'hello' }];
            const mockQuery = {
                select: jest.fn().mockReturnThis(),
                sort: jest.fn().mockResolvedValue(mockList),
            };
            (mockedFlashcard.find as jest.Mock).mockReturnValue(mockQuery);

            const result = await flashcardService.getAllFlashcard(MOCK_USER_ID);

            expect(mockedFlashcard.find).toHaveBeenCalledWith({
                createBy: MOCK_USER_ID,
            });
            expect(result).toEqual(mockList);
        });
    });

    // ──────────────────────────────────────────────
    // getAllFlashcardBySource()
    // ──────────────────────────────────────────────
    describe('getAllFlashcardBySource', () => {
        it('should query and return flashcards filtered by source', async () => {
            const mockList = [{ _id: MOCK_FLASHCARD_ID, front: 'hello' }];
            const mockQuery = {
                populate: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                sort: jest.fn().mockResolvedValue(mockList),
            };
            (mockedFlashcard.find as jest.Mock).mockReturnValue(mockQuery);

            const result = await flashcardService.getAllFlashcardBySource(
                'web_article',
                MOCK_USER_ID
            );

            expect(mockedFlashcard.find).toHaveBeenCalledWith({
                createBy: MOCK_USER_ID,
                source: 'web_article',
            });
            expect(mockQuery.populate).toHaveBeenCalledWith(
                'category',
                'name description'
            );
            expect(result).toEqual(mockList);
        });
    });

    // ──────────────────────────────────────────────
    // bulkUpdateFlashcards()
    // ──────────────────────────────────────────────
    describe('bulkUpdateFlashcards', () => {
        it('should update all provided cards and return list of updated cards', async () => {
            const updates = [
                { id: '1', data: { front: 'f1' } },
                { id: '2', data: { front: 'f2' } },
            ];

            const mockQuery = {
                select: jest
                    .fn()
                    .mockResolvedValueOnce({ _id: '1', front: 'f1' })
                    .mockResolvedValueOnce({ _id: '2', front: 'f2' }),
            };
            (mockedFlashcard.findOneAndUpdate as jest.Mock).mockReturnValue(
                mockQuery
            );

            const result = await flashcardService.bulkUpdateFlashcards(
                updates,
                MOCK_USER_ID
            );

            expect(mockedFlashcard.findOneAndUpdate).toHaveBeenNthCalledWith(
                1,
                { _id: '1', createBy: MOCK_USER_ID },
                { front: 'f1' },
                { new: true }
            );
            expect(mockedFlashcard.findOneAndUpdate).toHaveBeenNthCalledWith(
                2,
                { _id: '2', createBy: MOCK_USER_ID },
                { front: 'f2' },
                { new: true }
            );
            expect(result).toEqual([
                { _id: '1', front: 'f1' },
                { _id: '2', front: 'f2' },
            ]);
        });

        it('should throw ApiError if any update ID is not found', async () => {
            const updates = [{ id: '1', data: { front: 'f1' } }];
            const mockQuery = {
                select: jest.fn().mockResolvedValue(null),
            };
            (mockedFlashcard.findOneAndUpdate as jest.Mock).mockReturnValue(
                mockQuery
            );

            await expect(
                flashcardService.bulkUpdateFlashcards(updates, MOCK_USER_ID)
            ).rejects.toThrow('Flashcard with ID 1 not found');
        });
    });

    // ──────────────────────────────────────────────
    // bulkCreateFlashcards()
    // ──────────────────────────────────────────────
    describe('bulkCreateFlashcards', () => {
        it('should throw ApiError if userId is missing', async () => {
            await expect(
                flashcardService.bulkCreateFlashcards([], '')
            ).rejects.toThrow('User ID is required');
        });

        it('should bulk create cards using provided category and default category', async () => {
            // Setup defaults
            const mockDefaultCat = { _id: 'default-cat-id' };
            (mockedCategoryFlashcard.findOne as jest.Mock).mockResolvedValue(
                mockDefaultCat
            );

            const cardsToCreate = [
                { front: 'hi', category: MOCK_CATEGORY_ID as any }, // explicit category
                { front: 'hello' }, // will use default (queries DB)
                { front: 'world' }, // will use default (does NOT query DB again)
            ];

            const mockSavedCard1 = {
                _id: 'c1',
                toObject: jest.fn().mockReturnValue({
                    _id: 'c1',
                    front: 'hi',
                    __v: 0,
                    createBy: MOCK_USER_ID,
                }),
                save: jest.fn().mockReturnThis(),
            };
            const mockSavedCard2 = {
                _id: 'c2',
                toObject: jest.fn().mockReturnValue({
                    _id: 'c2',
                    front: 'hello',
                    __v: 0,
                    createBy: MOCK_USER_ID,
                }),
                save: jest.fn().mockReturnThis(),
            };
            const mockSavedCard3 = {
                _id: 'c3',
                toObject: jest.fn().mockReturnValue({
                    _id: 'c3',
                    front: 'world',
                    __v: 0,
                    createBy: MOCK_USER_ID,
                }),
                save: jest.fn().mockReturnThis(),
            };

            (mockedFlashcard as any)
                .mockImplementationOnce(() => mockSavedCard1)
                .mockImplementationOnce(() => mockSavedCard2)
                .mockImplementationOnce(() => mockSavedCard3);

            const result = await flashcardService.bulkCreateFlashcards(
                cardsToCreate,
                MOCK_USER_ID
            );

            // Verify category lookup called only once
            expect(mockedCategoryFlashcard.findOne).toHaveBeenCalledTimes(1);
            expect(mockedCategoryFlashcard.findOne).toHaveBeenCalledWith({
                createBy: MOCK_USER_ID,
                is_default: true,
            });

            expect(mockedFlashcard).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({
                    front: 'hi',
                    category: MOCK_CATEGORY_ID,
                })
            );
            expect(mockedFlashcard).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    front: 'hello',
                    category: 'default-cat-id',
                })
            );
            expect(mockedFlashcard).toHaveBeenNthCalledWith(
                3,
                expect.objectContaining({
                    front: 'world',
                    category: 'default-cat-id',
                })
            );

            expect(result).toEqual([
                { _id: 'c1', front: 'hi' },
                { _id: 'c2', front: 'hello' },
                { _id: 'c3', front: 'world' },
            ]);
        });

        it('should create a new default category when bulk creating if none exists', async () => {
            (mockedCategoryFlashcard.findOne as jest.Mock).mockResolvedValue(
                null
            );

            const mockSavedCategory = { _id: 'new-default-cat' };
            const mockCategoryConstructor = {
                _id: 'new-default-cat',
                save: jest.fn().mockResolvedValue(mockSavedCategory),
            };
            (mockedCategoryFlashcard as any).mockImplementation(
                () => mockCategoryConstructor
            );

            const mockSavedCard = {
                _id: 'c1',
                toObject: jest.fn().mockReturnValue({
                    _id: 'c1',
                    __v: 0,
                    createBy: MOCK_USER_ID,
                }),
                save: jest.fn().mockReturnThis(),
            };
            (mockedFlashcard as any).mockImplementation(() => mockSavedCard);

            await flashcardService.bulkCreateFlashcards(
                [{ front: 'hello' }],
                MOCK_USER_ID
            );

            expect(mockedCategoryFlashcard).toHaveBeenCalledWith({
                name: 'Uncategorized',
                description: 'Default category for flashcards',
                color: '#6B7280',
                is_default: true,
                createBy: MOCK_USER_ID,
            });
        });

        it('should not look up or create default category if all cards have a category', async () => {
            const cardsToCreate = [
                { front: 'hi', category: MOCK_CATEGORY_ID as any },
            ];

            const mockSavedCard = {
                _id: 'c1',
                toObject: jest.fn().mockReturnValue({
                    _id: 'c1',
                    front: 'hi',
                    __v: 0,
                    createBy: MOCK_USER_ID,
                }),
                save: jest.fn().mockReturnThis(),
            };
            (mockedFlashcard as any).mockImplementationOnce(
                () => mockSavedCard
            );

            const result = await flashcardService.bulkCreateFlashcards(
                cardsToCreate,
                MOCK_USER_ID
            );

            expect(mockedCategoryFlashcard.findOne).not.toHaveBeenCalled();
            expect(result).toBeDefined();
        });

        it('should use Flashcard.insertMany when it successfully returns the saved cards', async () => {
            const cardsToCreate = [
                { front: 'hi', category: MOCK_CATEGORY_ID as any },
            ];

            const mockSavedCard = {
                _id: 'c1',
                toObject: jest.fn().mockReturnValue({
                    _id: 'c1',
                    front: 'hi',
                    category: MOCK_CATEGORY_ID,
                }),
            };

            (mockedFlashcard.insertMany as jest.Mock).mockResolvedValue([
                mockSavedCard,
            ] as any);

            const result = await flashcardService.bulkCreateFlashcards(
                cardsToCreate,
                MOCK_USER_ID
            );

            expect(mockedFlashcard.insertMany).toHaveBeenCalled();
            expect(result).toEqual([
                { _id: 'c1', front: 'hi', category: MOCK_CATEGORY_ID },
            ]);
        });
    });

    // ──────────────────────────────────────────────
    // getFlashcardsForReview()
    // ──────────────────────────────────────────────
    describe('getFlashcardsForReview', () => {
        let isDueForReviewSpy: jest.SpyInstance;

        beforeEach(() => {
            isDueForReviewSpy = jest.spyOn(
                spacedRepetitionService,
                'isDueForReview'
            );
        });

        afterEach(() => {
            isDueForReviewSpy.mockRestore();
        });

        it('should retrieve and filter due flashcards up to the limit', async () => {
            const mockCards = [
                { _id: 'c1', nextReviewDate: 'date1' },
                { _id: 'c2', nextReviewDate: 'date2' },
                { _id: 'c3', nextReviewDate: 'date3' },
            ];

            const mockQuery = {
                populate: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue(mockCards),
            };
            (mockedFlashcard.find as jest.Mock).mockReturnValue(mockQuery);

            // mock isDueForReview: card 1 and 3 are due, card 2 is not
            isDueForReviewSpy
                .mockReturnValueOnce(true)
                .mockReturnValueOnce(false)
                .mockReturnValueOnce(true);

            const result = await flashcardService.getFlashcardsForReview(
                MOCK_USER_ID,
                2,
                MOCK_CATEGORY_ID
            );

            expect(mockedFlashcard.find).toHaveBeenCalledWith({
                createBy: MOCK_USER_ID,
                category: MOCK_CATEGORY_ID,
            });
            expect(mockQuery.limit).toHaveBeenCalledWith(4); // limit * 2 = 4
            expect(result).toEqual([
                { _id: 'c1', nextReviewDate: 'date1' },
                { _id: 'c3', nextReviewDate: 'date3' },
            ]);
        });

        it('should retrieve due flashcards using default limit of 20 and no category filter', async () => {
            const mockCards = [{ _id: 'c1', nextReviewDate: 'date1' }];
            const mockQuery = {
                populate: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue(mockCards),
            };
            (mockedFlashcard.find as jest.Mock).mockReturnValue(mockQuery);
            isDueForReviewSpy.mockReturnValue(true);

            const result =
                await flashcardService.getFlashcardsForReview(MOCK_USER_ID);

            expect(mockedFlashcard.find).toHaveBeenCalledWith({
                createBy: MOCK_USER_ID,
            });
            expect(mockQuery.limit).toHaveBeenCalledWith(40); // default limit (20) * 2
            expect(result).toEqual(mockCards);
        });
    });

    // ──────────────────────────────────────────────
    // updateReviewResult()
    // ──────────────────────────────────────────────
    describe('updateReviewResult', () => {
        let calculateNextReviewSpy: jest.SpyInstance;

        beforeEach(() => {
            calculateNextReviewSpy = jest.spyOn(
                spacedRepetitionService,
                'calculateNextReview'
            );
        });

        afterEach(() => {
            calculateNextReviewSpy.mockRestore();
        });

        it('should throw ApiError if flashcard is not found', async () => {
            (mockedFlashcard.findOne as jest.Mock).mockResolvedValue(null);

            await expect(
                flashcardService.updateReviewResult(
                    MOCK_FLASHCARD_ID,
                    MOCK_USER_ID,
                    { remember: true }
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.FLASHCARD_NOT_FOUND.status,
            });
        });

        it('should calculate and save Leitner spaced repetition details', async () => {
            const mockCard = {
                _id: MOCK_FLASHCARD_ID,
                level_memory: 2,
                reviewCount: 5,
                nextReviewDate: null,
                lastReviewDate: null,
                toObject: jest.fn().mockReturnValue({
                    _id: MOCK_FLASHCARD_ID,
                    level_memory: 3,
                    reviewCount: 6,
                    __v: 0,
                    createBy: MOCK_USER_ID,
                }),
                save: jest.fn().mockResolvedValue(true),
            };
            (mockedFlashcard.findOne as jest.Mock).mockResolvedValue(mockCard);

            const mockNextReviewDate = new Date();
            calculateNextReviewSpy.mockReturnValue({
                level_memory: 3,
                nextReviewDate: mockNextReviewDate,
            });

            const result = await flashcardService.updateReviewResult(
                MOCK_FLASHCARD_ID,
                MOCK_USER_ID,
                { remember: true }
            );

            expect(mockedFlashcard.findOne).toHaveBeenCalledWith({
                _id: MOCK_FLASHCARD_ID,
                createBy: MOCK_USER_ID,
            });
            expect(calculateNextReviewSpy).toHaveBeenCalledWith(2, {
                remember: true,
            });
            expect(mockCard.level_memory).toBe(3);
            expect(mockCard.nextReviewDate).toBe(mockNextReviewDate);
            expect(mockCard.lastReviewDate).toBeInstanceOf(Date);
            expect(mockCard.reviewCount).toBe(6);
            expect(mockCard.save).toHaveBeenCalled();
            expect(result).toEqual({
                _id: MOCK_FLASHCARD_ID,
                level_memory: 3,
                reviewCount: 6,
            });
        });

        it('should handle undefined level_memory and reviewCount by defaulting to 0', async () => {
            const mockCard = {
                _id: MOCK_FLASHCARD_ID,
                level_memory: undefined,
                reviewCount: undefined,
                nextReviewDate: null,
                lastReviewDate: null,
                toObject: jest.fn().mockReturnValue({
                    _id: MOCK_FLASHCARD_ID,
                    level_memory: 1,
                    reviewCount: 1,
                    __v: 0,
                    createBy: MOCK_USER_ID,
                }),
                save: jest.fn().mockResolvedValue(true),
            };
            (mockedFlashcard.findOne as jest.Mock).mockResolvedValue(mockCard);

            const mockNextReviewDate = new Date();
            calculateNextReviewSpy.mockReturnValue({
                level_memory: 1,
                nextReviewDate: mockNextReviewDate,
            });

            await flashcardService.updateReviewResult(
                MOCK_FLASHCARD_ID,
                MOCK_USER_ID,
                { remember: true }
            );

            expect(calculateNextReviewSpy).toHaveBeenCalledWith(0, {
                remember: true,
            });
            expect(mockCard.level_memory).toBe(1);
            expect(mockCard.reviewCount).toBe(1);
        });
    });

    // ──────────────────────────────────────────────
    // getReviewStatistics()
    // ──────────────────────────────────────────────
    describe('getReviewStatistics', () => {
        let calculateProgressSpy: jest.SpyInstance;
        let getRecommendedDailyLimitSpy: jest.SpyInstance;

        beforeEach(() => {
            calculateProgressSpy = jest.spyOn(
                spacedRepetitionService,
                'calculateProgress'
            );
            getRecommendedDailyLimitSpy = jest.spyOn(
                spacedRepetitionService,
                'getRecommendedDailyLimit'
            );
        });

        afterEach(() => {
            calculateProgressSpy.mockRestore();
            getRecommendedDailyLimitSpy.mockRestore();
        });

        it('should calculate statistics filtering invalid category flashcards', async () => {
            const mockCategories = [
                { _id: 'cat-valid-1' },
                { _id: 'cat-valid-2' },
            ];
            const mockCategoryQuery = {
                select: jest.fn().mockResolvedValue(mockCategories),
            };
            (mockedCategoryFlashcard.find as jest.Mock).mockReturnValue(
                mockCategoryQuery
            );

            const mockCards = [
                { _id: 'c1', category: 'cat-valid-1', level_memory: 2 },
                { _id: 'c2', category: 'cat-invalid-deleted', level_memory: 3 }, // should be filtered out
            ];
            const mockFlashcardQuery = {
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(mockCards),
            };
            (mockedFlashcard.find as jest.Mock).mockReturnValue(
                mockFlashcardQuery
            );

            calculateProgressSpy.mockReturnValue({
                total: 1,
                dueForReview: 1,
                byLevel: { level2: 1 },
                percentMastered: 0,
            });
            getRecommendedDailyLimitSpy.mockReturnValue(15);

            const result = await flashcardService.getReviewStatistics(
                MOCK_USER_ID,
                MOCK_CATEGORY_ID
            );

            expect(mockedCategoryFlashcard.find).toHaveBeenCalledWith({
                createBy: MOCK_USER_ID,
            });
            expect(mockedFlashcard.find).toHaveBeenCalledWith({
                createBy: MOCK_USER_ID,
                category: MOCK_CATEGORY_ID,
            });
            // verify calculateProgress only received card belonging to valid categories
            expect(calculateProgressSpy).toHaveBeenCalledWith([
                { _id: 'c1', category: 'cat-valid-1', level_memory: 2 },
            ]);
            expect(getRecommendedDailyLimitSpy).toHaveBeenCalledWith(1);
            expect(result).toEqual({
                total: 1,
                dueForReview: 1,
                byLevel: { level2: 1 },
                percentMastered: 0,
                recommendedDaily: 15,
            });
        });

        it('should calculate statistics without category filter', async () => {
            (mockedCategoryFlashcard.find as jest.Mock).mockReturnValue({
                select: jest.fn().mockResolvedValue([{ _id: 'cat-valid-1' }]),
            });
            (mockedFlashcard.find as jest.Mock).mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest
                    .fn()
                    .mockResolvedValue([
                        { _id: 'c1', category: 'cat-valid-1' },
                    ]),
            });
            calculateProgressSpy.mockReturnValue({
                total: 1,
                dueForReview: 0,
                byLevel: {},
                percentMastered: 0,
            });
            getRecommendedDailyLimitSpy.mockReturnValue(20);

            const result =
                await flashcardService.getReviewStatistics(MOCK_USER_ID);

            expect(mockedFlashcard.find).toHaveBeenCalledWith({
                createBy: MOCK_USER_ID,
            });
            expect(result.recommendedDaily).toBe(20);
        });
    });

    // ──────────────────────────────────────────────
    // resetAllReviews()
    // ──────────────────────────────────────────────
    describe('resetAllReviews', () => {
        it('should reset all review parameters for user flashcards', async () => {
            (mockedFlashcard.updateMany as jest.Mock).mockResolvedValue({
                modifiedCount: 15,
            });

            const result = await flashcardService.resetAllReviews(MOCK_USER_ID);

            expect(mockedFlashcard.updateMany).toHaveBeenCalledWith(
                { createBy: MOCK_USER_ID },
                {
                    $set: {
                        level_memory: 0,
                        nextReviewDate: expect.any(Date),
                        lastReviewDate: undefined,
                        reviewCount: 0,
                    },
                }
            );
            expect(result).toEqual({ modifiedCount: 15 });
        });
    });

    // ──────────────────────────────────────────────
    // bulkDeleteFlashcards()
    // ──────────────────────────────────────────────
    describe('bulkDeleteFlashcards', () => {
        it('should throw ApiError if userId is not provided', async () => {
            await expect(
                flashcardService.bulkDeleteFlashcards(['1'], '')
            ).rejects.toThrow('User ID is required');
        });

        it('should throw ApiError if flashcardIds is empty or not an array', async () => {
            await expect(
                flashcardService.bulkDeleteFlashcards([], MOCK_USER_ID)
            ).rejects.toThrow(
                'Flashcard IDs array is required and cannot be empty'
            );
            await expect(
                flashcardService.bulkDeleteFlashcards(null as any, MOCK_USER_ID)
            ).rejects.toThrow(
                'Flashcard IDs array is required and cannot be empty'
            );
        });

        it('should bulk delete flashcards matching ids and created by user', async () => {
            (mockedFlashcard.deleteMany as jest.Mock).mockResolvedValue({
                deletedCount: 3,
            });

            const ids = ['id-1', 'id-2', 'id-3'];
            const result = await flashcardService.bulkDeleteFlashcards(
                ids,
                MOCK_USER_ID
            );

            expect(mockedFlashcard.deleteMany).toHaveBeenCalledWith({
                _id: { $in: ids },
                createBy: MOCK_USER_ID,
            });
            expect(result).toEqual({
                deletedCount: 3,
                requestedCount: 3,
            });
        });
    });
});
