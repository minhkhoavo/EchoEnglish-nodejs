import {
    LearnerFeatureSet,
    SkillFeature,
} from '~/recsys/features/featureModels.js';
import { RecContext, ResourceLike } from '~/recsys/engine/types.js';

export const NOW = new Date('2026-03-10T05:00:00Z');

export const skill = (
    skillKey: string,
    mastery: number,
    n = 20,
    confidence = 0.86,
    daysSincePractice: number | null = 2
): SkillFeature => ({
    skillKey,
    mastery,
    confidence,
    n,
    daysSincePractice,
});

export function features(
    over: Partial<LearnerFeatureSet> = {}
): LearnerFeatureSet {
    return {
        userId: 'u1',
        computedAt: NOW,
        activity: {
            activeDays7: 4,
            activeDays30: 15,
            studyMin7: 120,
            studyMin30: 400,
            streak: 3,
            daysSinceActive: 0,
        },
        performance: {
            acc7: 0.6,
            acc30: 0.62,
            questions30: 120,
            lastTestScore: 620,
            scoreTrend: 10,
        },
        srs: {
            total: 40,
            due: 12,
            newCards: 5,
            avgRetrievability: 0.8,
            overdueMax: 3,
        },
        timing: { bestHours: [20] },
        daysSince: { test: 5, pronunciation: 2, vocab: 1 },
        engagement: {
            recImpressions30: 30,
            recCtr30: 0.3,
            dismissRate30: 0.05,
            resourceCompletionRate30: 0.5,
        },
        skills: [
            skill('p5.wordform', 0.45),
            skill('p3.inference', 0.55),
            skill('p7.single', 0.75),
            skill('p2.whquestion', 0.9),
        ],
        ...over,
    };
}

export const resource = (
    id: string,
    over: Partial<ResourceLike> = {}
): ResourceLike => ({
    _id: { toString: () => id },
    type: 'article',
    title: `Resource ${id}`,
    suitableForLearners: true,
    labels: { cefr: 'B1', domain: 'business', topic: ['grammar', 'word form'] },
    ...over,
});

export function ctx(over: Partial<RecContext> = {}): RecContext {
    return {
        userId: 'u1',
        now: NOW,
        features: features(),
        profile: {
            interests: ['business'],
            studyMinutesPerDay: 30,
            level: 'intermediate',
        },
        personalization: true,
        exposure: new Map(),
        resources: [],
        popularity: new Map(),
        availableMinutes: 30,
        ...over,
    };
}
