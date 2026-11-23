import {
    precisionAtK,
    recallAtK,
    ndcgAtK,
    mrr,
    catalogCoverage,
    listDiversity,
} from '~/recsys/eval/metrics.js';
import { evaluateReplay } from '~/recsys/eval/replay.js';
import {
    evaluateRanker,
    makeLearners,
    randomRanker,
    rankerFromVariant,
    rng,
    trueRelevance,
} from '~/recsys/eval/simulator.js';

describe('ranking metrics', () => {
    it('precision/recall/mrr on a known list', () => {
        const rels = [0, 1, 0, 2, 0];
        expect(precisionAtK(rels, 3)).toBeCloseTo(1 / 3, 6);
        expect(precisionAtK(rels, 5)).toBeCloseTo(2 / 5, 6);
        expect(recallAtK(rels, 3, 2)).toBeCloseTo(0.5, 6);
        expect(recallAtK(rels, 3, 0)).toBe(0);
        expect(mrr(rels)).toBeCloseTo(0.5, 6);
        expect(mrr([0, 0])).toBe(0);
    });
    it('NDCG is 1 for the ideal order, lower for worse orders, 0 with no relevance', () => {
        expect(ndcgAtK([3, 2, 1, 0], 4)).toBeCloseTo(1, 6);
        const worse = ndcgAtK([0, 1, 2, 3], 4, [3, 2, 1, 0]);
        expect(worse).toBeLessThan(1);
        expect(worse).toBeGreaterThan(0);
        expect(ndcgAtK([0, 0, 0], 3)).toBe(0);
    });
    it('coverage and diversity', () => {
        expect(
            catalogCoverage(
                [
                    ['a', 'b'],
                    ['b', 'c'],
                ],
                6
            )
        ).toBeCloseTo(0.5, 6);
        expect(catalogCoverage([], 0)).toBe(0);
        expect(
            listDiversity([
                ['x', 'x'],
                ['x', 'y'],
            ])
        ).toBeCloseTo((0.5 + 1) / 2, 6);
        expect(listDiversity([[]])).toBe(0);
    });
});

describe('replay evaluation', () => {
    const imp = (
        recId: string,
        variant: string,
        position: number,
        key: string,
        userId = 'u1'
    ) => ({
        recId,
        userId,
        variant,
        position,
        itemKey: key,
        itemType: key.split(':')[0],
    });
    it('computes CTR/completion/dismiss and ranking quality per variant', () => {
        const impressions = [
            imp('r1', 'control', 0, 'skill_drill:a'),
            imp('r1', 'control', 1, 'resource:b'),
            imp('r1', 'control', 2, 'flashcard_review:due'),
            imp('r2', 'srs_heavy', 0, 'flashcard_review:due', 'u2'),
            imp('r2', 'srs_heavy', 1, 'skill_drill:a', 'u2'),
        ];
        const outcomes = [
            {
                recId: 'r1',
                itemKey: 'skill_drill:a',
                kind: 'complete' as const,
            },
            { recId: 'r1', itemKey: 'resource:b', kind: 'dismiss' as const },
            { recId: 'r2', itemKey: 'skill_drill:a', kind: 'click' as const },
        ];
        const [c, s] = evaluateReplay(impressions, outcomes);
        expect(c.variant).toBe('control');
        expect(c.completionRate).toBeCloseTo(1 / 3, 6);
        expect(c.dismissRate).toBeCloseTo(1 / 3, 6);
        expect(c.mrr).toBe(1);
        expect(s.variant).toBe('srs_heavy');
        expect(s.ctr).toBeCloseTo(0.5, 6);
        expect(s.mrr).toBe(0.5);
        expect(c.users).toBe(1);
    });
    it('handles empty logs', () => {
        expect(evaluateReplay([], [])).toEqual([]);
    });
});

describe('offline simulation (seeded, deterministic)', () => {
    const learners = makeLearners(300, 42);
    const random = evaluateRanker('random', randomRanker(), learners);
    const control = evaluateRanker(
        'control',
        rankerFromVariant('control'),
        learners
    );
    const srs = evaluateRanker(
        'srs_heavy',
        rankerFromVariant('srs_heavy'),
        learners
    );

    it('is reproducible', () => {
        const again = evaluateRanker(
            'control',
            rankerFromVariant('control'),
            makeLearners(300, 42)
        );
        expect(again.ndcgAt5).toBeCloseTo(control.ndcgAt5, 10);
        expect(rng(1)()).toBe(rng(1)());
    });

    it('PASS CRITERIA: control clearly beats random on NDCG@5 (+0.08) and P@3 (≥0.85)', () => {
        expect(control.ndcgAt5).toBeGreaterThan(random.ndcgAt5 + 0.08);
        expect(control.precisionAt3).toBeGreaterThanOrEqual(0.85);
    });

    it('PASS CRITERIA: diversity floor holds (≥0.6 distinct types) and coverage ≤ 1', () => {
        expect(control.diversity).toBeGreaterThanOrEqual(0.6);
        expect(control.coverage).toBeLessThanOrEqual(1);
        expect(control.coverage).toBeGreaterThan(0.5);
    });

    it('srs_heavy stays within 10% of control on need-targeting (no big regression)', () => {
        expect(srs.ndcgAt5).toBeGreaterThan(control.ndcgAt5 * 0.9);
    });

    it('trueRelevance gives weak skills higher grades than strong ones', () => {
        const l = learners[0];
        const weak = Object.entries(l.trueTheta).sort(
            (a, b) => a[1] - b[1]
        )[0][0];
        const strong = Object.entries(l.trueTheta).sort(
            (a, b) => b[1] - a[1]
        )[0][0];
        expect(
            trueRelevance(l, { type: 'skill_drill', skillKey: weak })
        ).toBeGreaterThan(
            trueRelevance(l, { type: 'skill_drill', skillKey: strong })
        );
    });
});
