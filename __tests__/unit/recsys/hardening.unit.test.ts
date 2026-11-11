import {
    ctx,
    features,
    resource,
    skill,
    NOW,
} from '../../helpers/recFixtures.js';
import {
    explorationPool,
    exploreSwap,
    EXPLORE_POOL_MAX,
} from '~/recsys/engine/guardrails.js';
import { seededRng } from '~/recsys/engine/experiments.js';
import {
    buildRecommendations,
    RecommenderService,
    retrievalHints,
} from '~/recsys/engine/recommender.js';
import { VARIANTS } from '~/recsys/engine/ranker.js';
import { skillReason } from '~/recsys/engine/candidates.js';
import { explain } from '~/recsys/engine/explain.js';
import { ScoredCandidate } from '~/recsys/engine/types.js';
import {
    estimatePositionBias,
    MIN_EXPLORED_PER_POSITION,
    TrainingRow,
    trainRanker,
} from '~/recsys/learning/train.js';
import { followedWithin, outcomeKey } from '~/recsys/learning/dataset.js';
import { policyChoice, replayEstimate } from '~/recsys/eval/counterfactual.js';
import {
    outcomesByVariant,
    perLearnerReadout,
    sampleRatioCheck,
    UserVariantRow,
    welchT,
} from '~/recsys/analytics/kpi.js';
import { calibratedB } from '~/recsys/features/itemDifficulty.js';
import {
    difficultyB,
    newMastery,
    updateMastery,
} from '~/recsys/features/mastery.js';
import { resetAlertsForTests, sendAlert } from '~/recsys/analytics/alerts.js';

const cand = (id: string, score: number, type = 'resource'): ScoredCandidate =>
    ({
        id,
        type,
        ref: id,
        title: id,
        estMinutes: 5,
        signals: { need: score },
        reason: { code: 'level_fit', params: {} },
        action: {},
        score,
        components: {},
    }) as ScoredCandidate;

describe('exploration slot (T4.2)', () => {
    const selected = [cand('a', 0.9), cand('b', 0.8), cand('c', 0.7)];
    const kept = [
        ...selected,
        ...Array.from({ length: 30 }, (_, i) => cand(`p${i}`, 0.6 - i / 100)),
    ];

    it('the pool is the top of what passed the hard filters and was not shown', () => {
        const pool = explorationPool(selected, kept);
        expect(pool).toHaveLength(EXPLORE_POOL_MAX);
        expect(pool[0].id).toBe('p0');
        expect(pool.some((p) => ['a', 'b', 'c'].includes(p.id))).toBe(false);
    });

    it('swaps exactly one slot, reports the propensity and is reproducible from the seed', () => {
        const pool = explorationPool(selected, kept);
        const one = exploreSwap(selected, pool, seededRng('rec-1'))!;
        const again = exploreSwap(selected, pool, seededRng('rec-1'))!;
        expect(again).toEqual(one);
        expect(one.propensity).toBeCloseTo(1 / EXPLORE_POOL_MAX);
        expect(
            one.selected.filter((c, i) => c.id !== selected[i].id)
        ).toHaveLength(1);
        expect(one.selected[one.slot].id).toBe(one.pickedId);
        expect(selected[one.slot].id).toBe(one.replacedId);
    });

    it('covers every slot and every pool item over many requests (uniform, not top-biased)', () => {
        const pool = explorationPool(selected, kept);
        const slots = new Set<number>();
        const picks = new Set<string>();
        for (let i = 0; i < 2000; i++) {
            const s = exploreSwap(selected, pool, seededRng(`r${i}`))!;
            slots.add(s.slot);
            picks.add(s.pickedId);
        }
        expect(slots.size).toBe(3);
        expect(picks.size).toBe(EXPLORE_POOL_MAX);
    });

    it('does nothing without a pool or with a single item', () => {
        expect(exploreSwap(selected, [], seededRng('x'))).toBeNull();
        expect(exploreSwap([selected[0]], kept, seededRng('x'))).toBeNull();
    });

    it('never surfaces an item the hard filters removed, and logs the pool it drew from', () => {
        const resources = Array.from({ length: 12 }, (_, i) =>
            resource(`${i}`.padStart(24, '0'))
        );
        const dismissed = `resource:${'3'.padStart(24, '0')}`;
        const c = ctx({
            resources,
            exposure: new Map([
                [dismissed, { shown7d: 0, clicked: false, dismissedAt: NOW }],
            ]),
        });
        for (let i = 0; i < 200; i++) {
            const out = buildRecommendations(
                c,
                VARIANTS.control,
                5,
                undefined,
                {
                    rng: seededRng(`req-${i}`),
                }
            );
            expect(out.items.map((x) => x.id)).not.toContain(dismissed);
            if (out.explore) {
                expect(out.items[out.explore.slot].id).toBe(out.explore.picked);
                expect(
                    out.pool.map((p) => `${p.itemType}:${p.itemRef}`)
                ).toContain(out.explore.picked);
            }
        }
        // without the option the result is exactly the deterministic list
        const plain = buildRecommendations(c, VARIANTS.control, 5);
        expect(plain.explore).toBeUndefined();
    });
});

