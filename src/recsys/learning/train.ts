import { createHash } from 'node:crypto';
import { WeightSet } from '../engine/types.js';
import { VARIANTS } from '../engine/ranker.js';
import { recsysConfig } from '../config.js';
import { auc, trainLogReg } from './logreg.js';
import {
    LearnedModelPayload,
    SIGNAL_KEYS,
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
        rows.map((r) => (r.clicked ? 1 : 0))
    );

const fit = (rows: TrainingRow[]): WeightSet | null => {
    const m = trainLogReg(
        rows.map((r) => ({
            x: featureVector(r.signals, r.position),
            y: r.clicked ? (1 as const) : (0 as const),
        }))
    );
    return toWeightSet(coefToSignalCoef(m.w));
};

export function trainRanker(
    rows: TrainingRow[],
    th: Thresholds = defaultThresholds()
): TrainReport {
    const reasons: string[] = [];
    const train = rows.filter((r) => !isHoldout(r.userId));
    const hold = rows.filter((r) => isHoldout(r.userId));
    const positives = rows.filter((r) => r.clicked).length;
    const holdPos = hold.filter((r) => r.clicked).length;
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
        reasons.push(`only ${positives} clicks (< ${th.minPositives})`);
    if (reasons.length) return report; // data gate first: never fit on a handful of rows

    const global = fit(train);
    if (!global) {
        reasons.push('no positive signal weight was learned');
        return report;
    }
    const segments: Partial<Record<Segment, WeightSet>> = {};
    for (const seg of SEGMENTS) {
        const tr = train.filter((r) => r.segment === seg);
        const ho = hold.filter((r) => r.segment === seg);
        const trPos = tr.filter((r) => r.clicked).length;
        if (trPos < th.minSegmentPositives || ho.length === 0) continue;
        const w = fit(tr);
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
        hold.map((r) => (r.clicked ? 1 : 0))
    );
    const controlAuc = aucOf(hold, VARIANTS.control.weights);
    report.metrics.aucLearned = servedAuc;
    report.metrics.aucControl = controlAuc;
    if (holdPos < 50) reasons.push(`holdout has only ${holdPos} clicks (< 50)`);
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
