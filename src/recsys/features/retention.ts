/**
 * Forgetting curve for flashcard prioritisation.
 *
 * Power-law retrievability as used by FSRS:  R(t, S) = (1 + F·t/S)^(−d),  F = 0.9^(−1/d) − 1,
 * so that R(S, S) = 0.9 (stability S == interval at which recall probability is 90%).
 * With d = 0.5 → F = 19/81 (FSRS-4.5/5 constants; FSRS-6 makes d trainable per user).
 *
 * We map the existing Leitner level to a stability equal to its scheduled interval, so no
 * schema change is needed. When FSRS is adopted (Phase 2) S comes from the card state instead.
 */
export const DECAY = 0.5;
export const FACTOR = Math.pow(0.9, -1 / DECAY) - 1;
export const LEITNER_INTERVAL_DAYS = [1, 1, 3, 7, 14, 30]; // level 0 treated like a 1-day card

export function stabilityDays(level: number): number {
    const l = Math.min(5, Math.max(0, Math.floor(level)));
    return LEITNER_INTERVAL_DAYS[l];
}

export function retrievability(elapsedDays: number, stability: number): number {
    if (elapsedDays <= 0) return 1;
    return Math.pow(
        1 + (FACTOR * elapsedDays) / Math.max(0.01, stability),
        -DECAY
    );
}

export interface CardLike {
    level_memory?: number | null;
    nextReviewDate?: Date | null;
    lastReviewDate?: Date | null;
    createdAt?: Date | null;
}

export interface CardRetention {
    isNew: boolean;
    due: boolean;
    overdueDays: number;
    retrievability: number;
}

export function cardRetention(c: CardLike, now: Date): CardRetention {
    const level = c.level_memory ?? 0;
    const reviewed = c.lastReviewDate ?? null;
    const due =
        !c.nextReviewDate || c.nextReviewDate.getTime() <= now.getTime();
    const overdueDays = c.nextReviewDate
        ? Math.max(0, (now.getTime() - c.nextReviewDate.getTime()) / 86_400_000)
        : 0;
    if (!reviewed) {
        return { isNew: true, due, overdueDays, retrievability: 1 };
    }
    const elapsed = (now.getTime() - reviewed.getTime()) / 86_400_000;
    return {
        isNew: false,
        due,
        overdueDays,
        retrievability: retrievability(elapsed, stabilityDays(level)),
    };
}
