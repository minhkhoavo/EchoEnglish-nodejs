/* eslint-disable @typescript-eslint/no-explicit-any */
import { validateDob } from '~/utils/validation/validate.js';

describe('validateDob', () => {
    it('should return true if no value provided', () => {
        expect(validateDob(null as any)).toBe(true);
        expect(validateDob(undefined as any)).toBe(true);
    });

    it('should return true if age >= 6', () => {
        const date = new Date();
        date.setFullYear(date.getFullYear() - 7);
        expect(validateDob(date)).toBe(true);
    });

    it('should return false if age < 6 (birthday not passed this year)', () => {
        const date = new Date();
        date.setFullYear(date.getFullYear() - 6);
        date.setDate(date.getDate() + 1); // Birthday is tomorrow, so age is 5
        expect(validateDob(date)).toBe(false);
    });

    it('should return true if age exactly 6 (birthday passed this year)', () => {
        const date = new Date();
        date.setFullYear(date.getFullYear() - 6);
        date.setDate(date.getDate() - 1); // Birthday was yesterday, so age is 6
        expect(validateDob(date)).toBe(true);
    });

    it('should return false if age is clearly < 6', () => {
        const date = new Date();
        date.setFullYear(date.getFullYear() - 5);
        expect(validateDob(date)).toBe(false);
    });
});
