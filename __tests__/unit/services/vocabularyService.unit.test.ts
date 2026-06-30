/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import vocabularyService, {
    VocabularyWord,
} from '~/services/vocabularyService.js';
import flashcardServiceMock from '~/services/flashcardService.js';

// Mock fs and flashcardService
jest.mock('fs', () => ({
    __esModule: true,
    default: {
        existsSync: jest.fn(),
        readdirSync: jest.fn(),
        readFileSync: jest.fn(),
    },
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
}));
jest.mock('~/services/flashcardService.js', () => ({
    __esModule: true,
    default: {
        getAllFlashcard: jest.fn(),
    },
}));

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedFlashcardService = flashcardServiceMock as jest.Mocked<
    typeof flashcardServiceMock
>;

// Interface matching the internal JSON structure of vocabulary files
interface VocabularyJSON {
    status: string;
    message: string;
    data: {
        cards: VocabularyWord[];
    };
}

function buildMockVocabularyWord(
    overrides: Record<string, any> = {}
): VocabularyWord {
    return {
        card_id: 'card-1',
        word: 'apple',
        explanation: { en: 'A round fruit', vi: 'Quả táo' },
        translation: { vi: 'Quả táo' },
        type: 'noun',
        phonetics: [{ text: '/ˈæpl/', audio: 'apple.mp3', locale: 'en-US' }],
        example: { en: 'I eat an apple.', vi: 'Tôi ăn một quả táo.' },
        image_url: 'apple.jpg',
        notes: 'delicious',
        difficulty: 'easy',
        group_id: 'group-fruit',
        group_name: 'Fruits',
        deck_id: 'deck-basic',
        deck_name: 'Basic Words',
        ...overrides,
    };
}

function buildMockVocabularyJSON(cards: VocabularyWord[]): VocabularyJSON {
    return {
        status: 'success',
        message: 'Loaded successfully',
        data: {
            cards,
        },
    };
}

