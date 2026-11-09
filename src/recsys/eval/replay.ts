import { mean, mrr, ndcgAtK, precisionAtK, listDiversity } from './metrics.js';
import { LearningEvent } from '../events/eventModel.js';

export interface ReplayImpression {
    recId: string;
    userId: string;
    variant: string;
    position: number;
    itemKey: string; // `${itemType}:${itemRef}`
    itemType: string;
}

export interface ReplayOutcome {
    recId: string;
    itemKey: string;
    kind: 'click' | 'complete' | 'dismiss';
}

export interface VariantReport {
    variant: string;
    lists: number;
    users: number;
    ctr: number; // clicked impressions / impressions
    completionRate: number; // completed / impressions
    dismissRate: number;
    precisionAt3: number;
    ndcgAt5: number;
    mrr: number;
    diversity: number;
}

/** Graded relevance of one outcome: dismiss −, none 0, click 1, complete 2 (dismiss counts as 0). */
const GRADE = { click: 1, complete: 2, dismiss: 0 } as const;

/**
 * Join logged impressions with outcomes and compute per-variant ranking quality.
 * Note: logged data only exists for consenting users and only for what we showed
 * (position/selection bias) – use for comparing variants served in parallel, not as ground truth.
 */
export function evaluateReplay(
    impressions: ReplayImpression[],
    outcomes: ReplayOutcome[]
): VariantReport[] {
    const out = new Map<string, ReplayOutcome[]>();
    for (const o of outcomes) {
        const k = `${o.recId}|${o.itemKey}`;
        (out.get(k) ?? out.set(k, []).get(k)!).push(o);
    }
    const lists = new Map<string, ReplayImpression[]>();
    for (const i of impressions)
        (lists.get(i.recId) ?? lists.set(i.recId, []).get(i.recId)!).push(i);

    const byVariant = new Map<
        string,
        Array<{
            user: string;
            rels: number[];
            types: string[];
            click: number;
            complete: number;
            dismiss: number;
            n: number;
        }>
    >();
    for (const [recId, imps] of lists) {
        const sorted = [...imps].sort((a, b) => a.position - b.position);
        let click = 0,
            complete = 0,
            dismiss = 0;
        const rels = sorted.map((i) => {
            const os = out.get(`${recId}|${i.itemKey}`) ?? [];
            if (os.some((o) => o.kind === 'click' || o.kind === 'complete'))
                click++;
            if (os.some((o) => o.kind === 'complete')) complete++;
            if (os.some((o) => o.kind === 'dismiss')) dismiss++;
            return Math.max(0, ...os.map((o) => GRADE[o.kind]));
        });
        const v = sorted[0].variant;
        (byVariant.get(v) ?? byVariant.set(v, []).get(v)!).push({
            user: sorted[0].userId,
            rels,
            types: sorted.map((i) => i.itemType),
            click,
            complete,
            dismiss,
            n: sorted.length,
        });
    }
    return [...byVariant.entries()]
        .map(([variant, ls]) => {
            const n = ls.reduce((a, l) => a + l.n, 0);
            return {
                variant,
                lists: ls.length,
                users: new Set(ls.map((l) => l.user)).size,
                ctr: n ? ls.reduce((a, l) => a + l.click, 0) / n : 0,
                completionRate: n
                    ? ls.reduce((a, l) => a + l.complete, 0) / n
                    : 0,
                dismissRate: n ? ls.reduce((a, l) => a + l.dismiss, 0) / n : 0,
                precisionAt3: mean(ls.map((l) => precisionAtK(l.rels, 3))),
                ndcgAt5: mean(ls.map((l) => ndcgAtK(l.rels, 5))),
                mrr: mean(ls.map((l) => mrr(l.rels))),
                diversity: listDiversity(ls.map((l) => l.types)),
            };
        })
        .sort((a, b) => a.variant.localeCompare(b.variant));
}

/** Load logged impressions/outcomes from raw events since a date. */
export async function loadReplayLogs(since: Date) {
    const rows = await LearningEvent.find({
        occurredAt: { $gte: since },
        type: {
            $in: ['rec_impression', 'rec_click', 'rec_complete', 'rec_dismiss'],
        },
    })
        .select('type userId props')
        .lean<
            Array<{
                type: string;
                userId: { toString(): string };
                props: Record<string, string | number>;
            }>
        >();
    const impressions: ReplayImpression[] = [];
    const outcomes: ReplayOutcome[] = [];
    for (const r of rows) {
        const key = `${r.props.itemType}:${r.props.itemRef ?? ''}`;
        if (r.type === 'rec_impression') {
            impressions.push({
                recId: String(r.props.recId),
                userId: r.userId.toString(),
                variant: String(r.props.variant),
                position: Number(r.props.position),
                itemKey: key,
                itemType: String(r.props.itemType),
            });
        } else {
            outcomes.push({
                recId: String(r.props.recId),
                itemKey: key,
                kind:
                    r.type === 'rec_click'
                        ? 'click'
                        : r.type === 'rec_complete'
                          ? 'complete'
                          : 'dismiss',
            });
        }
    }
    return { impressions, outcomes };
}
