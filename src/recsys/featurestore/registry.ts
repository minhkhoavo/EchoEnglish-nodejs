import { LearnerFeatureSet } from '../features/featureModels.js';

/**
 * Feature registry: the single list of learner features that are snapshotted, joined
 * point-in-time and used for training. Add a feature by appending here and bumping
 * REGISTRY_VERSION; never repurpose a name (old snapshots keep their meaning).
 */
export const REGISTRY_VERSION = 1;

export interface FeatureDef {
    name: string;
    description: string;
    extract: (f: LearnerFeatureSet) => number | null;
}

const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

export const FEATURES: readonly FeatureDef[] = [
    {
        name: 'activeDays7',
        description: 'Active days in the last 7',
        extract: (f) => num(f.activity.activeDays7),
    },
    {
        name: 'activeDays30',
        description: 'Active days in the last 30',
        extract: (f) => num(f.activity.activeDays30),
    },
    {
        name: 'studyMin7',
        description: 'Study minutes, last 7 days',
        extract: (f) => num(f.activity.studyMin7),
    },
    {
        name: 'studyMin30',
        description: 'Study minutes, last 30 days',
        extract: (f) => num(f.activity.studyMin30),
    },
    {
        name: 'streak',
        description: 'Consecutive active days',
        extract: (f) => num(f.activity.streak),
    },
    {
        name: 'daysSinceActive',
        description: 'Days since last activity',
        extract: (f) => num(f.activity.daysSinceActive),
    },
    {
        name: 'acc7',
        description: 'Answer accuracy, 7 days',
        extract: (f) => num(f.performance.acc7),
    },
    {
        name: 'acc30',
        description: 'Answer accuracy, 30 days',
        extract: (f) => num(f.performance.acc30),
    },
    {
        name: 'questions30',
        description: 'Questions answered, 30 days',
        extract: (f) => num(f.performance.questions30),
    },
    {
        name: 'lastTestScore',
        description: 'Last full-test TOEIC score',
        extract: (f) => num(f.performance.lastTestScore),
    },
    {
        name: 'srsDue',
        description: 'Flashcards due',
        extract: (f) => num(f.srs.due),
    },
    {
        name: 'srsTotal',
        description: 'Flashcards total',
        extract: (f) => num(f.srs.total),
    },
    {
        name: 'srsAvgRetrievability',
        description: 'Mean estimated retrievability',
        extract: (f) => num(f.srs.avgRetrievability),
    },
    {
        name: 'recCtr30',
        description: 'Recommendation click-through, 30 days',
        extract: (f) => num(f.engagement.recCtr30),
    },
    {
        name: 'dismissRate30',
        description: 'Recommendation dismiss rate, 30 days',
        extract: (f) => num(f.engagement.dismissRate30),
    },
];

export const FEATURE_NAMES: readonly string[] = FEATURES.map((f) => f.name);

export type FeatureValues = Record<string, number | null>;

export function flattenFeatures(f: LearnerFeatureSet): FeatureValues {
    const out: FeatureValues = {};
    for (const d of FEATURES) out[d.name] = d.extract(f);
    return out;
}
