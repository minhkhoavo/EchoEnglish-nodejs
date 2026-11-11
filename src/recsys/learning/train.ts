import { createHash } from 'node:crypto';
import { WeightSet } from '../engine/types.js';
import { VARIANTS } from '../engine/ranker.js';
import { recsysConfig } from '../config.js';
import { auc, trainLogReg } from './logreg.js';
import { ReplayEstimate } from '../eval/counterfactual.js';
import {
    LearnedModelPayload,
    SIGNAL_KEYS,
    POSITION_CAP,
    SEGMENTS,
    Segment,
    coefToSignalCoef,
    featureVector,
    toWeightSet,
} from './model.js';

/** One shown item and what happened to it. `segment` comes from the as-of feature snapshot. */
export interface TrainingRow {
    userId: string;
    recId: string;
    signals: Partial<Record<string, number>>;
    position: number;
    segment: Segment | null;
    clicked: boolean;
    /**
     * What the model learns to predict. Absent = `clicked`. The production loader sets it to
     * "a click that led to verified learning" (see dataset.ts) so the ranker is not rewarded
     * for items that are merely attractive.
     */
    label?: boolean;
    /** Shown by the randomised slot: its position is independent of its relevance. */
    explored?: boolean;
    /** `recId|itemType|itemRef`, to join back to the served-list log. */
    itemKey?: string;
}

const positive = (r: TrainingRow): boolean => r.label ?? r.clicked;
const y = (r: TrainingRow): 0 | 1 => (positive(r) ? 1 : 0);

/** Explored impressions needed at a position before its examination rate is trusted. */
export const MIN_EXPLORED_PER_POSITION = 200;
const MIN_THETA = 0.1;

export interface PositionBias {
    /** Relative chance an item is examined at each position (position 0 = 1). */
    theta: number[];
    explored: number[];
}

/**
 * Position bias from the randomised slot. Items placed there are random with respect to
 * relevance, so the positive rate per position among them is proportional to how often that
 * position is examined. Returns null until positions 0 and 1 both have enough explored
 * impressions; positions without enough data inherit the previous position's value.
 */
export function estimatePositionBias(rows: TrainingRow[]): PositionBias | null {
    const n: number[] = [];
    const pos: number[] = [];
    for (const r of rows) {
        if (!r.explored) continue;
        const k = Math.min(Math.max(0, r.position), POSITION_CAP);
        n[k] = (n[k] ?? 0) + 1;
        pos[k] = (pos[k] ?? 0) + y(r);
    }
    const enough = (k: number) => (n[k] ?? 0) >= MIN_EXPLORED_PER_POSITION;
    if (!enough(0) || !enough(1) || !(pos[0] > 0)) return null;
    const base = pos[0] / n[0];
    const theta: number[] = [];
    for (let k = 0; k <= POSITION_CAP; k++)
        theta[k] = enough(k)
            ? Math.min(1, Math.max(MIN_THETA, pos[k] / n[k] / base))
            : (theta[k - 1] ?? 1);
    return {
        theta: theta.map((t) => Number(t.toFixed(4))),
        explored: Array.from({ length: POSITION_CAP + 1 }, (_, k) => n[k] ?? 0),
    };
}

export interface Thresholds {
    minRows: number;
    minPositives: number;
    minAucLift: number;
    minSegmentPositives: number;
}

export const defaultThresholds = (): Thresholds => ({
    minRows: recsysConfig.retrain.minRows(),
    minPositives: recsysConfig.retrain.minPositives(),
    minAucLift: recsysConfig.retrain.minAucLift(),
    minSegmentPositives: 150,
});

export interface TrainReport {
    payload: LearnedModelPayload | null;
    gatePassed: boolean;
    reasons: string[];
    counts: {
        rows: number;
        positives: number;
        trainRows: number;
        holdoutRows: number;
        holdoutPositives: number;
    };
    metrics: {
        aucLearned: number | null;
        aucControl: number | null;
        lift: number | null;
        /** How position bias was handled: IPW from the randomised slot, or a covariate. */
        positionBias?: { method: 'ipw' | 'covariate'; theta?: number[] };
        /** Replay estimate on real exploration logs (set by the retrain service). */
        counterfactual?: {
            control: ReplayEstimate;
            learned: ReplayEstimate;
        };
        segments: Partial<
            Record<
                Segment,
                {
                    n: number;
                    aucLearned: number | null;
                    aucGlobal: number | null;
                    used: boolean;
                }
            >
        >;
    };
}

/** Deterministic user-level split: a learner is entirely in train or entirely in holdout. */
export const isHoldout = (userId: string, pct = 20): boolean =>
    createHash('sha256').update(`split:${userId}`).digest().readUInt16BE(0) %
        100 <
    pct;

const score = (w: WeightSet, signals: Partial<Record<string, number>>) =>
    SIGNAL_KEYS.reduce((a, k) => a + (signals[k] ?? 0) * w[k], 0);