describe('position bias from the randomised slot (T4.3)', () => {
    const row = (
        position: number,
        clicked: boolean,
        explored = true
    ): TrainingRow => ({
        userId: `u${position}`,
        recId: 'r',
        signals: {},
        position,
        segment: null,
        clicked,
        explored,
    });

    it('needs enough explored impressions at positions 0 and 1', () => {
        expect(estimatePositionBias([row(0, true), row(1, false)])).toBeNull();
        // non-explored rows carry no information about position alone
        expect(
            estimatePositionBias(
                Array.from({ length: 5000 }, (_, i) =>
                    row(i % 2, i % 3 === 0, false)
                )
            )
        ).toBeNull();
    });

    it('recovers the examination ratio between positions', () => {
        const rows: TrainingRow[] = [];
        const n = MIN_EXPLORED_PER_POSITION * 5;
        for (let i = 0; i < n; i++) {
            rows.push(row(0, i % 10 < 4)); // 40 %
            rows.push(row(1, i % 10 < 2)); // 20 %
            rows.push(row(2, i % 10 < 1)); // 10 %
        }
        const b = estimatePositionBias(rows)!;
        expect(b.theta.slice(0, 3)).toEqual([1, 0.5, 0.25]);
        expect(b.theta[3]).toBe(0.25); // no data → inherits the previous position
    });
});

describe('training label (T4.4)', () => {
    it('trains on `label` when present, not on raw clicks', async () => {
        // `need` drives verified learning; `popularity` drives clicks that lead nowhere.
        const rows: TrainingRow[] = [];
        let seed = 7;
        const r = () => (
            (seed = (seed * 1103515245 + 12345) % 2 ** 31),
            seed / 2 ** 31
        );
        for (let i = 0; i < 6000; i++) {
            const need = r();
            const popularity = r();
            rows.push({
                userId: `u${i % 400}`,
                recId: `r${i}`,
                signals: { need, popularity },
                position: i % 5,
                segment: 'established',
                clicked: r() < popularity * 0.8,
                label: r() < need * 0.6,
            });
        }
        const th = {
            minRows: 1000,
            minPositives: 100,
            minAucLift: -1,
            minSegmentPositives: 1e9,
        };
        const outcome = await trainRanker(rows, th);
        const clicks = await trainRanker(
            rows.map(({ label: _l, ...rest }) => (void _l, rest)),
            th
        );
        expect(outcome.payload!.global.need).toBeGreaterThan(
            outcome.payload!.global.popularity
        );
        expect(clicks.payload!.global.popularity).toBeGreaterThan(
            clicks.payload!.global.need
        );
        expect(outcome.metrics.positionBias).toEqual({ method: 'covariate' });
    });

    it('maps each item type to the activity that proves it was done', () => {
        expect(outcomeKey('skill_drill', 'p5.wordform')).toBe(
            'question_answered|p5.wordform'
        );
        expect(outcomeKey('resource', 'abc')).toBe('resource_viewed|abc');
        expect(outcomeKey('flashcard_review', 'due')).toBe(
            'flashcard_reviewed|'
        );
        expect(outcomeKey('mock_test', 'starter')).toBe('test_submitted|');
        expect(outcomeKey('something_else')).toBeNull();
    });

    it('counts only activity AFTER the impression and inside the window', () => {
        const t0 = 1_000_000;
        expect(followedWithin([t0 - 5], t0, 100)).toBe(false);
        expect(followedWithin([t0], t0, 100)).toBe(false);
        expect(followedWithin([t0 - 5, t0 + 100], t0, 100)).toBe(true);
        expect(followedWithin([t0 + 101], t0, 100)).toBe(false);
        expect(followedWithin(undefined, t0)).toBe(false);
    });
});

