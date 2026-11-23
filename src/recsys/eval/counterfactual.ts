import { WeightSet } from '../engine/types.js';

/**
 * Counterfactual (off-policy) evaluation on REAL logs, using only the randomised slot.
 *
 * In an explored list one slot was filled uniformly at random from a logged pool. For that
 * decision the logging policy is known exactly, so the classic replay estimator (Li et al.,
 * 2011) is unbiased: keep the logs where the policy under test would have picked the same item
 * as the random draw, and average their reward. No simulator and no model of the learner.
 */
export interface ExploreLog {
    pool: Array<{ id: string; signals: Partial<Record<string, number>> }>;
    /** The item the random draw placed in the slot (always a member of `pool`). */
    pickedId: string;
    reward: 0 | 1;
}

export interface ReplayEstimate {
    logs: number;
    /** Logs where the policy agreed with the random draw (the effective sample). */
    matches: number;
    /** Mean reward over matches; null when there is no match. */
    value: number | null;
    /** Binomial standard error of `value`. */
    se: number | null;
}

const scoreOf = (w: WeightSet, s: Partial<Record<string, number>>) =>
    (Object.keys(w) as Array<keyof WeightSet>).reduce(
        (a, k) => a + (s[k] ?? 0) * w[k],
        0
    );

/** The pool item a deterministic weighted policy would put in the slot (ties → smallest id). */
export function policyChoice(
    pool: ExploreLog['pool'],
    weights: WeightSet
): string | null {
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const c of pool) {
        const sc = scoreOf(weights, c.signals);
        if (
            sc > bestScore ||
            (sc === bestScore && best !== null && c.id < best)
        ) {
            best = c.id;
            bestScore = sc;
        }
    }
    return best;
}

export function replayEstimate(
    logs: ExploreLog[],
    weights: WeightSet
): ReplayEstimate {
    let matches = 0;
    let reward = 0;
    for (const l of logs) {
        if (policyChoice(l.pool, weights) !== l.pickedId) continue;
        matches++;
        reward += l.reward;
    }
    if (matches === 0)
        return { logs: logs.length, matches, value: null, se: null };
    const value = reward / matches;
    return {
        logs: logs.length,
        matches,
        value: Number(value.toFixed(4)),
        se: Number(Math.sqrt((value * (1 - value)) / matches).toFixed(4)),
    };
}
