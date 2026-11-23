import { LearnerFeatureSet } from '../features/featureModels.js';
import {
    MasteryState,
    newMastery,
    sigmoid,
    updateMastery,
    viewMastery,
} from '../features/mastery.js';
import { RecContext } from '../engine/types.js';
import { VARIANTS } from '../engine/ranker.js';
import { buildRecommendations } from '../engine/recommender.js';
import { skillExamWeight } from '../features/skillTaxonomy.js';
import {
    catalogCoverage,
    listDiversity,
    mean,
    ndcgAtK,
    precisionAtK,
} from './metrics.js';
import { TARGET_MASTERY } from '../engine/candidates.js';

/** Deterministic PRNG (mulberry32) so simulations are reproducible in CI. */
export function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const SIM_SKILLS = [
    'p1.identifystatecondition',
    'p2.whquestion',
    'p2.yesno',
    'p3.gist',
    'p3.detail',
    'p3.inference',
    'p4.detail',
    'p4.specific_action',
    'p5.wordform',
    'p5.preposition',
    'p5.vocab_collocation',
    'p6.grammar',
    'p7.single',
    'p7.crossreference',
];

/** Distinct item ids the engine can emit for sim learners: drills + SRS + 2 test kinds + pronunciation + vocab. */
export const CATALOG_SIZE = SIM_SKILLS.length + 5;

export interface SimLearner {
    id: string;
    trueTheta: Record<string, number>;
    ctx: RecContext;
}

const NOW = new Date('2026-03-10T05:00:00Z');

/**
 * Build learners with hidden true abilities; the system only sees noisy estimates produced by
 * the real mastery model from simulated answers – exactly what happens in production.
 */
export function makeLearners(
    count: number,
    seed = 42,
    questionsPerSkill = 12
): SimLearner[] {
    const rand = rng(seed);
    const learners: SimLearner[] = [];
    for (let u = 0; u < count; u++) {
        const trueTheta: Record<string, number> = {};
        const masteries: Array<{ skillKey: string } & MasteryState> = [];
        for (const s of SIM_SKILLS) {
            trueTheta[s] = (rand() - 0.5) * 4; // −2..+2
            let st = newMastery();
            const n = Math.floor(questionsPerSkill * (0.5 + rand()));
            for (let i = 0; i < n; i++) {
                st = updateMastery(st, {
                    correct: rand() < sigmoid(trueTheta[s]),
                    at: NOW,
                });
            }
            masteries.push({ skillKey: s, ...st });
        }
        const skills = masteries.map((m) => {
            const v = viewMastery(m, NOW);
            return {
                skillKey: m.skillKey,
                mastery: v.mastery,
                confidence: v.confidence,
                n: m.n,
                daysSincePractice: 1,
            };
        });
        const due = Math.floor(rand() * 25);
        const features: LearnerFeatureSet = {
            userId: `sim${u}`,
            computedAt: NOW,
            activity: {
                activeDays7: 4,
                activeDays30: 15,
                studyMin7: 100,
                studyMin30: 400,
                streak: 2,
                daysSinceActive: 0,
            },
            performance: {
                acc7: 0.6,
                acc30: 0.6,
                questions30: 150,
                lastTestScore: 450 + Math.floor(rand() * 400),
                scoreTrend: null,
            },
            srs: {
                total: 60,
                due,
                newCards: 5,
                avgRetrievability: 0.6 + rand() * 0.3,
                overdueMax: 2,
            },
            timing: { bestHours: [20] },
            daysSince: {
                test: Math.floor(rand() * 40),
                pronunciation: Math.floor(rand() * 15),
                vocab: Math.floor(rand() * 15),
            },
            engagement: {
                recImpressions30: 0,
                recCtr30: null,
                dismissRate30: null,
                resourceCompletionRate30: null,
            },
            skills,
        };
        learners.push({
            id: `sim${u}`,
            trueTheta,
            ctx: {
                userId: `sim${u}`,
                now: NOW,
                features,
                personalization: true,
                exposure: new Map(),
                profile: {
                    interests: [],
                    studyMinutesPerDay: 45,
                    level: 'intermediate',
                },
                resources: [],
                popularity: new Map(),
                availableMinutes: 45,
            },
        });
    }
    return learners;
}

/** Ground-truth relevance of a recommended item for a simulated learner (0..3). */
export function trueRelevance(
    l: SimLearner,
    item: { type: string; skillKey?: string }
): number {
    if (item.type === 'skill_drill' && item.skillKey) {
        const m = sigmoid(l.trueTheta[item.skillKey] ?? 0);
        const gap = Math.max(0, TARGET_MASTERY - m) / TARGET_MASTERY;
        const g =
            gap *
            (0.6 + 0.4 * Math.min(1, skillExamWeight(item.skillKey) / 0.25));
        return g > 0.45 ? 3 : g > 0.3 ? 2 : g > 0.12 ? 1 : 0;
    }
    if (item.type === 'flashcard_review')
        return (l.ctx.features?.srs.due ?? 0) >= 8 ? 2 : 0;
    if (item.type === 'mock_test')
        return (l.ctx.features?.daysSince.test ?? 0) >= 21 ? 1 : 0;
    return 0;
}

export interface SimReport {
    ranker: string;
    ndcgAt5: number;
    precisionAt3: number;
    diversity: number;
    coverage: number;
}

export type Ranker = (
    l: SimLearner
) => Array<{ id: string; type: string; skillKey?: string }>;

export const rankerFromVariant =
    (name: keyof typeof VARIANTS): Ranker =>
    (l) =>
        buildRecommendations(l.ctx, VARIANTS[name], 5).items;

/** Naive baseline: uniformly random drills (what a non-personalised catalogue would do). */
export const randomRanker = (seed = 7): Ranker => {
    const rand = rng(seed);
    return () => {
        const pool = [...SIM_SKILLS].sort(() => rand() - 0.5).slice(0, 5);
        return pool.map((s) => ({
            id: `skill_drill:${s}`,
            type: 'skill_drill',
            skillKey: s,
        }));
    };
};

export function evaluateRanker(
    name: string,
    ranker: Ranker,
    learners: SimLearner[]
): SimReport {
    const lists = learners.map((l) => ranker(l));
    const rels = lists.map((items, i) =>
        items.map((it) => trueRelevance(learners[i], it))
    );
    // ideal: the best possible grades among all drills for this learner (+ SRS/test relevance)
    const ideals = learners.map((l) => [
        ...SIM_SKILLS.map((s) =>
            trueRelevance(l, { type: 'skill_drill', skillKey: s })
        ),
        trueRelevance(l, { type: 'flashcard_review' }),
        trueRelevance(l, { type: 'mock_test' }),
    ]);
    return {
        ranker: name,
        ndcgAt5: mean(rels.map((r, i) => ndcgAtK(r, 5, ideals[i]))),
        precisionAt3: mean(rels.map((r) => precisionAtK(r, 3))),
        diversity: listDiversity(lists.map((l) => l.map((i) => i.type))),
        coverage: catalogCoverage(
            lists.map((l) => l.map((i) => i.id)),
            CATALOG_SIZE
        ),
    };
}
