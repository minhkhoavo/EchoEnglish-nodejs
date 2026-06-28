import { Schema } from 'mongoose';
import { Flashcard } from '../models/flashcardModel.js';

/**
 * Normalize a vocabulary term for duplicate comparison (case/space-insensitive).
 */
export function normalizeVocabTerm(term: string): string {
    return (term ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Fetch the distinct vocabulary terms (flashcard fronts) the user has already
 * saved, so freshly generated vocabulary can avoid repeating them.
 */
export async function getSavedFlashcardTerms(
    userId: Schema.Types.ObjectId | string
): Promise<string[]> {
    const cards = (await Flashcard.find({ createBy: userId })
        .select('front')
        .lean()) as unknown as Array<{ front?: string }>;
    return cards.map((c) => c.front || '').filter((f) => f.length > 0);
}

/**
 * Remove generated vocabulary words that the learner already has as flashcards,
 * and drop duplicates within the generated set itself.
 */
export function filterDuplicateVocabulary<T extends { word: string }>(
    words: T[],
    existingTerms: Iterable<string>
): T[] {
    const existing = new Set<string>();
    for (const t of existingTerms) {
        const n = normalizeVocabTerm(t);
        if (n) existing.add(n);
    }

    const seen = new Set<string>();
    return (words || []).filter((w) => {
        const key = normalizeVocabTerm(w.word);
        if (!key || existing.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
