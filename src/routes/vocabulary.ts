import { Router } from 'express';
import VocabularyController from '../controllers/vocabularyController.js';

const router = Router();

// Get all vocabulary sets
router.get('/sets', VocabularyController.getAllSets);

// Get words from a specific set (with pagination)
router.get('/sets/:fileName/words', VocabularyController.getWordsBySet);

// Search vocabulary words
router.get('/search', VocabularyController.searchWords);

// Get a specific word by card_id
router.get('/words/:cardId', VocabularyController.getWordById);

// Get phonetics for auto-fill
router.get('/phonetics/:word', VocabularyController.getPhonetics);

// Import vocabulary word to personal flashcards
router.post('/import', VocabularyController.importToFlashcard);

// Bulk import vocabulary words
router.post('/bulk-import', VocabularyController.bulkImportToFlashcards);

export default router;
