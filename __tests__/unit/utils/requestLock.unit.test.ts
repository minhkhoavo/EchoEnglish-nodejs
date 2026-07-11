import { acquireLock, releaseLock } from '~/utils/requestLock.js';

describe('requestLock', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('should acquire lock successfully and reject concurrent requests', () => {
        const key = 'test-lock-1';
        try {
            expect(acquireLock(key)).toBe(true);
            expect(acquireLock(key)).toBe(false); // Reject concurrent
        } finally {
            releaseLock(key);
        }
    });

    it('should allow acquiring lock again after release', () => {
        const key = 'test-lock-2';
        expect(acquireLock(key)).toBe(true);
        releaseLock(key);
        expect(acquireLock(key)).toBe(true);
        releaseLock(key);
    });

    it('should allow acquiring lock after TTL expires', () => {
        const key = 'test-lock-3';
        jest.useFakeTimers();

        expect(acquireLock(key)).toBe(true);

        // Advance time by 6 minutes (TTL is 5 minutes)
        jest.advanceTimersByTime(6 * 60 * 1000);

        expect(acquireLock(key)).toBe(true);
        releaseLock(key);
    });
});