describe('counterfactual replay on exploration logs (T4.9)', () => {
    const w = (need: number, popularity: number) => ({
        ...VARIANTS.popularity_only.weights,
        need,
        popularity,
    });
    const pool = [
        { id: 'useful', signals: { need: 0.9, popularity: 0.1 } },
        { id: 'popular', signals: { need: 0.1, popularity: 0.9 } },
    ];
    // the useful item pays off 60 % of the time, the popular one 10 %
    const logs = Array.from({ length: 400 }, (_, i) => {
        const pickedId = i % 2 ? 'useful' : 'popular';
        const k = Math.floor(i / 2) % 10;
        return {
            pool,
            pickedId,
            reward: (pickedId === 'useful' ? k < 6 : k < 1)
                ? (1 as const)
                : (0 as const),
        };
    });

    it('a policy is scored only on logs where it agrees with the random draw', () => {
        expect(policyChoice(pool, w(1, 0))).toBe('useful');
        const good = replayEstimate(logs, w(1, 0));
        const bad = replayEstimate(logs, w(0, 1));
        expect(good.matches).toBe(200);
        expect(good.value).toBeCloseTo(0.6);
        expect(bad.value).toBeCloseTo(0.1);
        expect(good.se).toBeGreaterThan(0);
    });

    it('reports nothing rather than a number when there is no evidence', () => {
        expect(replayEstimate([], w(1, 0))).toEqual({
            logs: 0,
            matches: 0,
            value: null,
            se: null,
        });
    });
});

describe('experiment read-out per learner (T4.6)', () => {
    const u = (
        userId: string,
        variant: string,
        impressions: number,
        clicks: number,
        dismisses = 0
    ): UserVariantRow => ({
        userId,
        variant,
        mode: 'personalized',
        impressions,
        clicks,
        completes: 0,
        dismisses,
    });

    it('one heavy user cannot manufacture significance', () => {
        // 40 learners per arm with identical behaviour, plus ONE treatment learner with
        // 5 000 impressions and a high click rate. Impression-level CTR differs a lot.
        const rows = [
            ...Array.from({ length: 40 }, (_, i) =>
                u(`c${i}`, 'control', 10, i % 2 ? 2 : 3)
            ),
            ...Array.from({ length: 40 }, (_, i) =>
                u(`t${i}`, 'srs_heavy', 10, i % 2 ? 2 : 3)
            ),
            u('whale', 'srs_heavy', 5000, 3000),
        ];
        const t = perLearnerReadout(rows).find(
            (r) => r.variant === 'srs_heavy'
        )!;
        expect(t.learners).toBe(41);
        expect(t.ctrSignificant95).toBe(false);
    });

    it('detects a real per-learner difference and a dismissal regression', () => {
        const rows = [
            ...Array.from({ length: 60 }, (_, i) =>
                u(`c${i}`, 'control', 10, 2 + (i % 2), i % 2)
            ),
            ...Array.from({ length: 60 }, (_, i) =>
                u(`t${i}`, 'srs_heavy', 10, 5 + (i % 2), 3 + (i % 2))
            ),
        ];
        const t = perLearnerReadout(rows).find(
            (r) => r.variant === 'srs_heavy'
        )!;
        expect(t.tCtrVsControl).toBeGreaterThan(1.96);
        expect(t.ctrSignificant95).toBe(true);
        expect(t.dismissWorse95).toBe(true);
        const c = perLearnerReadout(rows).find((r) => r.variant === 'control')!;
        expect(c.tCtrVsControl).toBeNull();
    });

    it('reports no test for tiny arms', () => {
        const rows = [u('a', 'control', 10, 1), u('b', 'srs_heavy', 10, 9)];
        expect(perLearnerReadout(rows)[1].tCtrVsControl).toBeNull();
        expect(welchT([1], [2, 3])).toBeNull();
    });

    it('flags a sample-ratio mismatch and accepts an honest split', () => {
        const w = [
            { name: 'control', weight: 50 },
            { name: 'srs_heavy', weight: 50 },
        ];
        expect(
            sampleRatioCheck({ control: 5000, srs_heavy: 5040 }, w).mismatch
        ).toBe(false);
        expect(
            sampleRatioCheck({ control: 5000, srs_heavy: 4500 }, w).mismatch
        ).toBe(true);
        expect(sampleRatioCheck({}, w).mismatch).toBeNull();
    });

    it('reports learning outcomes per variant', () => {
        const rows = Array.from({ length: 6 }, (_, i) =>
            u(`c${i}`, 'control', 5, 1)
        );
        const facts = rows.flatMap((r, i) => [
            {
                userId: r.userId,
                day: '2026-03-01',
                learningActions: 1,
                studySeconds: 60,
                creditsSpent: 0,
                aiCostUsd: 0,
                lastTestScore: 500,
            },
            {
                userId: r.userId,
                day: '2026-03-20',
                learningActions: 1,
                studySeconds: 60,
                creditsSpent: 0,
                aiCostUsd: 0,
                lastTestScore: 540 + i,
            },
        ]);
        const [o] = outcomesByVariant(rows, facts);
        expect(o).toMatchObject({
            variant: 'control',
            learners: 6,
            meanActiveDays: 2,
        });
        expect(o.scoreGain.medianGain).toBeGreaterThanOrEqual(40);
    });
});

