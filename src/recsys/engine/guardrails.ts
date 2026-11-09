import { RecContext, ScoredCandidate } from './types.js';
import { cefrIndex, parseCefr, Cefr } from './cefr.js';

export interface GuardrailConfig {
    limit: number;
    maxPerType: number;
    maxPerSkill: number;
    maxFlashcardItems: number;
    frequencyCap: number; // impressions in 7d with no click → suppress
    dismissCooldownDays: number;
    resourceCompleteCooldownDays: number;
    drillCompleteCooldownDays: number;
    minDistinctTypes: number;
    cefrMaxGap: number;
    /** Selected items may exceed the available time by this factor before trimming. */
    budgetSlack: number;
    minItems: number;
}

export const DEFAULT_GUARDRAILS: GuardrailConfig = {
    limit: 5,
    maxPerType: 2,
    maxPerSkill: 2,
    maxFlashcardItems: 1,
    frequencyCap: 3,
    dismissCooldownDays: 14,
    resourceCompleteCooldownDays: 30,
    drillCompleteCooldownDays: 1,
    minDistinctTypes: 2,
    cefrMaxGap: 1,
    budgetSlack: 1.25,
    minItems: 3,
};

export interface Suppressed {
    id: string;
    rule:
        | 'dismissed'
        | 'frequency_cap'
        | 'completed_cooldown'
        | 'cefr_gap'
        | 'unsuitable';
}

export interface GuardrailResult {
    selected: ScoredCandidate[];
    suppressed: Suppressed[];
}

const DAY_MS = 86_400_000;

/** Hard filters: an item failing any of these is never shown, regardless of score. */
export function hardFilter(
    cands: ScoredCandidate[],
    ctx: Pick<RecContext, 'exposure' | 'now'>,
    learnerCefr: Cefr | undefined,
    cfg: GuardrailConfig
): { kept: ScoredCandidate[]; suppressed: Suppressed[] } {
    const kept: ScoredCandidate[] = [];
    const suppressed: Suppressed[] = [];
    for (const c of cands) {
        const ex = ctx.exposure.get(c.id);
        const ageDays = (d?: Date) =>
            d ? (ctx.now.getTime() - d.getTime()) / DAY_MS : Infinity;
        let rule: Suppressed['rule'] | null = null;
        if (
            ex?.dismissedAt &&
            ageDays(ex.dismissedAt) < cfg.dismissCooldownDays
        )
            rule = 'dismissed';
        else if (ex && ex.shown7d >= cfg.frequencyCap && !ex.clicked)
            rule = 'frequency_cap';
        else if (ex?.completedAt) {
            const cool =
                c.type === 'resource'
                    ? cfg.resourceCompleteCooldownDays
                    : cfg.drillCompleteCooldownDays;
            if (c.type !== 'flashcard_review' && ageDays(ex.completedAt) < cool)
                rule = 'completed_cooldown';
        }
        if (!rule && c.type === 'resource' && learnerCefr) {
            const rc = parseCefr(c.cefr);
            if (
                rc &&
                Math.abs(cefrIndex(rc) - cefrIndex(learnerCefr)) >
                    cfg.cefrMaxGap
            )
                rule = 'cefr_gap';
        }
        if (rule) suppressed.push({ id: c.id, rule });
        else kept.push(c);
    }
    return { kept, suppressed };
}

/**
 * Greedy, score-ordered selection with caps (per type, per skill, one flashcard block),
 * then a diversity floor and a time-budget trim. Pure and deterministic.
 */
export function selectDiverse(
    ranked: ScoredCandidate[],
    availableMinutes: number,
    cfg: GuardrailConfig
): ScoredCandidate[] {
    const perType = new Map<string, number>();
    const perSkill = new Map<string, number>();
    const picked: ScoredCandidate[] = [];
    const rest: ScoredCandidate[] = [];

    const canTake = (c: ScoredCandidate) => {
        const cap =
            c.type === 'flashcard_review'
                ? cfg.maxFlashcardItems
                : cfg.maxPerType;
        if ((perType.get(c.type) ?? 0) >= cap) return false;
        if (c.skillKey && (perSkill.get(c.skillKey) ?? 0) >= cfg.maxPerSkill)
            return false;
        return true;
    };
    const take = (c: ScoredCandidate) => {
        picked.push(c);
        perType.set(c.type, (perType.get(c.type) ?? 0) + 1);
        if (c.skillKey)
            perSkill.set(c.skillKey, (perSkill.get(c.skillKey) ?? 0) + 1);
    };

    for (const c of ranked) {
        if (picked.length >= cfg.limit) {
            rest.push(c);
            continue;
        }
        if (canTake(c)) take(c);
        else rest.push(c);
    }

    // Diversity floor: ensure at least N distinct types when the pool can provide them.
    const distinct = () => new Set(picked.map((p) => p.type)).size;
    while (picked.length > 1 && distinct() < cfg.minDistinctTypes) {
        const have = new Set(picked.map((p) => p.type));
        const alt = rest.find(
            (r) => !have.has(r.type) && canTakeIgnoringFull(r, perSkill, cfg)
        );
        if (!alt) break;
        const dropped = picked.pop()!; // lowest-ranked pick makes room
        perType.set(dropped.type, (perType.get(dropped.type) ?? 1) - 1);
        if (dropped.skillKey)
            perSkill.set(
                dropped.skillKey,
                (perSkill.get(dropped.skillKey) ?? 1) - 1
            );
        take(alt);
    }

    // Time budget: drop the lowest-ranked items while over budget (keep ≥ minItems).
    let total = picked.reduce((a, c) => a + c.estMinutes, 0);
    while (
        picked.length > cfg.minItems &&
        total > availableMinutes * cfg.budgetSlack
    ) {
        total -= picked.pop()!.estMinutes;
    }
    return picked;
}

function canTakeIgnoringFull(
    c: ScoredCandidate,
    perSkill: Map<string, number>,
    cfg: GuardrailConfig
): boolean {
    return !c.skillKey || (perSkill.get(c.skillKey) ?? 0) < cfg.maxPerSkill;
}

export function applyGuardrails(
    ranked: ScoredCandidate[],
    ctx: Pick<RecContext, 'exposure' | 'now' | 'availableMinutes'>,
    learnerCefr: Cefr | undefined,
    cfg: GuardrailConfig = DEFAULT_GUARDRAILS
): GuardrailResult {
    const { kept, suppressed } = hardFilter(ranked, ctx, learnerCefr, cfg);
    return {
        selected: selectDiverse(kept, ctx.availableMinutes, cfg),
        suppressed,
    };
}
