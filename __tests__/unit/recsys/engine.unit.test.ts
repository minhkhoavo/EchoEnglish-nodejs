import {
    ctx,
    features,
    resource,
    skill,
    NOW,
} from '../../helpers/recFixtures.js';
import {
    decideMode,
    generateCandidates,
    rankWeakSkills,
    learnerCefr,
} from '~/recsys/engine/candidates.js';
import {
    VARIANTS,
    rankCandidates,
    scoreCandidate,
    COLD_START_WEIGHTS,
} from '~/recsys/engine/ranker.js';
import {
    applyGuardrails,
    DEFAULT_GUARDRAILS,
    hardFilter,
} from '~/recsys/engine/guardrails.js';
import { explain } from '~/recsys/engine/explain.js';
import {
    assignVariant,
    bucket,
    RANKER_EXPERIMENT,
} from '~/recsys/engine/experiments.js';
import { buildRecommendations } from '~/recsys/engine/recommender.js';
import { cefrFit, cefrFromToeic, parseCefr } from '~/recsys/engine/cefr.js';
import {
    Candidate,
    ReasonFact,
    ScoredCandidate,
} from '~/recsys/engine/types.js';

const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

describe('cefr helpers', () => {
    it('maps TOEIC bands and parses messy labels', () => {
        expect([224, 225, 549, 550, 784, 785, 945].map(cefrFromToeic)).toEqual([
            'A1',
            'A2',
            'A2',
            'B1',
            'B1',
            'B2',
            'C1',
        ]);
        expect(parseCefr('Intermediate (b1-B2)')).toBe('B1');
        expect(parseCefr('nonsense')).toBeUndefined();
        expect(cefrFit('B1', 'B1')).toBe(1);
        expect(cefrFit('B1', 'B2')).toBe(0.5);
        expect(cefrFit('B1', 'C1')).toBe(0);
        expect(cefrFit(undefined, 'B1')).toBe(0.5);
    });
});

describe('weak-skill ranking', () => {
    it('ranks by gap × exam weight × evidence and ignores skills at/above target or with too few attempts', () => {
        const ranked = rankWeakSkills([
            skill('p5.wordform', 0.4),
            skill('p1.identifystatecondition', 0.4), // same gap, tiny part weight
            skill('p2.whquestion', 0.9), // above target
            skill('p3.gist', 0.3, 2), // too few attempts
            skill('p7.single', 0.4, 20, 0.2), // weak evidence
        ]);
        const keys = ranked.map((r) => r.skillKey);
        expect(keys).not.toContain('p2.whquestion');
        expect(keys).not.toContain('p3.gist');
        expect(keys[0]).toBe('p5.wordform');
        expect(keys.indexOf('p5.wordform')).toBeLessThan(
            keys.indexOf('p1.identifystatecondition')
        );
        expect(keys.indexOf('p5.wordform')).toBeLessThan(
            keys.indexOf('p7.single')
        );
    });
});

describe('non-actionable skills (unknown / part:N) are never drill targets', () => {
    const junk = [
        skill('unknown', 0.2, 30),
        skill('part:5', 0.2, 30, 0.9),
        skill('part:3', 0.3, 3, 0.1),
    ];

    it('are excluded from weak-skill ranking and from exploration drills', () => {
        expect(rankWeakSkills(junk)).toEqual([]);
        const ids = generateCandidates(
            ctx({
                features: features({
                    skills: [...junk, skill('p5.wordform', 0.4)],
                }),
            })
        ).map((c) => c.id);
        expect(ids).toContain('skill_drill:p5.wordform');
        expect(
            ids.some(
                (i) =>
                    i === 'skill_drill:unknown' ||
                    i.startsWith('skill_drill:part:')
            )
        ).toBe(false);
    });

    it('do not count as evidence for personalised mode (a learner with only untagged data is cold-start)', () => {
        expect(decideMode(ctx({ features: features({ skills: junk }) }))).toBe(
            'cold_start'
        );
    });

    it('the final list never contains a dead deep link', () => {
        const out = buildRecommendations(
            ctx({
                features: features({
                    skills: [...junk, skill('p5.wordform', 0.4)],
                }),
            }),
            VARIANTS.control,
            10
        );
        for (const it of out.items) {
            if (it.type === 'skill_drill')
                expect(it.skillKey).toMatch(/^p[1-7]\./);
        }
    });
});

