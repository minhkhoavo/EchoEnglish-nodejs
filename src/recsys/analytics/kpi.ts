import { recsysConfig } from '../config.js';

/** Pure KPI math over already-loaded rows. Definitions are documented in docs/recommendation/06-operations.md. */

export interface FactRow {
    userId: string;
    day: string;
    learningActions: number;
    studySeconds: number;
    creditsSpent: number;
    aiCostUsd: number;
    lastTestScore?: number;
}
export interface SignupRow {
    userId: string;
    day: string; // local signup day
}

const DAY_MS = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) =>
    new Date(dayMs(d) + n * DAY_MS).toISOString().slice(0, 10);

export const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x: number, d = 4) => Number(x.toFixed(d));

/** k-anonymity guard: small cohorts are reported as null instead of a re-identifiable number. */
export function suppress<T>(
    value: T,
    cohortSize: number,
    min = recsysConfig.minCohortSize
): T | null {
    return cohortSize < min ? null : value;
}

export function activeDaysByUser(facts: FactRow[]): Map<string, Set<string>> {
    const m = new Map<string, Set<string>>();
    for (const f of facts) {
        if (f.learningActions <= 0) continue;
        (m.get(f.userId) ?? m.set(f.userId, new Set()).get(f.userId)!).add(
            f.day
        );
    }
    return m;
}

export interface RateResult {
    rate: number | null;
    cohort: number;
    achieved: number;
}

/** % of matured signups (signup+window ≤ today) with ≥1 learning action in [0, window] days. */
export function activationRate(
    signups: SignupRow[],
    active: Map<string, Set<string>>,
    today: string,
    windowDays = 7
): RateResult {
    const matured = signups.filter((s) => addDays(s.day, windowDays) <= today);
    const achieved = matured.filter((s) => {
        const days = active.get(s.userId);
        if (!days) return false;
        for (let i = 0; i <= windowDays; i++)
            if (days.has(addDays(s.day, i))) return true;
        return false;
    }).length;
    return {
        rate: suppress(
            matured.length ? round(achieved / matured.length) : null,
            matured.length
        ),
        cohort: matured.length,
        achieved,
    };
}

/** Classic day-N retention: active exactly N days after signup, among signups old enough. */
export function dayNRetention(
    signups: SignupRow[],
    active: Map<string, Set<string>>,
    today: string,
    n: number
): RateResult {
    const matured = signups.filter((s) => addDays(s.day, n) <= today);
    const achieved = matured.filter((s) =>
        active.get(s.userId)?.has(addDays(s.day, n))
    ).length;
    return {
        rate: suppress(
            matured.length ? round(achieved / matured.length) : null,
            matured.length
        ),
        cohort: matured.length,
        achieved,
    };
}

export function activeUserCounts(facts: FactRow[], today: string) {
    const active = activeDaysByUser(facts);
    const within = (from: string) => {
        let n = 0;
        for (const days of active.values())
            for (const d of days)
                if (d >= from && d <= today) {
                    n++;
                    break;
                }
        return n;
    };
    const dau = within(today);
    const wau = within(addDays(today, -6));
    const mau = within(addDays(today, -29));
    return { dau, wau, mau, stickiness: mau > 0 ? round(dau / mau) : null };
}

/** Study minutes per active learner per active week (mean + median), over given facts. */
export function studyTime(facts: FactRow[]) {
    const perUser = new Map<string, number>();
    for (const f of facts)
        perUser.set(f.userId, (perUser.get(f.userId) ?? 0) + f.studySeconds);
    const mins = [...perUser.values()].map((s) => s / 60).filter((m) => m > 0);
    const days = new Set(facts.map((f) => f.day)).size || 1;
    const weeks = Math.max(1, days / 7);
    const perWeek = mins.map((m) => m / weeks);
    return {
        learners: mins.length,
        meanMinutesPerWeek: perWeek.length
            ? round(perWeek.reduce((a, b) => a + b, 0) / perWeek.length, 1)
            : null,
        medianMinutesPerWeek: perWeek.length
            ? round(median(perWeek)!, 1)
            : null,
    };
}

