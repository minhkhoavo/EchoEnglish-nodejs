import {
    Candidate,
    RecContext,
    ScoredCandidate,
    Variant,
    WeightSet,
} from './types.js';
import { RecMode } from './candidates.js';

export const ALGO_VERSION = 'weighted-v1';

const control: WeightSet = {
    need: 0.36,
    srs: 0.28,
    interest: 0.1,
    levelFit: 0.08,
    habit: 0.1,
    explore: 0.05,
    popularity: 0.03,
    semantic: 0,
};

export const VARIANTS: Record<string, Variant> = {
    control: { name: 'control', weights: control },
    /** Hypothesis: prioritising due reviews improves 30-day retention without hurting score gain. */
    srs_heavy: {
        name: 'srs_heavy',
        weights: {
            ...control,
            srs: 0.4,
            need: 0.28,
            interest: 0.08,
            explore: 0.04,
            popularity: 0.02,
            semantic: 0,
        },
    },
    /** Offline-evaluation baseline only; never served. */
    popularity_only: {
        name: 'popularity_only',
        weights: {
            need: 0,
            srs: 0,
            interest: 0,
            levelFit: 0,
            habit: 0,
            explore: 0,
            popularity: 1,
            semantic: 0,
        },
    },
};

/** Used when we lack consent/evidence: lean on interests, level fit, popularity. */
export const COLD_START_WEIGHTS: WeightSet = {
    need: 0,
    srs: 0.3,
    interest: 0.25,
    levelFit: 0.2,
    habit: 0.15,
    explore: 0,
    popularity: 0.1,
    semantic: 0,
};

const DAY_MS = 86_400_000;

export function scoreCandidate(
    c: Candidate,
    weights: WeightSet,
    ctx: Pick<RecContext, 'exposure' | 'now'>
): ScoredCandidate {
    const components: Record<string, number> = {};
    let score = 0;
    for (const k of Object.keys(weights) as Array<keyof WeightSet>) {
        const v = (c.signals[k] ?? 0) * weights[k];
        if (v !== 0) components[k] = Number(v.toFixed(4));
        score += v;
    }
    if (c.boost) {
        components.boost = c.boost;
        score += c.boost;
    }
    // Anti-repetition: every recent impression lowers the score; recent completion lowers it more.
    const ex = ctx.exposure.get(c.id);
    if (ex) {
        const shownPenalty = Math.min(0.3, 0.08 * ex.shown7d);
        if (shownPenalty > 0) {
            components.recency = -Number(shownPenalty.toFixed(4));
            score -= shownPenalty;
        }
        if (
            ex.completedAt &&
            ctx.now.getTime() - ex.completedAt.getTime() < 3 * DAY_MS
        ) {
            components.completedRecently = -0.25;
            score -= 0.25;
        }
    }
    return { ...c, score: Number(score.toFixed(6)), components };
}

export function rankCandidates(
    cands: Candidate[],
    variant: Variant,
    mode: RecMode,
    ctx: Pick<RecContext, 'exposure' | 'now'>
): ScoredCandidate[] {
    const weights =
        mode === 'cold_start' ? COLD_START_WEIGHTS : variant.weights;
    return cands
        .map((c) => scoreCandidate(c, weights, ctx))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
