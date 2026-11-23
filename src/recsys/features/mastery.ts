/**
 * Mastery model: Elo/1-PL IRT style ability per (learner, skill).
 *
 *   P(correct) = σ(θ − b)         θ = learner ability on that skill, b = item difficulty
 *   θ ← θ + K(n)·(outcome − P)    K shrinks with experience (fast start, stable later)
 *
 * Chosen over BKT for MVP: no per-skill parameter fitting, handles item difficulty,
 * trivially incremental and explainable. BKT/DKT can replace it behind the same interface
 * once there is enough data to fit (Phase 2).
 */

export interface MasteryState {
    theta: number;
    n: number;
    correct: number;
    lastPracticedAt?: Date;
}

export const THETA_MIN = -4;
export const THETA_MAX = 4;
const DIFFICULTY_B: Record<string, number> = {
    beginner: -0.7,
    intermediate: 0,
    advanced: 0.7,
};
/** θ decays toward the prior (0) with this time constant: unused skills fade. */
const DECAY_TAU_DAYS = 60;

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
export const difficultyB = (d?: string): number =>
    d ? (DIFFICULTY_B[d] ?? 0) : 0;

export const newMastery = (): MasteryState => ({ theta: 0, n: 0, correct: 0 });

export function learningRate(n: number): number {
    return Math.max(0.06, 0.5 / Math.sqrt(1 + n / 3));
}

export function updateMastery(
    s: MasteryState,
    outcome: {
        correct: boolean;
        difficulty?: string;
        at: Date;
        /** Calibrated per-question difficulty; overrides the three-level label when known. */
        b?: number;
    }
): MasteryState {
    const p = sigmoid(s.theta - (outcome.b ?? difficultyB(outcome.difficulty)));
    const theta = Math.min(
        THETA_MAX,
        Math.max(
            THETA_MIN,
            s.theta + learningRate(s.n) * ((outcome.correct ? 1 : 0) - p)
        )
    );
    return {
        theta,
        n: s.n + 1,
        correct: s.correct + (outcome.correct ? 1 : 0),
        lastPracticedAt:
            !s.lastPracticedAt || outcome.at > s.lastPracticedAt
                ? outcome.at
                : s.lastPracticedAt,
    };
}

export interface MasteryView {
    /** Probability of answering an average-difficulty item correctly, after time decay. */
    mastery: number;
    /** 0..1 – how much evidence backs the estimate. */
    confidence: number;
    daysSincePractice: number | null;
}

export function viewMastery(s: MasteryState, now: Date): MasteryView {
    const days = s.lastPracticedAt
        ? Math.max(
              0,
              (now.getTime() - s.lastPracticedAt.getTime()) / 86_400_000
          )
        : null;
    const thetaEff =
        days === null ? s.theta : s.theta * Math.exp(-days / DECAY_TAU_DAYS);
    return {
        mastery: sigmoid(thetaEff),
        confidence: 1 - Math.exp(-s.n / 10),
        daysSincePractice: days,
    };
}