/** Score gain = latest − earliest test score in the window, for learners with ≥ 2 test days. */
export function scoreGain(facts: FactRow[]) {
    const byUser = new Map<string, Array<{ day: string; score: number }>>();
    for (const f of facts) {
        if (f.lastTestScore === undefined) continue;
        (byUser.get(f.userId) ?? byUser.set(f.userId, []).get(f.userId)!).push({
            day: f.day,
            score: f.lastTestScore,
        });
    }
    const gains: number[] = [];
    for (const rows of byUser.values()) {
        if (rows.length < 2) continue;
        rows.sort((a, b) => a.day.localeCompare(b.day));
        gains.push(rows[rows.length - 1].score - rows[0].score);
    }
    const n = gains.length;
    return {
        learners: n,
        medianGain: suppress(n ? median(gains) : null, n),
        meanGain: suppress(
            n ? round(gains.reduce((a, b) => a + b, 0) / n, 1) : null,
            n
        ),
    };
}

export interface MoneyInput {
    /** Successful purchases in the window: VND amount and credits bought, per user. */
    purchases: Array<{ userId: string; amountVnd: number; credits: number }>;
    usdToVnd: number;
}

/** Credit spend, conversion and AI cost per learner (the unit-economics block). */
export function unitEconomics(facts: FactRow[], money: MoneyInput) {
    const activeUsers = activeDaysByUser(facts).size;
    const creditsSpent = facts.reduce((a, f) => a + f.creditsSpent, 0);
    const spenders = new Set(
        facts.filter((f) => f.creditsSpent > 0).map((f) => f.userId)
    ).size;
    const aiCostUsd = facts.reduce((a, f) => a + f.aiCostUsd, 0);
    const revenueVnd = money.purchases.reduce((a, p) => a + p.amountVnd, 0);
    const payers = new Set(money.purchases.map((p) => p.userId)).size;
    const aiCostVnd = aiCostUsd * money.usdToVnd;
    return {
        activeLearners: activeUsers,
        creditsSpent,
        creditsSpentPerActiveLearner: activeUsers
            ? round(creditsSpent / activeUsers, 2)
            : null,
        spenderRate: activeUsers ? round(spenders / activeUsers) : null,
        payers,
        payerConversion: activeUsers ? round(payers / activeUsers) : null,
        revenueVnd,
        aiCostUsd: round(aiCostUsd, 4),
        aiCostPerActiveLearnerUsd: activeUsers
            ? round(aiCostUsd / activeUsers, 4)
            : null,
        aiCostShareOfRevenue:
            revenueVnd > 0 ? round(aiCostVnd / revenueVnd) : null,
    };
}

export interface VariantRow {
    variant: string;
    /** Cold-start lists ignore the variant, so rows are compared only within the same mode. */
    mode?: string;
    impressions: number;
    clicks: number;
    completes: number;
    dismisses: number;
    users: number;
}

/** Variant read-out with a two-proportion z-test on CTR (control vs each other variant). */
export function experimentReadout(rows: VariantRow[], control = 'control') {
    return rows.map((r) => {
        const base = rows.find(
            (b) => b.variant === control && b.mode === r.mode
        );
        const ctr = r.impressions ? r.clicks / r.impressions : null;
        let z: number | null = null;
        if (base && r !== base && r.impressions > 0 && base.impressions > 0) {
            const p1 = r.clicks / r.impressions;
            const p0 = base.clicks / base.impressions;
            const p =
                (r.clicks + base.clicks) / (r.impressions + base.impressions);
            const se = Math.sqrt(
                p * (1 - p) * (1 / r.impressions + 1 / base.impressions)
            );
            z = se > 0 ? round((p1 - p0) / se, 3) : null;
        }
        return {
            ...r,
            ctr: ctr === null ? null : round(ctr),
            completionRate: r.impressions
                ? round(r.completes / r.impressions)
                : null,
            dismissRate: r.impressions
                ? round(r.dismisses / r.impressions)
                : null,
            zVsControl: z,
            significant95: z === null ? null : Math.abs(z) >= 1.96,
        };
    });
}

/** One learner's totals inside one variant × mode. The unit of analysis for experiments. */
export interface UserVariantRow {
    userId: string;
    variant: string;
    mode?: string;
    impressions: number;
    clicks: number;
    completes: number;
    dismisses: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs: number[], m: number) =>
    xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);

/** Welch's t statistic for two independent samples; null with < 2 values or no variance. */
export function welchT(a: number[], b: number[]): number | null {
    if (a.length < 2 || b.length < 2) return null;
    const ma = mean(a);
    const mb = mean(b);
    const se = Math.sqrt(
        variance(a, ma) / a.length + variance(b, mb) / b.length
    );
    return se > 0 ? round((ma - mb) / se, 3) : null;
}

/** Fewest learners per arm before a per-learner test is reported. */
export const MIN_USERS_PER_ARM = 30;