describe('candidate generation', () => {
    it('personalised: SRS block, drills for weak skills, habit nudges', () => {
        const c = generateCandidates(
            ctx({
                features: features({
                    daysSince: { test: 30, pronunciation: 9, vocab: null },
                }),
            })
        );
        const ids = c.map((x) => x.id);
        expect(ids).toContain('flashcard_review:due');
        expect(ids).toContain('skill_drill:p5.wordform');
        expect(ids).toContain('mock_test:progress');
        expect(ids).toContain('pronunciation_practice:daily');
        expect(ids).not.toContain('vocab_capture:daily'); // null = none in window, not a nudge
        expect(
            c.find((x) => x.id === 'flashcard_review:due')!.reason.code
        ).toBe('srs_due');
    });

    it('shows "welcome back" framing after a week away', () => {
        const f = features();
        f.activity.daysSinceActive = 10;
        const c = generateCandidates(ctx({ features: f })).find(
            (x) => x.type === 'flashcard_review'
        )!;
        expect(c.reason.code).toBe('welcome_back');
    });

    it('cold start without consent ignores behavioural features but keeps the learner’s own due cards', () => {
        const c = ctx({ personalization: false, resources: [resource('r1')] });
        expect(decideMode(c)).toBe('cold_start');
        const ids = generateCandidates(c).map((x) => x.id);
        expect(ids).toContain('flashcard_review:due');
        expect(ids.some((i) => i.startsWith('skill_drill:'))).toBe(false);
        expect(ids).toContain('resource:r1');
    });

    it('cold start with no features pins the starter diagnostic first', () => {
        const c = ctx({
            features: null,
            resources: [resource('r1')],
            popularity: new Map([['r1', 1]]),
        });
        expect(decideMode(c)).toBe('cold_start');
        const ranked = rankCandidates(
            generateCandidates(c),
            VARIANTS.control,
            'cold_start',
            c
        );
        expect(ranked[0].id).toBe('mock_test:starter');
        expect(ranked[0].reason.code).toBe('starter_diagnostic');
    });

    it('links resources to weak skills through topic tags and explains why', () => {
        const c = ctx({
            resources: [
                resource('match', {
                    labels: {
                        cefr: 'B1',
                        domain: 'travel',
                        topic: ['grammar', 'word form'],
                    },
                }),
                resource('other', {
                    labels: {
                        cefr: 'B1',
                        domain: 'travel',
                        topic: ['cooking'],
                    },
                }),
            ],
        });
        const found = generateCandidates(c).find(
            (x) => x.id === 'resource:match'
        )!;
        expect(found.skillKey).toBe('p5.wordform');
        expect(found.reason.code).toBe('weak_skill');
        expect(
            generateCandidates(c).find((x) => x.id === 'resource:other')
        ).toBeUndefined();
    });

    it('excludes resources marked unsuitable for learners', () => {
        const c = ctx({
            resources: [resource('bad', { suitableForLearners: false })],
        });
        expect(generateCandidates(c).some((x) => x.id === 'resource:bad')).toBe(
            false
        );
    });

    it('learner CEFR comes from the last test when personalised, else from profile level', () => {
        expect(learnerCefr(ctx())).toBe('B1'); // 620
        expect(learnerCefr(ctx({ personalization: false }))).toBe('B1'); // intermediate
    });
});