describe('item difficulty (T4.8)', () => {
    it('starts at the labelled level and moves with the evidence', () => {
        expect(calibratedB(0, 0, 'advanced')).toBeCloseTo(
            difficultyB('advanced'),
            3
        );
        expect(calibratedB(200, 30, 'beginner')).toBeGreaterThan(1); // labelled easy, actually hard
        expect(calibratedB(200, 190, 'advanced')).toBeLessThan(-1); // labelled hard, actually easy
    });

    it('a correct answer on a measured-hard question raises mastery more than the label says', () => {
        const at = NOW;
        const label = updateMastery(newMastery(), {
            correct: true,
            difficulty: 'beginner',
            at,
        });
        const measured = updateMastery(newMastery(), {
            correct: true,
            difficulty: 'beginner',
            at,
            b: calibratedB(200, 30, 'beginner'),
        });
        expect(measured.theta).toBeGreaterThan(label.theta);
    });
});

describe('honest explanations and bilingual titles (T4.10, T4.11)', () => {
    it('separates measured accuracy from the estimate', () => {
        const reason = skillReason({
            ...skill('p5.wordform', 0.45),
            accuracy: 0.4,
        });
        expect(reason.code).toBe('weak_skill');
        const text = explain({ reason } as ScoredCandidate).text;
        expect(text.en).toMatch(/answered 40% of 20 questions/);
        expect(text.en).toMatch(/estimated mastery now 45%/);
        expect(text.vi).toMatch(/40%/);
    });

    it('a strong skill that merely faded is a refresh, never "weak"', () => {
        const faded = {
            ...skill('p3.inference', 0.62, 40, 0.95, 70),
            accuracy: 0.9,
        };
        const reason = skillReason(faded);
        expect(reason).toEqual({
            code: 'refresh_skill',
            params: { skill: 'Part 3 · inference', acc: 90, days: 70 },
        });
        expect(explain({ reason } as ScoredCandidate).text.en).toMatch(
            /You were strong/
        );
    });

    it('documents written before accuracy existed still get a truthful sentence', () => {
        const text = explain({
            reason: skillReason(skill('p5.wordform', 0.45)),
        } as ScoredCandidate).text;
        expect(text.en).toMatch(/^Your estimated mastery/);
    });

    it('every item and the timing hint carry both languages', () => {
        const out = buildRecommendations(
            ctx({ resources: [resource('a'.repeat(24))] }),
            VARIANTS.control
        );
        expect(out.items.length).toBeGreaterThan(0);
        for (const it of out.items) {
            expect(it.titleI18n.en).toBe(it.title);
            expect(it.titleI18n.vi.length).toBeGreaterThan(0);
        }
        expect(
            out.items.find((i) => i.type === 'flashcard_review')!.titleI18n.vi
        ).toMatch(/^Ôn /);
        expect(out.timing.suggestionI18n.vi).not.toBe(
            out.timing.suggestionI18n.en
        );
    });
});

