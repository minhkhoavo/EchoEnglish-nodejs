import mongoose, { Schema, model } from 'mongoose';
import { difficultyB, sigmoid } from './mastery.js';

/**
 * Per-question difficulty, calibrated from how learners actually answer it. Aggregate counts
 * only (no user id), so it is not personal data and is not touched by erasure.
 */
const schema = new Schema(
    {
        _id: { type: String }, // `${testId}:${questionNumber}`
        n: { type: Number, default: 0 },
        correct: { type: Number, default: 0 },
        updatedAt: { type: Date },
    },
    { collection: 'item_difficulty', versionKey: false }
);
export const ItemDifficulty =
    mongoose.models.ItemDifficulty || model('ItemDifficulty', schema);

/** Answers needed before the measured difficulty replaces the three-level label. */
export const MIN_ITEM_ANSWERS = 20;
/** Weight of the label prior, in pseudo-answers. */
const PRIOR_ANSWERS = 10;

export const itemKey = (
    testId: unknown,
    questionNumber: unknown
): string | null =>
    typeof testId === 'string' && typeof questionNumber === 'number'
        ? `${testId}:${questionNumber}`
        : null;

/**
 * Difficulty b on the mastery scale (P(correct) = σ(θ − b)) from answer counts, shrunk toward
 * the labelled level: p̂ = (correct + m·p₀) / (n + m), b = −logit(p̂). The reference learner is
 * θ = 0, so b is relative to the average learner who took the question.
 */
export function calibratedB(
    n: number,
    correct: number,
    level?: string
): number {
    const p0 = sigmoid(-difficultyB(level));
    const p = (correct + PRIOR_ANSWERS * p0) / (n + PRIOR_ANSWERS);
    const clipped = Math.min(0.98, Math.max(0.02, p));
    return Number((-Math.log(clipped / (1 - clipped))).toFixed(4));
}

export interface AnswerLike {
    type: string;
    props: Record<string, unknown>;
}

/** Count NEW answers (callers pass only events that were inserted into silver for the first time). */
export async function recordAnswers(
    events: AnswerLike[],
    now = new Date()
): Promise<number> {
    const inc = new Map<string, { n: number; correct: number }>();
    for (const e of events) {
        if (e.type !== 'question_answered') continue;
        const key = itemKey(e.props.testId, e.props.questionNumber);
        if (!key) continue;
        const c = inc.get(key) ?? { n: 0, correct: 0 };
        c.n++;
        if (e.props.correct === true) c.correct++;
        inc.set(key, c);
    }
    if (inc.size === 0) return 0;
    await ItemDifficulty.bulkWrite(
        [...inc].map(([key, c]) => ({
            updateOne: {
                filter: { _id: key },
                update: {
                    $inc: { n: c.n, correct: c.correct },
                    $set: { updatedAt: now },
                },
                upsert: true,
            },
        })),
        { ordered: false }
    );
    return inc.size;
}

/** Counts for the given questions that have enough answers to be trusted. */
export async function loadItemStats(
    keys: string[]
): Promise<Map<string, { n: number; correct: number }>> {
    const out = new Map<string, { n: number; correct: number }>();
    const ids = [...new Set(keys)];
    if (ids.length === 0) return out;
    const rows = await ItemDifficulty.find({
        _id: { $in: ids },
        n: { $gte: MIN_ITEM_ANSWERS },
    }).lean<Array<{ _id: string; n: number; correct: number }>>();
    for (const r of rows) out.set(r._id, { n: r.n, correct: r.correct });
    return out;
}
