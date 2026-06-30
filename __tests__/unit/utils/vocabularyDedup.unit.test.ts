/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import {
    normalizeVocabTerm,
    getSavedFlashcardTerms,
    filterDuplicateVocabulary,
} from '~/utils/vocabularyDedup.js';
import { Flashcard } from '~/models/flashcardModel.js';
import { Types } from 'mongoose';

jest.mock('~/models/flashcardModel.js');

describe('vocabularyDedup', () => {
    describe('normalizeVocabTerm', () => {
        it('should trim, lowercase and reduce spaces', () => {
            expect(normalizeVocabTerm('  HELLO   world  ')).toBe('hello world');
        });
        it('should return empty string for nullish values', () => {
            expect(normalizeVocabTerm(null as any)).toBe('');
            expect(normalizeVocabTerm(undefined as any)).toBe('');
        });
    });

    describe('getSavedFlashcardTerms', () => {
        const mockedFlashcard = Flashcard as jest.Mocked<typeof Flashcard>;

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should fetch and normalize existing flashcard fronts', async () => {
            (mockedFlashcard.find as any) = jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest
                    .fn()
                    .mockResolvedValue([
                        { front: 'apple' },
                        { front: 'Banana ' },
                        {},
                        { front: '' },
                    ]),
            });

            const terms = await getSavedFlashcardTerms('mock-object-id');
            expect(terms).toEqual(['apple', 'Banana ']);
        });
    });

    describe('filterDuplicateVocabulary', () => {
        it('should filter out duplicates and existing terms', () => {
            const existingTerms = new Set(['apple', 'orange', '  ']);
            const newWords = [
                { word: 'Apple ' }, // Duplicate with existing
                { word: 'banana' }, // Unique
                { word: 'grape' }, // Unique
                { word: ' Banana' }, // Duplicate within new Words
                { word: '  ' }, // Empty string
            ];

            const result = filterDuplicateVocabulary(newWords, existingTerms);
            expect(result).toEqual([{ word: 'banana' }, { word: 'grape' }]);
        });

        it('should handle undefined or null newWords', () => {
            const result = filterDuplicateVocabulary(
                undefined as any,
                new Set()
            );
            expect(result).toEqual([]);
        });
    });
});