describe('ranker', () => {
    const cands = () => generateCandidates(ctx());

    it('is deterministic and sorted by score with stable tie-breaks', () => {
        const a = rankCandidates(
            cands(),
            VARIANTS.control,
            'personalized',
            ctx()
        );
        const b = rankCandidates(
            cands(),
            VARIANTS.control,
            'personalized',
            ctx()
        );
        expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
        for (let i = 1; i < a.length; i++)
            expect(a[i - 1].score).toBeGreaterThanOrEqual(a[i].score);
    });

    it('srs_heavy variant scores SRS higher than control', () => {
        const srs = cands().find((c) => c.type === 'flashcard_review')!;
        const x = scoreCandidate(srs, VARIANTS.control.weights, ctx());
        const y = scoreCandidate(srs, VARIANTS.srs_heavy.weights, ctx());
        expect(y.score).toBeGreaterThan(x.score);
    });

    it('penalises recently shown items and recently completed ones', () => {
        const c = cands().find((x) => x.type === 'skill_drill')!;
        const base = scoreCandidate(c, VARIANTS.control.weights, ctx()).score;
        const shown = scoreCandidate(
            c,
            VARIANTS.control.weights,
            ctx({ exposure: new Map([[c.id, { shown7d: 3, clicked: false }]]) })
        );
        expect(shown.score).toBeLessThan(base);
        expect(shown.components.recency).toBeLessThan(0);
        const done = scoreCandidate(
            c,
            VARIANTS.control.weights,
            ctx({
                exposure: new Map([
                    [c.id, { shown7d: 0, clicked: true, completedAt: ago(1) }],
                ]),
            })
        );
        expect(done.components.completedRecently).toBe(-0.25);
    });

    it('cold-start weights have no need/explore components', () => {
        expect(COLD_START_WEIGHTS.need).toBe(0);
        expect(COLD_START_WEIGHTS.explore).toBe(0);
    });
});

const mk = (
    id: string,
    type: Candidate['type'],
    score: number,
    over: Partial<ScoredCandidate> = {}
): ScoredCandidate => ({
    id,
    type,
    ref: id,
    title: id,
    estMinutes: 5,
    signals: {},
    score,
    components: {},
    reason: { code: 'level_fit', params: {} } as ReasonFact,
    action: {},
    ...over,
});

describe('guardrails', () => {
    const base = { now: NOW, availableMinutes: 60 };

    it('suppresses dismissed items within cooldown but not after', () => {
        const recent = hardFilter(
            [mk('a', 'resource', 1)],
            {
                ...base,
                exposure: new Map([
                    ['a', { shown7d: 1, clicked: false, dismissedAt: ago(3) }],
                ]),
            },
            'B1',
            DEFAULT_GUARDRAILS
        );
        expect(recent.suppressed).toEqual([{ id: 'a', rule: 'dismissed' }]);
        const old = hardFilter(
            [mk('a', 'resource', 1)],
            {
                ...base,
                exposure: new Map([
                    ['a', { shown7d: 0, clicked: false, dismissedAt: ago(20) }],
                ]),
            },
            'B1',
            DEFAULT_GUARDRAILS
        );
        expect(old.kept).toHaveLength(1);
    });

    it('frequency cap: shown ≥3× without a click is hidden; a click lifts the cap', () => {
        const hidden = hardFilter(
            [mk('a', 'resource', 1)],
            {
                ...base,
                exposure: new Map([['a', { shown7d: 3, clicked: false }]]),
            },
            'B1',
            DEFAULT_GUARDRAILS
        );
        expect(hidden.suppressed[0].rule).toBe('frequency_cap');
        const clicked = hardFilter(
            [mk('a', 'resource', 1)],
            {
                ...base,
                exposure: new Map([['a', { shown7d: 5, clicked: true }]]),
            },
            'B1',
            DEFAULT_GUARDRAILS
        );
        expect(clicked.kept).toHaveLength(1);
    });

    it('completed resources are hidden 30 days; flashcard block is never cooled down', () => {
        const ex = new Map([
            ['r', { shown7d: 0, clicked: true, completedAt: ago(10) }],
            [
                'flashcard_review:due',
                { shown7d: 0, clicked: true, completedAt: ago(0) },
            ],
        ]);
        const out = hardFilter(
            [
                mk('r', 'resource', 1),
                mk('flashcard_review:due', 'flashcard_review', 1),
            ],
            { ...base, exposure: ex },
            'B1',
            DEFAULT_GUARDRAILS
        );
        expect(out.suppressed.map((s) => s.id)).toEqual(['r']);
    });

    it('rejects resources more than one CEFR step from the learner', () => {
        const out = hardFilter(
            [
                mk('far', 'resource', 1, { cefr: 'C1' }),
                mk('near', 'resource', 1, { cefr: 'B2' }),
            ],
            { ...base, exposure: new Map() },
            'B1',
            DEFAULT_GUARDRAILS
        );
        expect(out.suppressed).toEqual([{ id: 'far', rule: 'cefr_gap' }]);
    });

    it('caps per type and per skill, and allows only one flashcard block', () => {
        const ranked = [
            mk('d1', 'skill_drill', 9, { skillKey: 's1' }),
            mk('d2', 'skill_drill', 8, { skillKey: 's1' }),
            mk('d3', 'skill_drill', 7, { skillKey: 's2' }),
            mk('d4', 'skill_drill', 6, { skillKey: 's3' }),
            mk('f1', 'flashcard_review', 5),
            mk('f2', 'flashcard_review', 4),
            mk('r1', 'resource', 3),
            mk('r2', 'resource', 2),
        ];
        const { selected } = applyGuardrails(
            ranked,
            { ...base, exposure: new Map() },
            undefined,
            { ...DEFAULT_GUARDRAILS, limit: 6, minItems: 1 }
        );
        const ids = selected.map((s) => s.id);
        expect(ids.filter((i) => i.startsWith('d')).length).toBeLessThanOrEqual(
            2
        );
        expect(ids.filter((i) => i.startsWith('f')).length).toBe(1);
        const skills = selected.map((s) => s.skillKey).filter(Boolean);
        expect(skills.filter((s) => s === 's1').length).toBeLessThanOrEqual(2);
    });

    it('diversity floor swaps in another type when the top picks are all one type', () => {
        const ranked = [
            mk('r1', 'resource', 9),
            mk('r2', 'resource', 8),
            mk('r3', 'resource', 7),
            mk('d1', 'skill_drill', 1, { skillKey: 'x' }),
        ];
        const { selected } = applyGuardrails(
            ranked,
            { ...base, exposure: new Map() },
            undefined,
            { ...DEFAULT_GUARDRAILS, maxPerType: 5, limit: 3, minItems: 1 }
        );
        expect(
            new Set(selected.map((s) => s.type)).size
        ).toBeGreaterThanOrEqual(2);
        expect(selected[0].id).toBe('r1'); // best item is never displaced
    });

    it('trims the lowest-ranked items to fit the time budget but keeps the minimum', () => {
        const ranked = [1, 2, 3, 4, 5].map((i) =>
            mk(`x${i}`, i % 2 ? 'resource' : 'skill_drill', 10 - i, {
                estMinutes: 20,
                skillKey: `s${i}`,
            })
        );
        const { selected } = applyGuardrails(
            ranked,
            { now: NOW, availableMinutes: 30, exposure: new Map() },
            undefined,
            DEFAULT_GUARDRAILS
        );
        expect(selected.length).toBe(DEFAULT_GUARDRAILS.minItems);
        expect(selected.map((s) => s.id)).toEqual(['x1', 'x2', 'x3']);
    });
});

