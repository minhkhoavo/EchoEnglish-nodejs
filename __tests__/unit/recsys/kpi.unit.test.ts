import {
    activationRate,
    dayNRetention,
    activeUserCounts,
    studyTime,
    scoreGain,
    unitEconomics,
    experimentReadout,
    suppress,
    median,
    addDays,
    activeDaysByUser,
    FactRow,
} from '~/recsys/analytics/kpi.js';

const today = '2026-03-31';
const f = (
    userId: string,
    day: string,
    over: Partial<FactRow> = {}
): FactRow => ({
    userId,
    day,
    learningActions: 5,
    studySeconds: 600,
    creditsSpent: 0,
    aiCostUsd: 0,
    ...over,
});
const users = (n: number, day: string) =>
    Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, day }));

describe('suppress / median / addDays', () => {
    it('suppresses cohorts below k', () => {
        expect(suppress(0.5, 4)).toBeNull();
        expect(suppress(0.5, 5)).toBe(0.5);
    });
    it('median handles odd/even/empty', () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([1, 2, 3, 4])).toBe(2.5);
        expect(median([])).toBeNull();
    });
    it('addDays crosses month boundaries', () => {
        expect(addDays('2026-02-28', 2)).toBe('2026-03-02');
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });
});

describe('activation and retention', () => {
    const signups = users(10, '2026-03-01'); // all matured for 7d & 30d
    const facts = [
        // u0..u5 active within 7 days; u0..u2 active exactly on day 7; u0,u1 on day 30
        ...['u0', 'u1', 'u2', 'u3', 'u4', 'u5'].map((u) => f(u, '2026-03-03')),
        ...['u0', 'u1', 'u2'].map((u) => f(u, '2026-03-08')),
        ...['u0', 'u1'].map((u) => f(u, '2026-03-31')),
        f('u9', '2026-03-20'), // active only after the 7-day window
    ];
    const active = activeDaysByUser(facts);

    it('activation = share with a learning action within 7 days of signup', () => {
        expect(activationRate(signups, active, today, 7)).toMatchObject({
            rate: 0.6,
            cohort: 10,
            achieved: 6,
        });
    });
    it('day-N retention uses exact-day activity', () => {
        expect(dayNRetention(signups, active, today, 7).rate).toBe(0.3);
        expect(dayNRetention(signups, active, today, 30).rate).toBe(0.2);
        expect(dayNRetention(signups, active, today, 1).rate).toBe(0);
    });
    it('excludes immature cohorts (no penalty for users who have not had time)', () => {
        const fresh = users(10, '2026-03-30');
        const r = dayNRetention(fresh, new Map(), today, 7);
        expect(r.cohort).toBe(0);
        expect(r.rate).toBeNull();
    });
    it('small cohorts are suppressed', () => {
        expect(
            activationRate(users(3, '2026-03-01'), active, today, 7).rate
        ).toBeNull();
    });
    it('ignores facts with no learning action', () => {
        expect(
            activeDaysByUser([f('u1', '2026-03-03', { learningActions: 0 })])
                .size
        ).toBe(0);
    });
});

describe('active users and engagement', () => {
    it('DAU/WAU/MAU and stickiness', () => {
        const facts = [
            f('a', today),
            f('b', today),
            f('b', '2026-03-28'),
            f('c', '2026-03-26'),
            f('d', '2026-03-10'),
        ];
        const r = activeUserCounts(facts, today);
        expect(r).toMatchObject({ dau: 2, wau: 3, mau: 4 });
        expect(r.stickiness).toBe(0.5);
    });
    it('study time per active week (mean/median)', () => {
        const facts = [
            ...Array.from({ length: 7 }, (_, i) =>
                f('a', addDays('2026-03-01', i), { studySeconds: 600 })
            ), // 70 min / wk
            ...Array.from({ length: 7 }, (_, i) =>
                f('b', addDays('2026-03-01', i), { studySeconds: 300 })
            ), // 35 min / wk
        ];
        const r = studyTime(facts);
        expect(r.learners).toBe(2);
        expect(r.meanMinutesPerWeek).toBe(52.5);
        expect(r.medianMinutesPerWeek).toBe(52.5);
        expect(studyTime([]).meanMinutesPerWeek).toBeNull();
    });
});

