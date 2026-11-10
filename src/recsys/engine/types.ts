import { LearnerFeatureSet } from '../features/featureModels.js';

export type ItemType =
    | 'flashcard_review'
    | 'skill_drill'
    | 'resource'
    | 'mock_test'
    | 'pronunciation_practice'
    | 'vocab_capture';

export type ReasonCode =
    | 'weak_skill'
    | 'srs_due'
    | 'explore_skill'
    | 'interest_match'
    | 'level_fit'
    | 'habit_test'
    | 'habit_pronunciation'
    | 'habit_vocab'
    | 'starter_diagnostic'
    | 'popular_for_level'
    | 'similar_to_completed'
    | 'welcome_back'
    | 'refresh_skill';

export interface ReasonFact {
    code: ReasonCode;
    params: Record<string, string | number>;
}

/** Normalised ranking signals, each in [0,1]. Missing = 0. */
export interface Signals {
    need?: number;
    srs?: number;
    interest?: number;
    levelFit?: number;
    habit?: number;
    explore?: number;
    popularity?: number;
    /** Embedding similarity to what the learner finished (0 unless embeddings are enabled). */
    semantic?: number;
}

export interface Candidate {
    id: string;
    type: ItemType;
    ref: string;
    title: string;
    /** Vietnamese title; defaults to `title` (resource titles are not translated). */
    titleVi?: string;
    estMinutes: number;
    skillKey?: string;
    cefr?: string;
    signals: Signals;
    /** Additive score bump for pinned items (e.g. the starter diagnostic). */
    boost?: number;
    reason: ReasonFact;
    /** Payload the client needs to deep-link into the right screen. */
    action: Record<string, unknown>;
}

export interface ScoredCandidate extends Candidate {
    score: number;
    components: Record<string, number>;
}

export interface ResourceLike {
    _id: { toString(): string };
    type?: string;
    title?: string;
    summary?: string;
    labels?: { cefr?: string; domain?: string; topic?: string[] };
    suitableForLearners?: boolean;
    publishedAt?: Date;
}

export interface LearnerProfile {
    targetScore?: number;
    level?: string; // beginner | intermediate | upper_intermediate | advanced
    interests: string[];
    studyMinutesPerDay: number;
    preferredStudyTime?: 'morning' | 'afternoon' | 'evening' | 'night';
}

export interface ExposureStats {
    shown7d: number;
    clicked: boolean;
    completedAt?: Date;
    dismissedAt?: Date;
}
export type ExposureMap = Map<string, ExposureStats>;

export interface RecContext {
    userId: string;
    now: Date;
    features: LearnerFeatureSet | null;
    profile: LearnerProfile;
    personalization: boolean;
    exposure: ExposureMap;
    resources: ResourceLike[];
    popularity: Map<string, number>;
    availableMinutes: number;
    /** Per-resource similarity to the learner's completed resources; absent unless enabled. */
    semantic?: { sim: Map<string, number>; seedTitle?: string } | null;
}

export type WeightSet = Required<Signals>;

export interface Variant {
    name: string;
    weights: WeightSet;
}

export interface RecommendationItem {
    rank: number;
    id: string;
    type: ItemType;
    ref: string;
    title: string;
    titleI18n: { en: string; vi: string };
    estMinutes: number;
    skillKey?: string;
    score: number;
    reason: {
        code: ReasonCode;
        text: { en: string; vi: string };
        evidence: Record<string, string | number>;
    };
    action: Record<string, unknown>;
}

export interface RecommendationResponse {
    recId: string;
    generatedAt: string;
    variant: string;
    algo: string;
    mode: 'personalized' | 'cold_start';
    timing: {
        bestHour: number | null;
        suggestion: string;
        suggestionI18n: { en: string; vi: string };
    };
    totalMinutes: number;
    items: RecommendationItem[];
}
