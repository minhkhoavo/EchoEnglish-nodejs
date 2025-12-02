import { Request, Response } from 'express';
import ApiResponse from '../dto/response/apiResponse.js';
import vocabularyService from '../services/vocabularyService.js';
import FlashCardService from '../services/flashcardService.js';
import dictionaryService from '../services/dictionaryService.js';
import { SuccessMessage } from '../enum/successMessage.js';
import { ApiError } from '../middleware/apiError.js';

class VocabularyController {
    /**
     * Get all vocabulary sets
     * GET /vocabulary/sets
     */
    public getAllSets = async (req: Request, res: Response) => {
        const sets = vocabularyService.getAllVocabularySets();
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, sets));
    };

    /**
     * Get words from a specific vocabulary set
     * GET /vocabulary/sets/:fileName/words?page=1&limit=20&importStatus=all
     */
    public getWordsBySet = async (req: Request, res: Response) => {
        const userId =
            req.user?.id || (req as unknown as { userId: string }).userId;
        const { fileName } = req.params;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const importStatus = (req.query.importStatus as string) || 'all';

        try {
            const result = await vocabularyService.getVocabularyWords(
                fileName,
                page,
                limit,
                userId,
                importStatus as 'all' | 'imported' | 'not-imported'
            );
            return res
                .status(200)
                .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
        } catch (error) {
            if (error instanceof Error) {
                throw new ApiError({ message: error.message });
            }
            throw error;
        }
    };

    /**
     * Search vocabulary words
     * GET /vocabulary/search?q=hello&fileName=job
     */
    public searchWords = async (req: Request, res: Response) => {
        const searchTerm = req.query.q as string;
        const fileName = req.query.fileName as string;

        if (!searchTerm) {
            throw new ApiError({ message: 'Search term is required' });
        }

        const results = vocabularyService.searchVocabulary(
            searchTerm,
            fileName
        );
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, results));
    };

    /**
     * Get a specific vocabulary word by card_id
     * GET /api/vocabulary/words/:cardId
     */
    public getWordById = async (req: Request, res: Response) => {
        const { cardId } = req.params;

        const word = vocabularyService.getVocabularyWordById(cardId);

        if (!word) {
            throw new ApiError({ message: 'Vocabulary word not found' });
        }

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, word));
    };

    /**
     * Import a vocabulary word to personal flashcards
     * POST /vocabulary/import
     * Body: { cardId: string, categoryId?: string, difficulty?: string }
     */
    public importToFlashcard = async (req: Request, res: Response) => {
        const userId =
            req.user?.id || (req as unknown as { userId: string }).userId;
        if (!userId) {
            throw new ApiError({ message: 'Unauthorized' });
        }
        const { cardId, categoryId, difficulty } = req.body;

        if (!cardId) {
            throw new ApiError({ message: 'Card ID is required' });
        }

        // Get vocabulary word
        const vocabWord = vocabularyService.getVocabularyWordById(cardId);
        if (!vocabWord) {
            throw new ApiError({ message: 'Vocabulary word not found' });
        }

        // Check if already imported (by source containing card_id)
        const existingFlashcards =
            await FlashCardService.getAllFlashcard(userId);
        const flashcardsArray = Array.isArray(existingFlashcards)
            ? existingFlashcards
            : existingFlashcards.flashcards || [];
        const alreadyExists = flashcardsArray.some(
            (card: { front: string; source?: string }) =>
                card.source?.includes(`(${vocabWord.card_id})`)
        );

        if (alreadyExists) {
            return res
                .status(409)
                .json(
                    new ApiResponse(
                        'This word has already been imported to your flashcards',
                        { alreadyImported: true }
                    )
                );
        }

        // Create flashcard from vocabulary word
        const flashcardData = {
            front: vocabWord.word,
            back:
                vocabWord.translation?.vi ||
                vocabWord.explanation?.vi ||
                vocabWord.explanation?.en ||
                '',
            category: categoryId,
            difficulty: (difficulty || vocabWord.difficulty || 'Medium') as
                | 'Easy'
                | 'Medium'
                | 'Hard',
            tags: [vocabWord.type].filter(Boolean), // Word type (noun, verb, etc.)
            source: `Vocabulary Library - ${vocabWord.group_name} (${vocabWord.card_id})`, // Source with card ID for tracking
            isAIGenerated: false,
            level_memory: 0, // Start at level 0 for spaced repetition
            reviewCount: 0,
        };

        const flashcard = await FlashCardService.createFlashcard(
            flashcardData,
            userId
        );

        return res
            .status(201)
            .json(
                new ApiResponse(
                    'Vocabulary word imported to flashcards successfully',
                    flashcard
                )
            );
    };

    /**
     * Bulk import vocabulary words to flashcards
     * POST /vocabulary/bulk-import
     * Body: { fileName: string, categoryId?: string }
     */
    public bulkImportToFlashcards = async (req: Request, res: Response) => {
        const userId =
            req.user?.id || (req as unknown as { userId: string }).userId;
        if (!userId) {
            throw new ApiError({ message: 'Unauthorized' });
        }
        const { fileName, categoryId } = req.body;

        if (!fileName) {
            throw new ApiError({ message: 'File name is required' });
        }

        // Get all words from the vocabulary set
        const allWords = vocabularyService.getVocabularyWordsBySet(fileName);

        if (!allWords || allWords.length === 0) {
            throw new ApiError({
                message: 'No words found in this vocabulary set',
            });
        }

        // Get existing flashcards once for efficiency
        const existingFlashcards =
            await FlashCardService.getAllFlashcard(userId);
        const flashcardsArray = Array.isArray(existingFlashcards)
            ? existingFlashcards
            : existingFlashcards.flashcards || [];
        // Extract card IDs from source field
        // (format: "Vocabulary Library - Family (card_id)")
        const existingCardIds = new Set(
            flashcardsArray
                .filter((card: { source?: string }) =>
                    card.source?.includes('Vocabulary Library')
                )
                .map((card: { source?: string }) => {
                    const match = card.source?.match(/\(([^)]+)\)$/);
                    // Regex /\(([^)]+)\)$/ tìm kiếm cặp ngoặc đơn cuối cùng và
                    // lấy nội dung bên trong
                    return match ? match[1] : null;
                    // Trả về card_id hoặc null nếu không khớp
                })
                .filter(Boolean)
        );

        const flashcardsToCreate = [];
        let skippedCount = 0;

        for (const vocabWord of allWords) {
            // Skip if word already exists (check by card_id)
            if (existingCardIds.has(vocabWord.card_id)) {
                skippedCount++;
                continue;
            }

            flashcardsToCreate.push({
                front: vocabWord.word,
                back:
                    vocabWord.translation?.vi ||
                    vocabWord.explanation?.vi ||
                    vocabWord.explanation?.en ||
                    '',
                category: categoryId,
                difficulty: (vocabWord.difficulty || 'Medium') as
                    | 'Easy'
                    | 'Medium'
                    | 'Hard',
                tags: [vocabWord.type].filter(Boolean), // Word type only
                source: `Vocabulary Library - ${vocabWord.group_name} (${vocabWord.card_id})`, // Source with card ID
                isAIGenerated: false,
                level_memory: 0,
                reviewCount: 0,
            });
        }

        if (flashcardsToCreate.length === 0) {
            return res.status(200).json(
                new ApiResponse(
                    `All ${skippedCount} words from this set already exist in your flashcards`,
                    {
                        imported: 0,
                        skipped: skippedCount,
                        flashcards: [],
                    }
                )
            );
        }

        const flashcards = await FlashCardService.bulkCreateFlashcards(
            flashcardsToCreate,
            userId
        );

        return res.status(200).json(
            new ApiResponse(
                `Successfully imported ${flashcards.length} words to flashcards${skippedCount > 0 ? ` (${skippedCount} already existed)` : ''}`,
                {
                    imported: flashcards.length,
                    skipped: skippedCount,
                    flashcards,
                }
            )
        );
    };

    /**
     * Get phonetics for a word (auto-fill helper)
     * GET /vocabulary/phonetics/:word
     */
    public getPhonetics = async (req: Request, res: Response) => {
        const { word } = req.params;

        if (!word || word.trim().length === 0) {
            throw new ApiError({ message: 'Word parameter is required' });
        }

        const phonetics = await dictionaryService.getPhonetics(word);

        return res.status(200).json(
            new ApiResponse('Phonetics retrieved successfully', {
                word,
                phonetics,
                formatted: dictionaryService.getFirstPhonetic(phonetics),
            })
        );
    };
}

export default new VocabularyController();
