import {
    updateMastery,
    newMastery,
    viewMastery,
    sigmoid,
    learningRate,
    MasteryState,
} from '~/recsys/features/mastery.js';
import {
    retrievability,
    stabilityDays,
    cardRetention,
    FACTOR,
} from '~/recsys/features/retention.js';
import {
    deriveSkillKey,
    skillExamWeight,
    skillPart,
    skillLabel,
} from '~/recsys/features/skillTaxonomy.js';
import {
    computeStreak,
    scoreTrend,
    computeFeatures,
} from '~/recsys/features/featureBuilder.js';
import { DailyFactsData } from '~/recsys/etl/models.js';

const T0 = new Date('2026-03-10T00:00:00Z');
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

describe('mastery (Elo / 1-PL)', () => {
    it('rises with correct answers and falls with wrong ones', () => {
        let s = newMastery();
        for (let i = 0; i < 10; i++)
            s = updateMastery(s, { correct: true, at: day(i) });
        const up = s.theta;
        expect(up).toBeGreaterThan(0.5);
        for (let i = 0; i < 10; i++)
            s = updateMastery(s, { correct: false, at: day(20 + i) });
        expect(s.theta).toBeLessThan(up);
    });

    it('rewards correct answers on hard items more than on easy ones', () => {
        const hard = updateMastery(newMastery(), {
            correct: true,
            difficulty: 'advanced',
            at: T0,
        });
        const easy = updateMastery(newMastery(), {
            correct: true,
            difficulty: 'beginner',
            at: T0,
        });
        expect(hard.theta).toBeGreaterThan(easy.theta);
    });

    it('converges near the true success rate for a stationary learner', () => {
        let s: MasteryState = newMastery();
        // deterministic 80% pattern: 4 correct, 1 wrong, repeated
        for (let i = 0; i < 400; i++)
            s = updateMastery(s, { correct: i % 5 !== 4, at: day(i % 30) });
        expect(sigmoid(s.theta)).toBeGreaterThan(0.7);
        expect(sigmoid(s.theta)).toBeLessThan(0.88);
    });

    it('learning rate shrinks with experience but never below the floor', () => {
        expect(learningRate(0)).toBeGreaterThan(learningRate(50));
        expect(learningRate(10_000)).toBeCloseTo(0.06, 5);
    });

    it('theta is bounded', () => {
        let s = newMastery();
        for (let i = 0; i < 5000; i++)
            s = updateMastery(s, {
                correct: true,
                difficulty: 'advanced',
                at: T0,
            });
        expect(s.theta).toBeLessThanOrEqual(4);
    });

    it('stale mastery decays toward the prior and confidence grows with n', () => {
        let s = newMastery();
        for (let i = 0; i < 30; i++)
            s = updateMastery(s, { correct: true, at: T0 });
        const fresh = viewMastery(s, T0);
        const stale = viewMastery(s, day(120));
        expect(stale.mastery).toBeLessThan(fresh.mastery);
        expect(stale.mastery).toBeGreaterThan(0.5);
        expect(viewMastery(newMastery(), T0).confidence).toBe(0);
        expect(fresh.confidence).toBeGreaterThan(0.9);
    });
});

describe('forgetting curve', () => {
    it('R(S,S) = 0.9 by construction', () => {
        for (const s of [1, 3, 7, 30])
            expect(retrievability(s, s)).toBeCloseTo(0.9, 6);
        expect(FACTOR).toBeCloseTo(19 / 81, 6);
    });
    it('is monotone decreasing in elapsed time and increasing in stability', () => {
        expect(retrievability(1, 3)).toBeGreaterThan(retrievability(10, 3));
        expect(retrievability(5, 30)).toBeGreaterThan(retrievability(5, 3));
        expect(retrievability(0, 3)).toBe(1);
    });
    it('maps Leitner levels to interval stability and clamps out-of-range levels', () => {
        expect(stabilityDays(5)).toBe(30);
        expect(stabilityDays(99)).toBe(30);
        expect(stabilityDays(-3)).toBe(1);
    });
    it('classifies new vs due vs fresh cards', () => {
        const now = day(10);
        expect(cardRetention({ level_memory: 0 }, now)).toMatchObject({
            isNew: true,
            due: true,
        });
        const overdue = cardRetention(
            { level_memory: 2, lastReviewDate: day(0), nextReviewDate: day(3) },
            now
        );
        expect(overdue.due).toBe(true);
        expect(overdue.overdueDays).toBeCloseTo(7, 5);
        expect(overdue.retrievability).toBeLessThan(0.9);
        const fresh = cardRetention(
            {
                level_memory: 4,
                lastReviewDate: day(9),
                nextReviewDate: day(23),
            },
            now
        );
        expect(fresh.due).toBe(false);
        expect(fresh.retrievability).toBeGreaterThan(0.95);
    });
});

