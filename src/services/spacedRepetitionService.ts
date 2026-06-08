/**
 * Leitner Box System là hệ thống ôn flashcard bằng nhiều level.
 * Ở phiên bản này có 6 level (0→5). Nếu nhớ thì tăng +1 level, nếu quên
 * thì đưa về level 1. Level càng cao thì thời gian ôn lại càng lâu.
 *
 * Level Memory System:
 * - Level 0: New card (review immediately)
 * - Level 1: 1 day
 * - Level 2: 3 days
 * - Level 3: 7 days
 * - Level 4: 14 days
 * - Level 5: 30 days (mastered)
 */

export interface ReviewResult {
    remember: boolean; // true = remembered, false = forgot
}

export interface ReviewSchedule {
    nextReviewDate: Date;
    level_memory: number;
}

class SpacedRepetitionService {
    // Interval multipliers for each level (in days)
    private readonly INTERVALS = [0, 1, 3, 7, 14, 30];

    /**
     * Calculate next review schedule based on user's performance
     * Uses Modified Leitner Box System:
     * - Remember: Move up one level (max 5)
     * - Forgot: Drop back to level 1 (fresh start, but not brand new)
     *
     * @param currentLevel - Current level_memory (0-5)
     * @param reviewResult - User's performance on this review
     * @returns New schedule with nextReviewDate and updated level_memory
     */
    public calculateNextReview = (
        currentLevel: number,
        reviewResult: ReviewResult
    ): ReviewSchedule => {
        let newLevel = currentLevel;

        // Leitner Box System Logic
        if (reviewResult.remember) {
            // Remembered: Move up one box/level (progressive learning)
            newLevel = Math.min(currentLevel + 1, 5);
        } else {
            // Forgot: Reset to level 1 (not 0, to avoid overwhelming user with "new" cards)
            // This follows Leitner principle: failed cards go back to first active box
            newLevel = 1;
        }

        // Calculate next review date
        const intervalDays = this.INTERVALS[newLevel];
        const nextReviewDate = new Date();
        nextReviewDate.setDate(nextReviewDate.getDate() + intervalDays);
        nextReviewDate.setHours(0, 0, 0, 0); // Reset to start of day

        return {
            nextReviewDate,
            level_memory: newLevel,
        };
    };

    /**
     * Check if a flashcard is due for review
     * @param nextReviewDate - Scheduled review date
     * @returns true if due for review
     */
    public isDueForReview = (
        nextReviewDate: Date | null | undefined
    ): boolean => {
        if (!nextReviewDate) return true; // Never reviewed = due

        const now = new Date();
        now.setHours(0, 0, 0, 0); // Compare dates only, not time

        return nextReviewDate <= now;
    };

    /**
     * Calculate statistics for a user's flashcard progress
     * @param flashcards - Array of flashcards with level_memory
     * @returns Statistics object
     */
    public calculateProgress = (
        flashcards: Array<{ level_memory?: number; nextReviewDate?: Date }>
    ) => {
        const total = flashcards.length;
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        const byLevel = {
            level0: 0, // New
            level1: 0, // Learning
            level2: 0, // Familiar
            level3: 0, // Good
            level4: 0, // Very Good
            level5: 0, // Mastered
        };

        let dueForReview = 0;

        for (const card of flashcards) {
            const level = card.level_memory || 0;

            // Count by individual level
            switch (level) {
                case 0:
                    byLevel.level0++;
                    break;
                case 1:
                    byLevel.level1++;
                    break;
                case 2:
                    byLevel.level2++;
                    break;
                case 3:
                    byLevel.level3++;
                    break;
                case 4:
                    byLevel.level4++;
                    break;
                case 5:
                    byLevel.level5++;
                    break;
            }

            // Check if due
            if (this.isDueForReview(card.nextReviewDate)) {
                dueForReview++;
            }
        }

        return {
            total, // Total flashcards (filtered by category and createdBy)
            byLevel, // Breakdown by level
            dueForReview, // Number of cards due for review
            percentMastered:
                total > 0 ? Math.round((byLevel.level5 / total) * 100) : 0, // Percentage mastered
        };
    };

    /**
     * Get recommended daily review limit based on user's progress
     * @param dueCards - Number of cards due for review
     * @returns Recommended number of cards to review today
     */
    public getRecommendedDailyLimit = (dueCards: number): number => {
        // Start with 20 new cards per day
        const baseLimit = 20;

        // If lots of cards are due, increase limit
        if (dueCards > 50) return 50;
        if (dueCards > 30) return 30;

        return Math.min(baseLimit, dueCards);
    };
}

export default new SpacedRepetitionService();