describe('retrieval hints (T4.7)', () => {
    it('turn level, weak skills and popularity into catalogue queries', () => {
        const h = retrievalHints({
            features: features(),
            profile: { interests: [], studyMinutesPerDay: 30 },
            personalization: true,
            popularity: new Map([
                ['x', 0.2],
                ['y', 0.9],
            ]),
        });
        expect(h.cefr).toEqual(['A2', 'B1', 'B2']); // TOEIC 620 → B1 ± 1
        expect(h.topics).toEqual(
            expect.arrayContaining(['grammar', 'word form'])
        );
        expect(h.popularIds).toEqual(['y', 'x']);
    });

    it('without personalisation consent no behavioural hint is used', () => {
        const h = retrievalHints({
            features: features(),
            profile: {
                interests: [],
                studyMinutesPerDay: 30,
                level: 'beginner',
            },
            personalization: false,
            popularity: new Map(),
        });
        expect(h.topics).toEqual([]);
        expect(h.cefr).toEqual(['A1', 'A2', 'B1']); // from the stated level only
    });
});

describe('cache honours consent immediately (T4.11)', () => {
    it('a consent change never serves the list cached under the old consent', async () => {
        let consent = true;
        const svc = new RecommenderService({
            loadFeatures: async () => features(),
            loadProfile: async () => ({
                interests: [],
                studyMinutesPerDay: 30,
            }),
            loadResources: async () => [],
            loadExposure: async () => new Map(),
            loadPopularity: async () => new Map(),
            hasPersonalizationConsent: async () => consent,
        });
        svc.clearCache();
        const opts = { now: NOW, logImpressions: false };
        const a = await svc.recommend('u-consent', opts);
        expect(a.mode).toBe('personalized');
        expect((await svc.recommend('u-consent', opts)).recId).toBe(a.recId); // cached
        consent = false;
        const b = await svc.recommend('u-consent', opts);
        expect(b.mode).toBe('cold_start');
        expect(b.recId).not.toBe(a.recId);
        svc.clearCache();
    });
});

describe('alerts (T4.12)', () => {
    afterEach(() => {
        delete process.env.RECSYS_ALERT_WEBHOOK_URL;
        resetAlertsForTests();
    });
    const quiet = () =>
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    it('logs only when no webhook is configured', async () => {
        quiet();
        const post = jest.fn();
        expect(await sendAlert('etl_failed', 'boom', 0, post as never)).toBe(
            false
        );
        expect(post).not.toHaveBeenCalled();
    });

    it('posts once per key per 30 minutes and never throws', async () => {
        quiet();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        process.env.RECSYS_ALERT_WEBHOOK_URL = 'https://hooks.example/abc';
        const post = jest.fn().mockResolvedValue({ ok: true });
        expect(await sendAlert('etl_failed', 'boom', 0, post as never)).toBe(
            true
        );
        expect(
            await sendAlert('etl_failed', 'boom', 60_000, post as never)
        ).toBe(false);
        expect(
            await sendAlert('etl_degraded', 'lag', 60_000, post as never)
        ).toBe(true);
        expect(
            await sendAlert('etl_failed', 'boom', 31 * 60_000, post as never)
        ).toBe(true);
        expect(post).toHaveBeenCalledTimes(3);
        expect(JSON.parse(post.mock.calls[0][1].body).text).toMatch(
            /etl_failed: boom/
        );
        const failing = jest.fn().mockRejectedValue(new Error('network'));
        await expect(sendAlert('x', 'y', 0, failing as never)).resolves.toBe(
            false
        );
    });
});
