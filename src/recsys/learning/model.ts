import { WeightSet } from '../engine/types.js';
import { VARIANTS } from '../engine/ranker.js';
import { LearnerFeatureSet } from '../features/featureModels.js';

/** Signals the ranker understands, in a fixed order shared by training and serving. */
export const SIGNAL_KEYS = Object.keys(VARIANTS.control.weights) as Array<
    keyof WeightSet
>;

export type Segment = 'new' | 'established';
export const SEGMENTS: readonly Segment[] = ['new', 'established'];

/** A learner with few recent answers behaves differently from an established one. */
export function segmentFromQuestions(questions30: number | null | undefined) {
    return (questions30 ?? 0) < 20 ? 'new' : 'established';
}
export const segmentOf = (f: LearnerFeatureSet | null): Segment =>
    segmentFromQuestions(f?.performance.questions30);

/**
 * Turn logistic coefficients into the engine's WeightSet. Only non-negative evidence is kept
 * (a negative coefficient means "this signal does not help", which the additive ranker can only
 * express as 0) and weights are normalised to sum 1 so scores stay on the control's scale.
 * Returns null if nothing positive was learned.
 */
export function toWeightSet(coef: number[]): WeightSet | null {
    const pos = coef.map((c) => Math.max(0, c));
    const sum = pos.reduce((a, b) => a + b, 0);
    if (!(sum > 1e-9)) return null;
    const out = {} as WeightSet;
    SIGNAL_KEYS.forEach((k, i) => (out[k] = Number((pos[i] / sum).toFixed(4))));
    return out;
}

export interface LearnedModelPayload {
    algo: 'logreg-v1';
    global: WeightSet;
    /** May be absent after a Mongo round trip (empty objects are minimised away). */
    segments?: Partial<Record<Segment, WeightSet>>;
}

export function weightsFor(m: LearnedModelPayload, seg: Segment): WeightSet {
    return m.segments?.[seg] ?? m.global;
}

export const POSITION_CAP = 10;
/** Position is a TRAINING-ONLY covariate (position bias); it is not part of serving weights. */
export const positionFeature = (position: number) =>
    Math.log1p(Math.min(Math.max(position, 0), POSITION_CAP)) /
    Math.log1p(POSITION_CAP);

export function featureVector(
    signals: Partial<Record<string, number>>,
    position: number
): number[] {
    return [
        ...SIGNAL_KEYS.map((k) => signals[k] ?? 0),
        positionFeature(position),
    ];
}

/** Fit → weights (position coefficient discarded). */
export function coefToSignalCoef(w: number[]): number[] {
    return w.slice(0, SIGNAL_KEYS.length);
}
