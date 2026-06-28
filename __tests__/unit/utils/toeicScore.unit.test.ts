import computeToeicScores, { determineToeicLevel } from '~/utils/toeicScore.js';

describe('toeicScore', () => {
    describe('computeToeicScores', () => {
        it('should compute scores correctly for boundaries', () => {
            const result = computeToeicScores(0, 0);
            expect(result).toEqual({
                listeningScore: 5,
                readingScore: 5,
                totalScore: 10,
            });

            const resultMax = computeToeicScores(100, 100);
            expect(resultMax).toEqual({
                listeningScore: 495,
                readingScore: 495,
                totalScore: 990,
            });
        });

        it('should handle out of bound values', () => {
            const resultOut = computeToeicScores(-10, 150);
            expect(resultOut).toEqual({
                listeningScore: 5,
                readingScore: 495,
                totalScore: 500,
            });
        });

        it('should handle decimal values by rounding', () => {
            const result = computeToeicScores(17.5, 17.5);
            // Math.round(17.5) is 18
            // listeningScoreMap[18] = 10, readingScoreMap[18] = 5
            expect(result).toEqual({
                listeningScore: 10,
                readingScore: 5,
                totalScore: 15,
            });
        });
    });

    describe('determineToeicLevel', () => {
        it('should determine correct level based on score', () => {
            expect(determineToeicLevel(399)).toBe('beginner');
            expect(determineToeicLevel(400)).toBe('intermediate');
            expect(determineToeicLevel(699)).toBe('intermediate');
            expect(determineToeicLevel(700)).toBe('upper_intermediate');
            expect(determineToeicLevel(849)).toBe('upper_intermediate');
            expect(determineToeicLevel(850)).toBe('advanced');
            expect(determineToeicLevel(990)).toBe('advanced');
        });
    });
});
