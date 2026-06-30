import {
    v4,
    v1,
    v3,
    v5,
    validate,
    version,
    NIL,
    MAX,
} from '../../mocks/uuid.js';

describe('uuid mock', () => {
    it('should return string for v4', () => {
        expect(typeof v4()).toBe('string');
    });
    it('should return string for v1', () => {
        expect(typeof v1()).toBe('string');
    });
    it('should return string for v3', () => {
        expect(typeof v3()).toBe('string');
    });
    it('should return string for v5', () => {
        expect(typeof v5()).toBe('string');
    });
    it('should return true for validate', () => {
        expect(validate()).toBe(true);
    });
    it('should return 4 for version', () => {
        expect(version()).toBe(4);
    });
    it('should return NIL', () => {
        expect(NIL).toBe('00000000-0000-0000-0000-000000000000');
    });
    it('should return MAX', () => {
        expect(MAX).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff');
    });
});