describe('VocabularyService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ──────────────────────────────────────────────
    // getAllVocabularySets()
    // ──────────────────────────────────────────────
    describe('getAllVocabularySets', () => {
        it('should return [] if vocabulary directory does not exist', () => {
            mockedFs.existsSync.mockReturnValue(false);
            const result = vocabularyService.getAllVocabularySets();
            expect(result).toEqual([]);
            expect(mockedFs.existsSync).toHaveBeenCalled();
        });

        it('should read directory and filter JSON files, returning vocabulary sets', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readdirSync.mockReturnValue([
                'set1.json',
                'set2.json',
                'readme.txt',
            ] as any);

            const card1 = buildMockVocabularyWord({
                card_id: 'c1',
                group_name: 'Fruits',
                deck_name: 'Fruit Deck',
                group_id: 'g1',
                deck_id: 'd1',
            });
            const card2 = buildMockVocabularyWord({
                card_id: 'c2',
                group_name: 'Animals',
                deck_name: 'Animal Deck',
                group_id: 'g2',
                deck_id: 'd2',
            });

            mockedFs.readFileSync
                .mockReturnValueOnce(
                    JSON.stringify(buildMockVocabularyJSON([card1]))
                )
                .mockReturnValueOnce(
                    JSON.stringify(buildMockVocabularyJSON([card2, card2]))
                );

            const result = vocabularyService.getAllVocabularySets();

            expect(result).toEqual([
                {
                    fileName: 'set1',
                    name: 'Fruits',
                    description: 'Fruit Deck',
                    wordCount: 1,
                    group_id: 'g1',
                    group_name: 'Fruits',
                    deck_id: 'd1',
                    deck_name: 'Fruit Deck',
                },
                {
                    fileName: 'set2',
                    name: 'Animals',
                    description: 'Animal Deck',
                    wordCount: 2,
                    group_id: 'g2',
                    group_name: 'Animals',
                    deck_id: 'd2',
                    deck_name: 'Animal Deck',
                },
            ]);
        });

        it('should use file name as name if group_name is missing', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readdirSync.mockReturnValue(['set_no_group.json'] as any);

            const card = buildMockVocabularyWord({
                card_id: 'c1',
                deck_name: 'No Group Deck',
                group_id: 'g1',
                deck_id: 'd1',
            });
            delete (card as any).group_name;
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON([card]))
            );

            const result = vocabularyService.getAllVocabularySets();
            expect(result[0].name).toBe('set_no_group');
        });

        it('should fallback description to empty string if deck_name is missing', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readdirSync.mockReturnValue(['set_no_deck.json'] as any);

            const card = buildMockVocabularyWord({
                card_id: 'c1',
                group_name: 'No Deck',
                group_id: 'g1',
                deck_id: 'd1',
            });
            delete (card as any).deck_name;
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON([card]))
            );

            const result = vocabularyService.getAllVocabularySets();
            expect(result[0].description).toBe('');
        });

        it('should skip files with missing or empty cards data', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readdirSync.mockReturnValue([
                'empty.json',
                'nocards.json',
                'nodata.json',
            ] as any);
            mockedFs.readFileSync
                .mockReturnValueOnce(JSON.stringify({}))
                .mockReturnValueOnce(JSON.stringify({ data: {} }))
                .mockReturnValueOnce(JSON.stringify({ data: { cards: [] } }));

            const result = vocabularyService.getAllVocabularySets();
            expect(result).toEqual([]);
        });

        it('should handle JSON parse errors or other fs errors gracefully and return []', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readdirSync.mockImplementation(() => {
                throw new Error('Failed to read');
            });

            const consoleSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const result = vocabularyService.getAllVocabularySets();
            expect(result).toEqual([]);
            expect(consoleSpy).toHaveBeenCalledWith(
                'Error reading vocabulary sets:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });
    });

    // ──────────────────────────────────────────────
    // getVocabularyWords()
    // ──────────────────────────────────────────────
    describe('getVocabularyWords', () => {
        const mockCards = [
            buildMockVocabularyWord({ card_id: 'card-1', word: 'apple' }),
            buildMockVocabularyWord({ card_id: 'card-2', word: 'banana' }),
            buildMockVocabularyWord({ card_id: 'card-3', word: 'cherry' }),
        ];

        it('should throw Error if file does not exist', async () => {
            mockedFs.existsSync.mockReturnValue(false);
            await expect(
                vocabularyService.getVocabularyWords('nonexistent')
            ).rejects.toThrow('Vocabulary set not found');
        });

        it('should throw Error if JSON file is missing cards data', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify({ status: 'success' })
            );
            await expect(
                vocabularyService.getVocabularyWords('invalid-format')
            ).rejects.toThrow('Invalid vocabulary file format');
        });

        it('should return paginated words without userId or when importStatus is all', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON(mockCards))
            );

            const result = await vocabularyService.getVocabularyWords(
                'fruits',
                1,
                2
            );
            expect(result.words).toHaveLength(2);
            expect(result.words[0].card_id).toBe('card-1');
            expect(result.words[1].card_id).toBe('card-2');
            expect(result.pagination).toEqual({
                currentPage: 1,
                totalPages: 2,
                totalWords: 3,
                limit: 2,
            });
        });

        it('should return next page correctly', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON(mockCards))
            );

            const result = await vocabularyService.getVocabularyWords(
                'fruits',
                2,
                2
            );
            expect(result.words).toHaveLength(1);
            expect(result.words[0].card_id).toBe('card-3');
            expect(result.pagination).toEqual({
                currentPage: 2,
                totalPages: 2,
                totalWords: 3,
                limit: 2,
            });
        });

        it('should filter imported cards when importStatus is imported', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON(mockCards))
            );

            // Mock FlashcardService returning existing flashcards array
            const mockUserFlashcards = [
                { source: 'Vocabulary Library (card-1)' },
                { source: 'Custom Deck' },
                { source: 'Vocabulary Library (card-3)' },
            ];
            mockedFlashcardService.getAllFlashcard.mockResolvedValue(
                mockUserFlashcards as any
            );

            const result = await vocabularyService.getVocabularyWords(
                'fruits',
                1,
                10,
                'user-123',
                'imported'
            );
            expect(result.words).toHaveLength(2);
            expect(result.words.map((w) => w.card_id)).toEqual([
                'card-1',
                'card-3',
            ]);
            expect(mockedFlashcardService.getAllFlashcard).toHaveBeenCalledWith(
                'user-123'
            );
        });

        it('should filter imported cards from nested object structure if returned by flashcardService', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON(mockCards))
            );

            // Mock FlashcardService returning existing flashcards object structure
            const mockUserFlashcards = {
                flashcards: [{ source: 'Vocabulary Library (card-2)' }],
            };
            mockedFlashcardService.getAllFlashcard.mockResolvedValue(
                mockUserFlashcards as any
            );

            const result = await vocabularyService.getVocabularyWords(
                'fruits',
                1,
                10,
                'user-123',
                'imported'
            );
            expect(result.words).toHaveLength(1);
            expect(result.words[0].card_id).toBe('card-2');
        });

        it('should filter out imported cards when importStatus is not-imported', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON(mockCards))
            );

            const mockUserFlashcards = [
                { source: 'Vocabulary Library (card-1)' },
            ];
            mockedFlashcardService.getAllFlashcard.mockResolvedValue(
                mockUserFlashcards as any
            );

            const result = await vocabularyService.getVocabularyWords(
                'fruits',
                1,
                10,
                'user-123',
                'not-imported'
            );
            expect(result.words).toHaveLength(2);
            expect(result.words.map((w) => w.card_id)).toEqual([
                'card-2',
                'card-3',
            ]);
        });

        it('should handle case when user has no flashcards or source has no ID in parentheses', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON(mockCards))
            );

            const mockUserFlashcards = [
                { source: 'Vocabulary Library' }, // missing (card-id)
                { source: null },
            ];
            mockedFlashcardService.getAllFlashcard.mockResolvedValue(
                mockUserFlashcards as any
            );

            const result = await vocabularyService.getVocabularyWords(
                'fruits',
                1,
                10,
                'user-123',
                'imported'
            );
            expect(result.words).toHaveLength(0);
        });

        it('should default to empty array if user has flashcards object without flashcards property', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON(mockCards))
            );
            mockedFlashcardService.getAllFlashcard.mockResolvedValue({} as any);

            const result = await vocabularyService.getVocabularyWords(
                'fruits',
                1,
                10,
                'user-123',
                'imported'
            );
            expect(result.words).toHaveLength(0);
        });

        it('should not filter cards if importStatus is invalid', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON(mockCards))
            );
            mockedFlashcardService.getAllFlashcard.mockResolvedValue([] as any);

            const result = await vocabularyService.getVocabularyWords(
                'fruits',
                1,
                10,
                'user-123',
                'invalid-status' as any
            );
            expect(result.words).toHaveLength(3);
        });

        it('should use cache if available in getVocabularyWords', async () => {
            const originalNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            try {
                mockedFs.existsSync.mockReturnValue(true);
                (vocabularyService as any).cacheWordsBySet.set(
                    'fruits-cached',
                    mockCards
                );

                const result = await vocabularyService.getVocabularyWords(
                    'fruits-cached',
                    1,
                    10
                );
                expect(result.words).toHaveLength(3);
                expect(mockedFs.readFileSync).not.toHaveBeenCalled();
            } finally {
                process.env.NODE_ENV = originalNodeEnv;
            }
        });
    });

    // ──────────────────────────────────────────────
    // searchVocabulary()
    // ──────────────────────────────────────────────
    describe('searchVocabulary', () => {
        const card1 = buildMockVocabularyWord({
            card_id: 'c1',
            word: 'Cat',
            translation: { vi: 'Con mèo' },
            explanation: {
                en: 'A small domesticated carnivorous mammal',
                vi: 'Một loài động vật',
            },
        });
        const card2 = buildMockVocabularyWord({
            card_id: 'c2',
            word: 'Dog',
            translation: { vi: 'Con chó' },
            explanation: { en: 'A loyal canine', vi: 'Con vật trông nhà' },
        });

        it('should search across all files if fileName is not provided', () => {
            mockedFs.readdirSync.mockReturnValue([
                'set1.json',
                'set2.json',
            ] as any);
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync
                .mockReturnValueOnce(
                    JSON.stringify(buildMockVocabularyJSON([card1]))
                )
                .mockReturnValueOnce(
                    JSON.stringify(buildMockVocabularyJSON([card2]))
                );

            // Search by word
            const res1 = vocabularyService.searchVocabulary('cat');
            expect(res1).toHaveLength(1);
            expect(res1[0].card_id).toBe('c1');

            // Reset reads for the next search
            mockedFs.readFileSync
                .mockReturnValueOnce(
                    JSON.stringify(buildMockVocabularyJSON([card1]))
                )
                .mockReturnValueOnce(
                    JSON.stringify(buildMockVocabularyJSON([card2]))
                );

            // Search by translation
            const res2 = vocabularyService.searchVocabulary('chó');
            expect(res2).toHaveLength(1);
            expect(res2[0].card_id).toBe('c2');
        });

        it('should search only in the specified file if fileName is provided', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON([card1, card2]))
            );

            const res = vocabularyService.searchVocabulary('cat', 'set1');
            expect(res).toHaveLength(1);
            expect(res[0].card_id).toBe('c1');
            expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);
            expect(mockedFs.readFileSync).toHaveBeenCalledWith(
                expect.stringContaining('set1.json'),
                'utf-8'
            );
        });

        it('should match search term in explanation (en and vi)', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON([card1, card2]))
            );

            // Match en explanation
            const res1 = vocabularyService.searchVocabulary(
                'domesticated',
                'set1'
            );
            expect(res1).toHaveLength(1);

            // Match vi explanation
            const res2 = vocabularyService.searchVocabulary(
                'trông nhà',
                'set1'
            );
            expect(res2).toHaveLength(1);
            expect(res2[0].card_id).toBe('c2');
        });

        it('should handle non-existent file in search gracefully', () => {
            mockedFs.existsSync.mockReturnValue(false);
            const res = vocabularyService.searchVocabulary(
                'cat',
                'nonexistent'
            );
            expect(res).toEqual([]);
        });

        it('should handle errors during search gracefully and return []', () => {
            mockedFs.readdirSync.mockImplementation(() => {
                throw new Error('Disk error');
            });

            const consoleSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const res = vocabularyService.searchVocabulary('cat');
            expect(res).toEqual([]);
            expect(consoleSpy).toHaveBeenCalledWith(
                'Error searching vocabulary:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });

        it('should skip files with invalid format during search', () => {
            mockedFs.readdirSync.mockReturnValue(['invalid.json'] as any);
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({}));

            const res = vocabularyService.searchVocabulary('cat');
            expect(res).toEqual([]);
        });
    });

    // ──────────────────────────────────────────────
    // getVocabularyWordById()
    // ──────────────────────────────────────────────
    describe('getVocabularyWordById', () => {
        const card1 = buildMockVocabularyWord({ card_id: 'c1', word: 'apple' });
        const card2 = buildMockVocabularyWord({
            card_id: 'c2',
            word: 'banana',
        });

        it('should return the word if found in one of the files', () => {
            mockedFs.readdirSync.mockReturnValue([
                'set1.json',
                'set2.json',
            ] as any);
            mockedFs.readFileSync
                .mockReturnValueOnce(
                    JSON.stringify(buildMockVocabularyJSON([card1]))
                )
                .mockReturnValueOnce(
                    JSON.stringify(buildMockVocabularyJSON([card2]))
                );

            const res = vocabularyService.getVocabularyWordById('c2');
            expect(res).toEqual(card2);
        });

        it('should return null if the word is not found in any file', () => {
            mockedFs.readdirSync.mockReturnValue(['set1.json'] as any);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON([card1]))
            );

            const res = vocabularyService.getVocabularyWordById('c3');
            expect(res).toBeNull();
        });

        it('should handle errors gracefully and return null', () => {
            mockedFs.readdirSync.mockImplementation(() => {
                throw new Error('Read error');
            });

            const consoleSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const res = vocabularyService.getVocabularyWordById('c1');
            expect(res).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith(
                'Error getting vocabulary word:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });

        it('should skip files with invalid format when getting word by ID', () => {
            mockedFs.readdirSync.mockReturnValue(['invalid.json'] as any);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({}));

            const res = vocabularyService.getVocabularyWordById('c1');
            expect(res).toBeNull();
        });
    });

    // ──────────────────────────────────────────────
    // getVocabularyWordsBySet()
    // ──────────────────────────────────────────────
    describe('getVocabularyWordsBySet', () => {
        const cards = [
            buildMockVocabularyWord({ card_id: 'c1' }),
            buildMockVocabularyWord({ card_id: 'c2' }),
        ];

        it('should return all words in the set if file exists and format is valid', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON(cards))
            );

            const res = vocabularyService.getVocabularyWordsBySet('fruits');
            expect(res).toEqual(cards);
        });

        it('should return [] if file does not exist', () => {
            mockedFs.existsSync.mockReturnValue(false);
            const res =
                vocabularyService.getVocabularyWordsBySet('nonexistent');
            expect(res).toEqual([]);
        });

        it('should return [] if cards property is missing in JSON', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify({ status: 'ok' })
            );

            const res = vocabularyService.getVocabularyWordsBySet('invalid');
            expect(res).toEqual([]);
        });

        it('should handle errors gracefully and return []', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockImplementation(() => {
                throw new Error('Read failed');
            });

            const consoleSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const res = vocabularyService.getVocabularyWordsBySet('fruits');
            expect(res).toEqual([]);
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    // ──────────────────────────────────────────────
    // Caching behavior in production environment
    // ──────────────────────────────────────────────
    describe('Caching behavior in production environment', () => {
        let originalNodeEnv: string | undefined;

        beforeAll(() => {
            originalNodeEnv = process.env.NODE_ENV;
        });

        afterAll(() => {
            process.env.NODE_ENV = originalNodeEnv;
        });

        beforeEach(() => {
            process.env.NODE_ENV = 'production';
            (vocabularyService as any).cacheAllSets = null;
            (vocabularyService as any).cacheWordsBySet.clear();
        });

        it('should cache words by set and all sets in production mode', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readdirSync.mockReturnValue(['cached_set.json'] as any);

            const card = buildMockVocabularyWord({
                card_id: 'c1',
                group_name: 'Cached Group',
                deck_name: 'Cached Deck',
                group_id: 'cg1',
                deck_id: 'cd1',
            });

            mockedFs.readFileSync.mockReturnValue(
                JSON.stringify(buildMockVocabularyJSON([card]))
            );

            const sets1 = vocabularyService.getAllVocabularySets();
            expect(sets1).toHaveLength(1);
            expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);

            mockedFs.readFileSync.mockClear();
            const sets2 = vocabularyService.getAllVocabularySets();
            expect(sets2).toEqual(sets1);
            expect(mockedFs.readFileSync).not.toHaveBeenCalled();

            mockedFs.readFileSync.mockClear();
            const words = (vocabularyService as any).getOrLoadWordsBySet(
                'cached_set'
            );
            expect(words).toHaveLength(1);
            expect(mockedFs.readFileSync).not.toHaveBeenCalled();
        });
    });
});
