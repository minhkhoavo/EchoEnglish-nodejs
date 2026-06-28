/* eslint-disable @typescript-eslint/no-explicit-any */
import flashcardService from '~/services/flashcardService.js';

const createFlashcardSpy = jest
    .spyOn(flashcardService, 'createFlashcard')
    .mockImplementation();
const getFlashcardByIdSpy = jest
    .spyOn(flashcardService, 'getFlashcardById')
    .mockImplementation();
const updateFlashcardSpy = jest
    .spyOn(flashcardService, 'updateFlashcard')
    .mockImplementation();
const deleteFlashcardSpy = jest
    .spyOn(flashcardService, 'deleteFlashcard')
    .mockImplementation();
const getFlashcardByCategoryIdSpy = jest
    .spyOn(flashcardService, 'getFlashcardByCategoryId')
    .mockImplementation();
const getAllFlashcardSpy = jest
    .spyOn(flashcardService, 'getAllFlashcard')
    .mockImplementation();
const bulkCreateFlashcardsSpy = jest
    .spyOn(flashcardService, 'bulkCreateFlashcards')
    .mockImplementation();
const bulkUpdateFlashcardsSpy = jest
    .spyOn(flashcardService, 'bulkUpdateFlashcards')
    .mockImplementation();

import { flashcardTools } from '~/ai/tools/flashcardTools.js';