describe('explanations', () => {
    const codes: ReasonFact[] = [
        {
            code: 'weak_skill',
            params: { skill: 'Part 5 · word form', pct: 45, n: 20 },
        },
        { code: 'srs_due', params: { count: 12, minutes: 5 } },
        { code: 'explore_skill', params: { skill: 'Part 3 · gist' } },
        {
            code: 'interest_match',
            params: { domain: 'human_resources', cefr: 'B1' },
        },
        { code: 'level_fit', params: { cefr: 'B1' } },
        { code: 'habit_test', params: { days: 30 } },
        { code: 'habit_pronunciation', params: { days: 9 } },
        { code: 'habit_vocab', params: { days: 8 } },
        { code: 'starter_diagnostic', params: {} },
        { code: 'popular_for_level', params: { cefr: 'B1' } },
        { code: 'welcome_back', params: { count: 12 } },
    ];
    it('every reason code renders non-empty English and Vietnamese without "undefined"/"NaN"', () => {
        for (const reason of codes) {
            const r = explain(mk('x', 'resource', 1, { reason }));
            for (const t of [r.text.en, r.text.vi]) {
                expect(t.length).toBeGreaterThan(10);
                expect(t).not.toMatch(/undefined|NaN|\[object/);
            }
        }
    });
    it('puts the evidence into the text', () => {
        const r = explain(mk('x', 'skill_drill', 1, { reason: codes[0] }));
        expect(r.text.en).toContain('45%');
        expect(r.text.en).toContain('word form');
        expect(r.evidence).toMatchObject({ pct: 45, n: 20 });
    });
});

describe('experiments (hash bucketing)', () => {
    it('is deterministic per user and independent across experiments', () => {
        expect(assignVariant('user-1', RANKER_EXPERIMENT, undefined)).toBe(
            assignVariant('user-1', RANKER_EXPERIMENT, undefined)
        );
        expect(bucket('user-1', 'exp_a')).not.toBe(bucket('user-1', 'exp_b'));
    });
    it('splits ~50/50 across 20k users (±2 pp) and respects weights', () => {
        let treat = 0;
        for (let i = 0; i < 20_000; i++)
            if (
                assignVariant(`u${i}`, RANKER_EXPERIMENT, undefined) ===
                'srs_heavy'
            )
                treat++;
        expect(Math.abs(treat / 20_000 - 0.5)).toBeLessThan(0.02);
        const skewed = {
            ...RANKER_EXPERIMENT,
            variants: [
                { name: 'a', weight: 90 },
                { name: 'b', weight: 10 },
            ],
        };
        let b = 0;
        for (let i = 0; i < 20_000; i++)
            if (assignVariant(`u${i}`, skewed, undefined) === 'b') b++;
        expect(Math.abs(b / 20_000 - 0.1)).toBeLessThan(0.02);
    });
    it('kill switch forces a variant; disabled experiment serves the first (control)', () => {
        expect(assignVariant('u', RANKER_EXPERIMENT, 'srs_heavy')).toBe(
            'srs_heavy'
        );
        expect(assignVariant('u', RANKER_EXPERIMENT, 'bogus')).toBeDefined();
        expect(
            assignVariant(
                'u',
                { ...RANKER_EXPERIMENT, enabled: false },
                undefined
            )
        ).toBe('control');
    });
});

describe('buildRecommendations (end to end, pure)', () => {
    const full = () =>
        ctx({
            resources: ['a', 'b', 'c', 'd', 'e'].map((id) => resource(id)),
            popularity: new Map([['a', 0.9]]),
        });

    it('returns ≤ limit unique, ranked, explained items and a timing hint', () => {
        const out = buildRecommendations(full(), VARIANTS.control, 5);
        expect(out.items.length).toBeGreaterThan(0);
        expect(out.items.length).toBeLessThanOrEqual(5);
        expect(new Set(out.items.map((i) => i.id)).size).toBe(out.items.length);
        out.items.forEach((it, idx) => {
            expect(it.rank).toBe(idx + 1);
            expect(it.reason.text.en.length).toBeGreaterThan(10);
        });
        expect(out.timing.bestHour).toBe(20);
        expect(out.mode).toBe('personalized');
    });

    it('never returns a suppressed item (dismissed resource stays out)', () => {
        const c = full();
        c.exposure.set('resource:a', {
            shown7d: 1,
            clicked: false,
            dismissedAt: ago(1),
        });
        const out = buildRecommendations(c, VARIANTS.control, 10);
        expect(out.items.map((i) => i.id)).not.toContain('resource:a');
        expect(out.suppressed).toEqual(
            expect.arrayContaining([{ id: 'resource:a', rule: 'dismissed' }])
        );
    });

    it('brand-new learner with nothing gets a sensible non-empty list (starter first)', () => {
        const out = buildRecommendations(
            ctx({
                features: null,
                resources: [resource('a')],
                personalization: false,
            }),
            VARIANTS.control,
            5
        );
        expect(out.mode).toBe('cold_start');
        expect(out.items[0].id).toBe('mock_test:starter');
        expect(out.items.length).toBeGreaterThanOrEqual(2);
    });

    it('falls back to the preferred study time when there is no behavioural history', () => {
        const c = ctx({
            features: null,
            personalization: false,
            profile: {
                interests: [],
                studyMinutesPerDay: 30,
                preferredStudyTime: 'evening',
            },
        });
        expect(buildRecommendations(c, VARIANTS.control).timing.bestHour).toBe(
            20
        );
    });

    it('repeated generation with exposure feedback rotates items (anti-repetition)', () => {
        const c = full();
        const first = buildRecommendations(c, VARIANTS.control, 3).items.map(
            (i) => i.id
        );
        for (const id of first)
            c.exposure.set(id, { shown7d: 3, clicked: false });
        const second = buildRecommendations(c, VARIANTS.control, 3).items.map(
            (i) => i.id
        );
        expect(second.filter((id) => first.includes(id)).length).toBeLessThan(
            first.length
        );
    });
});
