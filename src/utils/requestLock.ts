const locks = new Map<string, number>();
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function acquireLock(key: string): boolean {
    const acquiredAt = locks.get(key);
    if (acquiredAt !== undefined && Date.now() - acquiredAt < LOCK_TTL_MS) {
        return false;
    }
    locks.set(key, Date.now());
    return true;
}

export function releaseLock(key: string): void {
    locks.delete(key);
}