describe('score gain', () => {
    it('latest minus earliest test score for learners with ≥2 test days; suppressed if cohort < 5', () => {
        const rows: FactRow[] = [];
        for (let u = 0; u < 6; u++) {
            rows.push(
                f(`u${u}`, '2026-01-10', { lastTestScore: 500 }),
                f(`u${u}`, '2026-03-10', { lastTestScore: 500 + 30 + u * 10 })
            );
        }
        rows.push(f('single', '2026-03-10', { lastTestScore: 700 })); // one test → excluded
        const r = scoreGain(rows);
        expect(r.learners).toBe(6);
        expect(r.medianGain).toBe(55);
        expect(scoreGain(rows.slice(0, 4)).medianGain).toBeNull();
    });
});

describe('unit economics', () => {
    it('credit spend, conversion and AI cost share of revenue', () => {
        const facts = [
            f('a', today, { creditsSpent: 10, aiCostUsd: 0.02 }),
            f('b', today, { creditsSpent: 0, aiCostUsd: 0.01 }),
            f('c', today, { creditsSpent: 5, aiCostUsd: 0.03 }),
            f('d', today, { creditsSpent: 0, aiCostUsd: 0 }),
        ];
        const r = unitEconomics(facts, {
            usdToVnd: 25_000,
            purchases: [{ userId: 'a', amountVnd: 100_000, credits: 100 }],
        });
        expect(r.activeLearners).toBe(4);
        expect(r.creditsSpentPerActiveLearner).toBe(3.75);
        expect(r.spenderRate).toBe(0.5);
        expect(r.payerConversion).toBe(0.25);
        expect(r.aiCostPerActiveLearnerUsd).toBe(0.015);
        expect(r.aiCostShareOfRevenue).toBeCloseTo(
            (0.06 * 25_000) / 100_000,
            6
        );
    });
    it('no revenue → null ratio (not Infinity/NaN)', () => {
        const r = unitEconomics([f('a', today, { aiCostUsd: 1 })], {
            usdToVnd: 25_000,
            purchases: [],
        });
        expect(r.aiCostShareOfRevenue).toBeNull();
    });
    it('empty facts do not divide by zero', () => {
        const r = unitEconomics([], { usdToVnd: 25_000, purchases: [] });
        expect(r.creditsSpentPerActiveLearner).toBeNull();
        expect(r.payerConversion).toBeNull();
    });
});

describe('experiment read-out', () => {
    it('z-test flags a real CTR lift and not a tiny one', () => {
        const rows = experimentReadout([
            {
                variant: 'control',
                impressions: 10_000,
                clicks: 2_000,
                completes: 500,
                dismisses: 300,
                users: 3000,
            },
            {
                variant: 'srs_heavy',
                impressions: 10_000,
                clicks: 2_300,
                completes: 600,
                dismisses: 280,
                users: 3000,
            },
            {
                variant: 'noise',
                impressions: 10_000,
                clicks: 2_020,
                completes: 500,
                dismisses: 300,
                users: 3000,
            },
        ]);
        expect(rows.find((r) => r.variant === 'srs_heavy')!.significant95).toBe(
            true
        );
        expect(rows.find((r) => r.variant === 'noise')!.significant95).toBe(
            false
        );
        expect(
            rows.find((r) => r.variant === 'control')!.zVsControl
        ).toBeNull();
        expect(rows[0].ctr).toBe(0.2);
    });
    it('no impressions → null rates', () => {
        const [r] = experimentReadout([
            {
                variant: 'control',
                impressions: 0,
                clicks: 0,
                completes: 0,
                dismisses: 0,
                users: 0,
            },
        ]);
        expect(r.ctr).toBeNull();
    });
});
