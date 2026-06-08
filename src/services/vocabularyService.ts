import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to vocabulary JSON files
const VOCABULARY_DIR = path.join(__dirname, '..', '..', 'vocabulary');

export interface VocabularyWord {
    card_id: string;
    word: string;
    explanation: {
        en?: string;
        vi?: string;
        th?: string;
        id?: string;
        ar?: string;
    };
    translation: {
        vi?: string;
        th?: string;
        id?: string;
        ar?: string;
    };
    type: string;
    phonetics: Array<{
        text: string;
        audio: string;
        locale: string;
    }>;
    example: {
        en?: string;
        vi?: string;
        th?: string;
        id?: string;
        ar?: string;
    };
    image_url: string;
    notes: string;
    difficulty: string;
    group_id: string;
    group_name: string;
    deck_id: string;
    deck_name: string;
}

export interface VocabularySet {
    fileName: string;
    name: string;
    description: string;
    wordCount: number;
    group_id: string;
    group_name: string;
    deck_id: string;
    deck_name: string;
}

interface VocabularyJSON {
    status: string;
    message: string;
    data: {
        cards: VocabularyWord[];
    };
}

class VocabularyService {
    /**
     * Get list of all available vocabulary sets
     */
    public getAllVocabularySets = (): VocabularySet[] => {
        try {
            if (!fs.existsSync(VOCABULARY_DIR)) {
                return [];
            }

            const files = fs
                .readdirSync(VOCABULARY_DIR)
                .filter((file) => file.endsWith('.json'));

            const sets: VocabularySet[] = [];

            for (const file of files) {
                const filePath = path.join(VOCABULARY_DIR, file);
                const jsonData: VocabularyJSON = JSON.parse(
                    fs.readFileSync(filePath, 'utf-8')
                );

                if (
                    jsonData.data &&
                    jsonData.data.cards &&
                    jsonData.data.cards.length > 0
                ) {
                    const firstCard = jsonData.data.cards[0];

                    sets.push({
                        fileName: path.basename(file, '.json'),
                        name:
                            firstCard.group_name ||
                            path.basename(file, '.json'),
                        description: firstCard.deck_name || '',
                        wordCount: jsonData.data.cards.length,
                        group_id: firstCard.group_id,
                        group_name: firstCard.group_name,
                        deck_id: firstCard.deck_id,
                        deck_name: firstCard.deck_name,
                    });
                }
            }

            return sets;
        } catch (error) {
            console.error('Error reading vocabulary sets:', error);
            return [];
        }
    };

    /**
     * Get words from a specific vocabulary set with pagination
     * @param fileName - Name of the JSON file (without .json extension)
     * @param page - Page number (1-indexed)
     * @param limit - Number of items per page
     * @param userId - User ID to check import status
     * @param importStatus - Filter by import status: 'all', 'imported', 'not-imported'
     */
    public getVocabularyWords = async (
        fileName: string,
        page: number = 1,
        limit: number = 20,
        userId?: string,
        importStatus: 'all' | 'imported' | 'not-imported' = 'all'
    ): Promise<{
        words: VocabularyWord[];
        pagination: {
            currentPage: number;
            totalPages: number;
            totalWords: number;
            limit: number;
        };
    }> => {
        const filePath = path.join(VOCABULARY_DIR, `${fileName}.json`);

        if (!fs.existsSync(filePath)) {
            throw new Error('Vocabulary set not found');
        }

        const jsonData: VocabularyJSON = JSON.parse(
            fs.readFileSync(filePath, 'utf-8')
        );

        if (!jsonData.data || !jsonData.data.cards) {
            throw new Error('Invalid vocabulary file format');
        }

        let allWords = jsonData.data.cards;

        // Filter by import status if userId is provided
        if (userId && importStatus !== 'all') {
            const FlashCardService = (await import('./flashcardService.js'))
                .default;
            const existingFlashcards =
                await FlashCardService.getAllFlashcard(userId);
            const flashcardsArray = Array.isArray(existingFlashcards)
                ? existingFlashcards
                : existingFlashcards.flashcards || [];

            // Extract imported card IDs
            const importedCardIds = new Set(
                flashcardsArray
                    .filter((card: { source?: string }) =>
                        card.source?.includes('Vocabulary Library')
                    )
                    .map((card: { source?: string }) => {
                        const match = card.source?.match(/\(([^)]+)\)$/);
                        return match ? match[1] : null;
                    })
                    .filter(Boolean)
            );

            // Filter words based on import status
            if (importStatus === 'imported') {
                allWords = allWords.filter((word) =>
                    importedCardIds.has(word.card_id)
                );
            } else if (importStatus === 'not-imported') {
                allWords = allWords.filter(
                    (word) => !importedCardIds.has(word.card_id)
                );
            }
        }