describe('skill taxonomy', () => {
    it('derives stable keys per part and falls back to part:<n>', () => {
        expect(deriveSkillKey('5', { grammarPoint: 'wordForm' })).toBe(
            'p5.wordform'
        );
        expect(deriveSkillKey(3, { skillCategory: 'INFERENCE' })).toBe(
            'p3.inference'
        );
        expect(deriveSkillKey('2', { questionForm: 'whQuestion' })).toBe(
            'p2.whquestion'
        );
        expect(deriveSkillKey('7', { requiresCrossReference: true })).toBe(
            'p7.crossreference'
        );
        expect(deriveSkillKey('5', { vocabPoint: 'collocation' })).toBe(
            'p5.vocab_collocation'
        );
        expect(deriveSkillKey('6', {})).toBe('part:6');
        expect(deriveSkillKey(undefined, undefined)).toBe('unknown');
    });
    it('weights skills by the share of the exam their part covers', () => {
        expect(skillExamWeight('p7.single')).toBeGreaterThan(
            skillExamWeight('p1.identifystatecondition')
        );
        expect(skillPart('p5.wordform')).toBe(5);
        expect(skillLabel('p5.wordForm')).toBe('Part 5 · word form');
    });
});

describe('streak and trend', () => {
    const set = (...d: string[]) => new Set(d);
    it('streak counts back from today, or yesterday if today is not over', () => {
        expect(
            computeStreak(
                set('2026-03-10', '2026-03-09', '2026-03-08'),
                '2026-03-10'
            )
        ).toBe(3);
        expect(
            computeStreak(set('2026-03-09', '2026-03-08'), '2026-03-10')
        ).toBe(2);
        expect(computeStreak(set('2026-03-07'), '2026-03-10')).toBe(0);
        expect(computeStreak(set(), '2026-03-10')).toBe(0);
    });
    it('score trend is a slope, null with fewer than 2 tests', () => {
        expect(scoreTrend([500])).toBeNull();
        expect(scoreTrend([500, 550, 600])).toBeCloseTo(50, 6);
        expect(scoreTrend([600, 550, 500])).toBeCloseTo(-50, 6);
    });
});

describe('computeFeatures', () => {
    const base = (
        d: string,
        over: Partial<DailyFactsData> = {}
    ): DailyFactsData => ({
        userId: 'u',
        day: d,
        studySeconds: 600,
        sessions: 1,
        questionsAnswered: 10,
        questionsCorrect: 7,
        bySkill: [],
        flashcardsReviewed: 0,
        flashcardsRemembered: 0,
        vocabCaptured: 0,
        resourcesViewed: 2,
        resourcesCompleted: 1,
        pronunciationAttempts: 0,
        pronunciationAccuracySum: 0,
        writingAttempts: 0,
        testsSubmitted: 0,
        creditsSpent: 0,
        aiCostUsd: 0,
        aiTokens: 0,
        recImpressions: 10,
        recClicks: 3,
        recCompletes: 1,
        recDismisses: 1,
        activeHours: Object.assign(new Array(24).fill(0), { 20: 5, 7: 2 }),
        learningActions: 10,
        ...over,
    });
    it('aggregates activity, performance, timing and engagement', () => {
        const f = computeFeatures({
            userId: 'u',
            now: new Date('2026-03-10T05:00:00Z'),
            facts: [
                base('2026-03-10'),
                base('2026-03-09'),
                base('2026-02-20', { lastTestScore: 600 }),
            ],
            masteries: [
                {
                    skillKey: 'p5.wordform',
                    theta: -1,
                    n: 20,
                    correct: 8,
                    lastPracticedAt: day(0),
                },
            ],
            cards: [
                { level_memory: 0 },
                {
                    level_memory: 3,
                    lastReviewDate: day(-1),
                    nextReviewDate: day(6),
                },
            ],
        });
        expect(f.activity.streak).toBe(2);
        expect(f.activity.activeDays30).toBe(3);
        expect(f.activity.studyMin7).toBe(20);
        expect(f.performance.acc30).toBeCloseTo(0.7, 6);
        expect(f.performance.lastTestScore).toBe(600);
        expect(f.timing.bestHours).toEqual([20, 7]);
        expect(f.engagement.recCtr30).toBeCloseTo(0.3, 6);
        expect(f.srs).toMatchObject({ total: 2, newCards: 1 });
        expect(f.skills[0].mastery).toBeLessThan(0.5);
    });
    it('handles a brand-new learner with no data (nulls, not NaN)', () => {
        const f = computeFeatures({
            userId: 'u',
            now: day(0),
            facts: [],
            masteries: [],
            cards: [],
        });
        expect(f.activity.daysSinceActive).toBeNull();
        expect(f.performance.acc30).toBeNull();
        expect(f.srs.avgRetrievability).toBeNull();
        expect(f.timing.bestHours).toEqual([]);
        expect(f.engagement.recCtr30).toBeNull();
    });
});