/**
 * Per-learner read-out. One learner produces many impressions and they are correlated, so an
 * impression-level z-test overstates significance. Here every learner contributes ONE value
 * (their own rate) and arms are compared with Welch's t-test (normal approximation; arms below
 * MIN_USERS_PER_ARM report no test). Completion and dismissal are guardrail metrics.
 */
export function perLearnerReadout(rows: UserVariantRow[], control = 'control') {
    const groups = new Map<string, UserVariantRow[]>();
    for (const r of rows) {
        if (r.impressions <= 0) continue;
        const k = `${r.variant}|${r.mode ?? 'unknown'}`;
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    }
    const rate = (g: UserVariantRow[], f: (r: UserVariantRow) => number) =>
        g.map((r) => f(r) / r.impressions);
    return [...groups.entries()].map(([k, g]) => {
        const [variant, mode] = k.split('|');
        const base = groups.get(`${control}|${mode}`);
        const test = (f: (r: UserVariantRow) => number) =>
            base &&
            base !== g &&
            g.length >= MIN_USERS_PER_ARM &&
            base.length >= MIN_USERS_PER_ARM
                ? welchT(rate(g, f), rate(base, f))
                : null;
        const tCtr = test((r) => r.clicks);
        const tDismiss = test((r) => r.dismisses);
        return {
            variant,
            mode,
            learners: g.length,
            meanCtr: suppress(round(mean(rate(g, (r) => r.clicks))), g.length),
            meanCompletionRate: suppress(
                round(mean(rate(g, (r) => r.completes))),
                g.length
            ),
            meanDismissRate: suppress(
                round(mean(rate(g, (r) => r.dismisses))),
                g.length
            ),
            tCtrVsControl: tCtr,
            ctrSignificant95: tCtr === null ? null : Math.abs(tCtr) >= 1.96,
            /** Guardrail: true when learners dismiss significantly MORE than in control. */
            dismissWorse95: tDismiss === null ? null : tDismiss >= 1.96,
        };
    });
}

/** χ² critical values at p = 0.001 for 1–4 degrees of freedom. */
const CHI2_P001 = [10.828, 13.816, 16.266, 18.467];

/**
 * Sample-ratio mismatch: are the arms the sizes the assignment weights say they should be?
 * A mismatch means assignment or logging is broken and NO metric from the experiment can be
 * trusted. Uses p < 0.001, the usual threshold for this check.
 */
export function sampleRatioCheck(
    observed: Record<string, number>,
    weights: Array<{ name: string; weight: number }>
) {
    const total = weights.reduce((a, w) => a + (observed[w.name] ?? 0), 0);
    const wsum = weights.reduce((a, w) => a + w.weight, 0);
    if (total === 0 || weights.length < 2 || weights.length > 5)
        return { learners: total, chi2: null, mismatch: null };
    let chi2 = 0;
    for (const w of weights) {
        const expected = (total * w.weight) / wsum;
        chi2 += ((observed[w.name] ?? 0) - expected) ** 2 / expected;
    }
    return {
        learners: total,
        chi2: round(chi2, 3),
        mismatch: chi2 > CHI2_P001[weights.length - 2],
    };
}

/**
 * What the experiment is really for: learning outcomes per variant (personalised lists only).
 * Score gain needs ≥ 2 test days per learner in the fact window; active days is the engagement
 * outcome. Small cohorts are suppressed.
 */
export function outcomesByVariant(rows: UserVariantRow[], facts: FactRow[]) {
    const variantOf = new Map<string, string>();
    for (const r of rows)
        if (r.mode === 'personalized' && r.impressions > 0)
            variantOf.set(r.userId, r.variant);
    const byVariant = new Map<string, FactRow[]>();
    const users = new Map<string, Set<string>>();
    for (const f of facts) {
        const v = variantOf.get(f.userId);
        if (!v) continue;
        (byVariant.get(v) ?? byVariant.set(v, []).get(v)!).push(f);
    }
    for (const [u, v] of variantOf)
        (users.get(v) ?? users.set(v, new Set()).get(v)!).add(u);
    return [...users.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([variant, set]) => {
            const f = byVariant.get(variant) ?? [];
            const active = activeDaysByUser(f);
            let days = 0;
            for (const d of active.values()) days += d.size;
            return {
                variant,
                learners: set.size,
                meanActiveDays: suppress(round(days / set.size, 2), set.size),
                scoreGain: scoreGain(f),
            };
        });
}