        const totalWords = allWords.length;
        const totalPages = Math.ceil(totalWords / limit);
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedWords = allWords.slice(startIndex, endIndex);

        return {
            words: paginatedWords,
            pagination: {
                currentPage: page,
                totalPages,
                totalWords,
                limit,
            },
        };
    };

    /**
     * Search words across all vocabulary sets or within a specific set
     * @param searchTerm - Search term for word or translation
     * @param fileName - Optional: specific file to search in
     */
    public searchVocabulary = (
        searchTerm: string,
        fileName?: string
    ): VocabularyWord[] => {
        try {
            const files = fileName
                ? [`${fileName}.json`]
                : fs
                      .readdirSync(VOCABULARY_DIR)
                      .filter((file) => file.endsWith('.json'));

            const results: VocabularyWord[] = [];
            const searchLower = searchTerm.toLowerCase();

            for (const file of files) {
                const filePath = path.join(VOCABULARY_DIR, file);

                if (!fs.existsSync(filePath)) continue;

                const jsonData: VocabularyJSON = JSON.parse(
                    fs.readFileSync(filePath, 'utf-8')
                );

                if (jsonData.data && jsonData.data.cards) {
                    const matchedWords = jsonData.data.cards.filter(
                        (card) =>
                            card.word.toLowerCase().includes(searchLower) ||
                            card.translation?.vi
                                ?.toLowerCase()
                                .includes(searchLower) ||
                            card.explanation?.vi
                                ?.toLowerCase()
                                .includes(searchLower) ||
                            card.explanation?.en
                                ?.toLowerCase()
                                .includes(searchLower)
                    );

                    results.push(...matchedWords);
                }
            }

            return results;
        } catch (error) {
            console.error('Error searching vocabulary:', error);
            return [];
        }
    };

    /**
     * Get a single vocabulary word by card_id
     * @param cardId - Card ID to search for
     */
    public getVocabularyWordById = (cardId: string): VocabularyWord | null => {
        try {
            const files = fs
                .readdirSync(VOCABULARY_DIR)
                .filter((file) => file.endsWith('.json'));

            for (const file of files) {
                const filePath = path.join(VOCABULARY_DIR, file);
                const jsonData: VocabularyJSON = JSON.parse(
                    fs.readFileSync(filePath, 'utf-8')
                );

                if (jsonData.data && jsonData.data.cards) {
                    const word = jsonData.data.cards.find(
                        (card) => card.card_id === cardId
                    );
                    if (word) return word;
                }
            }

            return null;
        } catch (error) {
            console.error('Error getting vocabulary word:', error);
            return null;
        }
    };

    /**
     * Get all words from a specific vocabulary set (for bulk import, without pagination)
     * @param fileName - Name of the JSON file (without .json extension)
     */
    public getVocabularyWordsBySet = (fileName: string): VocabularyWord[] => {
        try {
            const filePath = path.join(VOCABULARY_DIR, `${fileName}.json`);

            if (!fs.existsSync(filePath)) {
                return [];
            }

            const jsonData: VocabularyJSON = JSON.parse(
                fs.readFileSync(filePath, 'utf-8')
            );

            if (!jsonData.data || !jsonData.data.cards) {
                return [];
            }

            return jsonData.data.cards;
        } catch (error) {
            console.error('Error getting vocabulary words by set:', error);
            return [];
        }
    };
}

export default new VocabularyService();