const aucOf = (rows: TrainingRow[], w: WeightSet) =>
    auc(
        rows.map((r) => score(w, r.signals)),
        rows.map(y)
    );

const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

/**
 * With a measured position bias the fit is inverse-propensity weighted (a positive seen at a
 * rarely examined position counts for more) and position is no longer a covariate. Without it,
 * position stays a training-only covariate — weaker, because position and relevance are
 * confounded in logs produced by a deterministic ranker.
 */
const fit = async (
    rows: TrainingRow[],
    bias: PositionBias | null
): Promise<WeightSet | null> => {
    // Built in yielded chunks: training runs inside the API process.
    const labelled: Array<{ x: number[]; y: 0 | 1; w?: number }> = [];
    for (let i = 0; i < rows.length; i += 20_000) {
        for (const r of rows.slice(i, i + 20_000)) {
            const label = y(r);
            if (bias) {
                const k = Math.min(Math.max(0, r.position), POSITION_CAP);
                labelled.push({
                    x: featureVector(r.signals, 0),
                    y: label,
                    w: label ? 1 / bias.theta[k] : 1,
                });
            } else
                labelled.push({
                    x: featureVector(r.signals, r.position),
                    y: label,
                });
        }
        await yieldToEventLoop();
    }
    const m = await trainLogReg(labelled);
    return toWeightSet(coefToSignalCoef(m.w));
};

export async function trainRanker(
    rows: TrainingRow[],
    th: Thresholds = defaultThresholds()
): Promise<TrainReport> {
    const reasons: string[] = [];
    // One hash per distinct learner, not per row (a SHA-256 per row blocked the loop for ~1 s).
    const holdByUser = new Map<string, boolean>();
    const inHoldout = (u: string) => {
        let v = holdByUser.get(u);
        if (v === undefined) holdByUser.set(u, (v = isHoldout(u)));
        return v;
    };
    const train: TrainingRow[] = [];
    const hold: TrainingRow[] = [];
    for (const r of rows) (inHoldout(r.userId) ? hold : train).push(r);
    const positives = rows.filter(positive).length;
    const holdPos = hold.filter(positive).length;
    const report: TrainReport = {
        payload: null,
        gatePassed: false,
        reasons,
        counts: {
            rows: rows.length,
            positives,
            trainRows: train.length,
            holdoutRows: hold.length,
            holdoutPositives: holdPos,
        },
        metrics: {
            aucLearned: null,
            aucControl: null,
            lift: null,
            segments: {},
        },
    };
    if (rows.length < th.minRows)
        reasons.push(`only ${rows.length} impressions (< ${th.minRows})`);
    if (positives < th.minPositives)
        reasons.push(`only ${positives} positives (< ${th.minPositives})`);
    if (reasons.length) return report; // data gate first: never fit on a handful of rows

    // Estimated on TRAIN users only, so the holdout stays untouched.
    const bias = estimatePositionBias(train);
    report.metrics.positionBias = bias
        ? { method: 'ipw', theta: bias.theta }
        : { method: 'covariate' };
    const global = await fit(train, bias);
    if (!global) {
        reasons.push('no positive signal weight was learned');
        return report;
    }
    const segments: Partial<Record<Segment, WeightSet>> = {};
    for (const seg of SEGMENTS) {
        const tr = train.filter((r) => r.segment === seg);
        const ho = hold.filter((r) => r.segment === seg);
        const trPos = tr.filter(positive).length;
        if (trPos < th.minSegmentPositives || ho.length === 0) continue;
        const w = await fit(tr, bias);
        if (!w) continue;
        const aucSeg = aucOf(ho, w);
        const aucGlob = aucOf(ho, global);
        const used = aucSeg !== null && aucGlob !== null && aucSeg > aucGlob;
        report.metrics.segments[seg] = {
            n: ho.length,
            aucLearned: aucSeg,
            aucGlobal: aucGlob,
            used,
        };
        if (used) segments[seg] = w;
    }
    const payload: LearnedModelPayload = {
        algo: 'logreg-v1',
        global,
        segments,
    };

    // Evaluate exactly as served: each holdout row is scored with its segment's weights.
    const servedAuc = auc(
        hold.map((r) =>
            score((r.segment && segments[r.segment]) || global, r.signals)
        ),
        hold.map(y)
    );
    const controlAuc = aucOf(hold, VARIANTS.control.weights);
    report.metrics.aucLearned = servedAuc;
    report.metrics.aucControl = controlAuc;
    if (holdPos < 50)
        reasons.push(`holdout has only ${holdPos} positives (< 50)`);
    if (servedAuc === null || controlAuc === null) {
        reasons.push('holdout lacks both classes');
        return report;
    }
    report.metrics.lift = Number((servedAuc - controlAuc).toFixed(4));
    if (report.metrics.lift < th.minAucLift)
        reasons.push(
            `AUC lift ${report.metrics.lift} < required ${th.minAucLift}`
        );
    report.payload = payload;
    report.gatePassed = reasons.length === 0;
    return report;
}
