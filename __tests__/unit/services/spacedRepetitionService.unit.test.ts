import spacedRepetitionService from '~/services/spacedRepetitionService.js';

describe('SpacedRepetitionService', () => {
    // ──────────────────────────────────────────────
    // calculateNextReview()
    // ──────────────────────────────────────────────
    describe('calculateNextReview', () => {
        it('should move up one level (up to level 5) when user remembers the card', () => {
            const intervals = [1, 3, 7, 14, 30]; // level 1 to 5 intervals

            for (let currentLevel = 0; currentLevel <= 5; currentLevel++) {
                const result = spacedRepetitionService.calculateNextReview(
                    currentLevel,
                    { remember: true }
                );
                const expectedLevel = Math.min(currentLevel + 1, 5);
                expect(result.level_memory).toBe(expectedLevel);

                // Verify review date calculation
                const expectedDays =
                    currentLevel === 0
                        ? 1
                        : expectedLevel === 5
                          ? 30
                          : intervals[expectedLevel - 1];
                const expectedDate = new Date();
                expectedDate.setDate(expectedDate.getDate() + expectedDays);
                expectedDate.setHours(0, 0, 0, 0);

                expect(result.nextReviewDate.getTime()).toBe(
                    expectedDate.getTime()
                );
            }
        });

        it('should reset to level 1 when user forgets the card (from any level)', () => {
            for (let currentLevel = 0; currentLevel <= 5; currentLevel++) {
                const result = spacedRepetitionService.calculateNextReview(
                    currentLevel,
                    { remember: false }
                );
                expect(result.level_memory).toBe(1);

                // Verify review date is exactly 1 day from now
                const expectedDate = new Date();
                expectedDate.setDate(expectedDate.getDate() + 1);
                expectedDate.setHours(0, 0, 0, 0);

                expect(result.nextReviewDate.getTime()).toBe(
                    expectedDate.getTime()
                );
            }
        });
    });

    // ──────────────────────────────────────────────
    // isDueForReview()
    // ──────────────────────────────────────────────
    describe('isDueForReview', () => {
        it('should return true if nextReviewDate is null or undefined', () => {
            expect(spacedRepetitionService.isDueForReview(null)).toBe(true);
            expect(spacedRepetitionService.isDueForReview(undefined)).toBe(
                true
            );
        });

        it('should return true if nextReviewDate is in the past', () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 1);
            expect(spacedRepetitionService.isDueForReview(pastDate)).toBe(true);
        });

        it('should return true if nextReviewDate is today', () => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            expect(spacedRepetitionService.isDueForReview(today)).toBe(true);
        });

        it('should return false if nextReviewDate is in the future', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            expect(spacedRepetitionService.isDueForReview(futureDate)).toBe(
                false
            );
        });
    });

    // ──────────────────────────────────────────────
    // calculateProgress()
    // ──────────────────────────────────────────────
    describe('calculateProgress', () => {
        it('should return correct default statistics for an empty cards list', () => {
            const result = spacedRepetitionService.calculateProgress([]);
            expect(result).toEqual({
                total: 0,
                byLevel: {
                    level0: 0,
                    level1: 0,
                    level2: 0,
                    level3: 0,
                    level4: 0,
                    level5: 0,
                },
                dueForReview: 0,
                percentMastered: 0,
            });
        });

        it('should correctly partition and count cards at each level', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 10);

            const cards = [
                { level_memory: 0 }, // Level 0 (due)
                { level_memory: 1, nextReviewDate: futureDate }, // Level 1 (not due)
                { level_memory: 2 }, // Level 2 (due)
                { level_memory: 3, nextReviewDate: futureDate }, // Level 3 (not due)
                { level_memory: 4 }, // Level 4 (due)
                { level_memory: 5, nextReviewDate: futureDate }, // Level 5 (not due)
                { level_memory: 5 }, // Level 5 (due)
            ];

            const result = spacedRepetitionService.calculateProgress(cards);
            expect(result.total).toBe(7);
            expect(result.byLevel).toEqual({
                level0: 1,
                level1: 1,
                level2: 1,
                level3: 1,
                level4: 1,
                level5: 2,
            });
            expect(result.dueForReview).toBe(4); // 0, 2, 4, and one of the 5s
            expect(result.percentMastered).toBe(29); // 2 out of 7 ~ 28.57% -> 29%
        });

        it('should assume level 0 if card has level_memory undefined', () => {
            const cards = [{ level_memory: undefined }];
            const result = spacedRepetitionService.calculateProgress(cards);
            expect(result.byLevel.level0).toBe(1);
        });
    });

    // ──────────────────────────────────────────────
    // getRecommendedDailyLimit()
    // ──────────────────────────────────────────────
    describe('getRecommendedDailyLimit', () => {
        it('should return 50 if dueCards > 50', () => {
            expect(spacedRepetitionService.getRecommendedDailyLimit(100)).toBe(
                50
            );
            expect(spacedRepetitionService.getRecommendedDailyLimit(51)).toBe(
                50
            );
        });

        it('should return 30 if 30 < dueCards <= 50', () => {
            expect(spacedRepetitionService.getRecommendedDailyLimit(50)).toBe(
                30
            );
            expect(spacedRepetitionService.getRecommendedDailyLimit(31)).toBe(
                30
            );
        });

        it('should return dueCards if dueCards <= 20', () => {
            expect(spacedRepetitionService.getRecommendedDailyLimit(15)).toBe(
                15
            );
            expect(spacedRepetitionService.getRecommendedDailyLimit(0)).toBe(0);
        });

        it('should return 20 if 20 < dueCards <= 30', () => {
            expect(spacedRepetitionService.getRecommendedDailyLimit(30)).toBe(
                20
            );
            expect(spacedRepetitionService.getRecommendedDailyLimit(21)).toBe(
                20
            );
        });
    });
});