describe('flashcardTools', () => {
    const [
        createFlashcardTool,
        getFlashcardTool,
        updateFlashcardTool,
        deleteFlashcardTool,
        searchFlashcardsTool,
        bulkCreateFlashcardsTool,
        bulkUpdateFlashcardsTool,
    ] = flashcardTools as any[];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('createFlashcardTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(
                createFlashcardTool.invoke({ front: 'f', back: 'b' }, {})
            ).rejects.toThrow('userId required');
        });

        it('should create flashcard and return ID', async () => {
            createFlashcardSpy.mockResolvedValue({ _id: 'fc-1' } as any);

            const result = await createFlashcardTool.invoke(
                {
                    front: 'f',
                    back: 'b',
                    category: 'cat-1',
                    difficulty: 'Hard',
                    tags: ['t1'],
                    source: 'src',
                    isAIGenerated: true,
                },
                { configurable: { userId: 'user-1' } }
            );

            expect(createFlashcardSpy).toHaveBeenCalledWith(
                {
                    front: 'f',
                    back: 'b',
                    category: 'cat-1',
                    difficulty: 'Hard',
                    tags: ['t1'],
                    source: 'src',
                    isAIGenerated: true,
                },
                'user-1'
            );
            expect(result).toBe('Flashcard ID: fc-1');
        });

        it('should handle default values when optional fields are omitted', async () => {
            createFlashcardSpy.mockResolvedValue({ _id: 'fc-1' } as any);

            await createFlashcardTool.invoke(
                { front: 'f', back: 'b' },
                { configurable: { userId: 'user-1' } }
            );

            expect(createFlashcardSpy).toHaveBeenCalledWith(
                {
                    front: 'f',
                    back: 'b',
                    category: undefined,
                    difficulty: 'Easy',
                    tags: [],
                    source: '',
                    isAIGenerated: false,
                },
                'user-1'
            );
        });

        it('should handle difficulty normalization', async () => {
            createFlashcardSpy.mockResolvedValue({ _id: 'fc-1' } as any);

            await createFlashcardTool.invoke(
                { front: 'f', back: 'b', difficulty: 'm' },
                { configurable: { userId: 'user-1' } }
            );

            expect(createFlashcardSpy).toHaveBeenCalledWith(
                expect.objectContaining({ difficulty: 'Medium' }),
                'user-1'
            );

            await createFlashcardTool.invoke(
                { front: 'f', back: 'b', difficulty: 'unknown' },
                { configurable: { userId: 'user-1' } }
            );

            expect(createFlashcardSpy).toHaveBeenCalledWith(
                expect.objectContaining({ difficulty: 'Easy' }),
                'user-1'
            );
        });
    });

    describe('getFlashcardTool', () => {
        it('should throw Error if id or userId is missing', async () => {
            await expect(
                getFlashcardTool.invoke({ id: 'fc-1' }, {})
            ).rejects.toThrow('flashcardId & userId required');
            await expect(
                getFlashcardTool.invoke(
                    { id: '' },
                    { configurable: { userId: 'user-1' } }
                )
            ).rejects.toThrow('flashcardId & userId required');
        });

        it('should get flashcard and return simple format', async () => {
            getFlashcardByIdSpy.mockResolvedValue({
                _id: 'fc-1',
                front: 'f',
                back: 'b',
                other: 'data',
            } as any);

            const result = await getFlashcardTool.invoke(
                { id: 'fc-1' },
                { configurable: { userId: 'user-1' } }
            );

            expect(getFlashcardByIdSpy).toHaveBeenCalledWith('fc-1', 'user-1');
            expect(result).toBe(
                JSON.stringify({ id: 'fc-1', front: 'f', back: 'b' })
            );
        });
    });

    describe('updateFlashcardTool', () => {
        it('should throw Error if id or userId is missing', async () => {
            await expect(
                updateFlashcardTool.invoke({ id: 'fc-1' }, {})
            ).rejects.toThrow('flashcardId & userId required');
        });

        it('should update flashcard and return updated data', async () => {
            updateFlashcardSpy.mockResolvedValue({
                _id: 'fc-1',
                front: 'f2',
            } as any);

            const result = await updateFlashcardTool.invoke(
                { id: 'fc-1', front: 'f2', difficulty: 'Hard' },
                { configurable: { userId: 'user-1' } }
            );

            expect(updateFlashcardSpy).toHaveBeenCalledWith(
                'fc-1',
                { front: 'f2', difficulty: 'Hard' },
                'user-1'
            );
            expect(result).toBe(
                `Updated: ${JSON.stringify({ _id: 'fc-1', front: 'f2' })}`
            );
        });

        it('should not include difficulty if not provided', async () => {
            updateFlashcardSpy.mockResolvedValue({ _id: 'fc-1' } as any);

            await updateFlashcardTool.invoke(
                { id: 'fc-1', front: 'f2' },
                { configurable: { userId: 'user-1' } }
            );

            expect(updateFlashcardSpy).toHaveBeenCalledWith(
                'fc-1',
                { front: 'f2', difficulty: undefined },
                'user-1'
            );
        });
    });

    describe('deleteFlashcardTool', () => {
        it('should throw Error if id or userId is missing', async () => {
            await expect(
                deleteFlashcardTool.invoke({ id: 'fc-1' }, {})
            ).rejects.toThrow('flashcardId & userId required');
        });

        it('should delete flashcard and return string', async () => {
            deleteFlashcardSpy.mockResolvedValue(true as any);

            const result = await deleteFlashcardTool.invoke(
                { id: 'fc-1' },
                { configurable: { userId: 'user-1' } }
            );

            expect(deleteFlashcardSpy).toHaveBeenCalledWith('fc-1', 'user-1');
            expect(result).toBe('Deleted fc-1');
        });
    });

    describe('searchFlashcardsTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(searchFlashcardsTool.invoke({}, {})).rejects.toThrow(
                'userId required'
            );
        });

        it('should search by categoryId', async () => {
            getFlashcardByCategoryIdSpy.mockResolvedValue([
                { id: 'fc-1', front: 'f1', back: 'b1' },
            ] as any);

            const result = await searchFlashcardsTool.invoke(
                { categoryId: 'cat-1', page: 2, limit: 5 },
                { configurable: { userId: 'user-1' } }
            );

            expect(getFlashcardByCategoryIdSpy).toHaveBeenCalledWith(
                'cat-1',
                'user-1',
                2,
                5
            );
            expect(result).toBe(
                JSON.stringify([{ id: 'fc-1', front: 'f1', back: 'b1' }])
            );
        });

        it('should search all flashcards if no categoryId', async () => {
            getAllFlashcardSpy.mockResolvedValue({
                flashcards: [{ id: 'fc-1', front: 'f1', back: 'b1' }],
            } as any);

            const result = await searchFlashcardsTool.invoke(
                {},
                { configurable: { userId: 'user-1' } }
            );

            expect(getAllFlashcardSpy).toHaveBeenCalledWith('user-1', 1, 10);
            expect(result).toBe(
                JSON.stringify({
                    flashcards: [{ id: 'fc-1', front: 'f1', back: 'b1' }],
                })
            );
        });

        it('should filter array results by query', async () => {
            getFlashcardByCategoryIdSpy.mockResolvedValue([
                { id: 'fc-1', front: 'hello', back: 'xin chao' },
                { id: 'fc-2', front: 'apple', back: 'qua tao' },
            ] as any);

            const result = await searchFlashcardsTool.invoke(
                { categoryId: 'cat-1', query: 'hello' },
                { configurable: { userId: 'user-1' } }
            );

            expect(result).toBe(
                JSON.stringify([
                    { id: 'fc-1', front: 'hello', back: 'xin chao' },
                ])
            );
        });

        it('should filter object results by query', async () => {
            getAllFlashcardSpy.mockResolvedValue({
                flashcards: [
                    { id: 'fc-1', front: 'hello', back: 'xin chao' },
                    { id: 'fc-2', front: 'apple', back: 'qua tao' },
                ],
            } as any);

            const result = await searchFlashcardsTool.invoke(
                { query: 'tao' },
                { configurable: { userId: 'user-1' } }
            );

            expect(result).toBe(
                JSON.stringify({
                    flashcards: [
                        { id: 'fc-2', front: 'apple', back: 'qua tao' },
                    ],
                })
            );
        });

        it('should handle null/undefined results when querying', async () => {
            getAllFlashcardSpy.mockResolvedValue(null as any);

            const result = await searchFlashcardsTool.invoke(
                { query: 'tao' },
                { configurable: { userId: 'user-1' } }
            );

            expect(result).toBe(JSON.stringify(null));
        });

        it('should handle object result with null flashcards when querying', async () => {
            // Covers the || [] branch on L159: ((results.flashcards as unknown[]) || [])
            getAllFlashcardSpy.mockResolvedValue({ flashcards: null } as any);

            const result = await searchFlashcardsTool.invoke(
                { query: 'hello' },
                { configurable: { userId: 'user-1' } }
            );

            // flashcards is null → extractList returns [] → filtered is [] → set back
            expect(JSON.parse(result)).toEqual({ flashcards: [] });
        });
    });

    describe('bulkCreateFlashcardsTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(
                bulkCreateFlashcardsTool.invoke(
                    { flashcards: [{ front: 'a', back: 'b' }] },
                    {}
                )
            ).rejects.toThrow('userId required');
        });

        it('should throw schema validation error if flashcards array is empty via invoke', async () => {
            await expect(
                bulkCreateFlashcardsTool.invoke(
                    { flashcards: [] },
                    { configurable: { userId: 'user-1' } }
                )
            ).rejects.toThrow(/schema/);
        });

        it('should throw Error for empty array via _call (bypasses schema)', async () => {
            // Provide a mock runManager so LangChain's _call wrapper doesn't crash
            const mockRunManager = {
                getChild: jest.fn().mockReturnValue(undefined),
            };
            await expect(
                (bulkCreateFlashcardsTool as any)._call(
                    { flashcards: [] },
                    mockRunManager,
                    { configurable: { userId: 'user-1' } }
                )
            ).rejects.toThrow(
                'flashcards array is required and cannot be empty'
            );
        });

        it('should throw Error for non-array via _call (bypasses schema)', async () => {
            const mockRunManager = {
                getChild: jest.fn().mockReturnValue(undefined),
            };
            await expect(
                (bulkCreateFlashcardsTool as any)._call(
                    { flashcards: null },
                    mockRunManager,
                    { configurable: { userId: 'user-1' } }
                )
            ).rejects.toThrow(
                'flashcards array is required and cannot be empty'
            );
        });

        it('should bulk create flashcards', async () => {
            bulkCreateFlashcardsSpy.mockResolvedValue([
                { _id: 'fc-1' },
                { _id: 'fc-2' },
            ] as any);

            const result = await bulkCreateFlashcardsTool.invoke(
                {
                    flashcards: [
                        { front: 'f1', back: 'b1' },
                        {
                            front: 'f2',
                            back: 'b2',
                            difficulty: 'Hard',
                            source: 'test',
                        },
                    ],
                },
                { configurable: { userId: 'user-1' } }
            );

            expect(bulkCreateFlashcardsSpy).toHaveBeenCalledWith(
                [
                    {
                        front: 'f1',
                        back: 'b1',
                        category: undefined,
                        difficulty: 'Easy',
                        tags: [],
                        source: 'AI Generated from Image',
                        isAIGenerated: true,
                    },
                    {
                        front: 'f2',
                        back: 'b2',
                        category: undefined,
                        difficulty: 'Hard',
                        tags: [],
                        source: 'test',
                        isAIGenerated: true,
                    },
                ],
                'user-1'
            );
            expect(result).toBe(
                'Successfully created 2 flashcards. IDs: fc-1, fc-2'
            );
        });
    });

    describe('bulkUpdateFlashcardsTool', () => {
        it('should throw Error if userId is missing', async () => {
            await expect(
                bulkUpdateFlashcardsTool.invoke(
                    { updates: [{ id: 'fc-1' }] },
                    {}
                )
            ).rejects.toThrow('userId required');
        });

        it('should throw schema validation error if updates array is empty via invoke', async () => {
            await expect(
                bulkUpdateFlashcardsTool.invoke(
                    { updates: [] },
                    { configurable: { userId: 'user-1' } }
                )
            ).rejects.toThrow(/schema/);
        });

        it('should throw Error for empty array via _call (bypasses schema)', async () => {
            const mockRunManager = {
                getChild: jest.fn().mockReturnValue(undefined),
            };
            await expect(
                (bulkUpdateFlashcardsTool as any)._call(
                    { updates: [] },
                    mockRunManager,
                    { configurable: { userId: 'user-1' } }
                )
            ).rejects.toThrow('updates array is required and cannot be empty');
        });

        it('should throw Error for non-array via _call (bypasses schema)', async () => {
            const mockRunManager = {
                getChild: jest.fn().mockReturnValue(undefined),
            };
            await expect(
                (bulkUpdateFlashcardsTool as any)._call(
                    { updates: null },
                    mockRunManager,
                    { configurable: { userId: 'user-1' } }
                )
            ).rejects.toThrow('updates array is required and cannot be empty');
        });

        it('should bulk update flashcards with all optional fields truthy', async () => {
            bulkUpdateFlashcardsSpy.mockResolvedValue([{}, {}] as any);

            const result = await bulkUpdateFlashcardsTool.invoke(
                {
                    updates: [
                        {
                            id: 'fc-1',
                            front: 'f',
                            back: 'b',
                            category: 'c',
                            difficulty: 'Easy',
                            tags: ['t'],
                            source: 's',
                            isAIGenerated: false,
                        },
                        { id: 'fc-2' }, // all optional fields absent — covers falsy branches
                    ],
                },
                { configurable: { userId: 'user-1' } }
            );

            expect(bulkUpdateFlashcardsSpy).toHaveBeenCalledWith(
                [
                    {
                        id: 'fc-1',
                        data: {
                            front: 'f',
                            back: 'b',
                            category: 'c',
                            difficulty: 'Easy',
                            tags: ['t'],
                            source: 's',
                            isAIGenerated: false,
                        },
                    },
                    { id: 'fc-2', data: {} },
                ],
                'user-1'
            );
            expect(result).toBe('Successfully updated 2 flashcards');
        });
    });
});
