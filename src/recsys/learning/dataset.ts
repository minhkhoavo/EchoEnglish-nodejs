import { Types } from 'mongoose';
import { LearningEvent } from '../events/eventModel.js';
import { RecServed } from '../engine/servedModel.js';
import { featureStore } from '../featurestore/store.js';
import { recsysConfig } from '../config.js';
import { ExploreLog } from '../eval/counterfactual.js';
import { Segment, SEGMENTS, segmentFromQuestions } from './model.js';
import { TrainingRow } from './train.js';

/** Newest impressions only: ~9 parameters need far fewer rows, and training runs in the API process. */
const MAX_ROWS = 200_000;
const HOUR_MS = 3_600_000;
/** A click counts as learning only if the matching activity follows within this window. */
export const OUTCOME_WINDOW_MS = 24 * HOUR_MS;

/**
 * (recId, itemType, itemRef): itemRef alone is ambiguous — pronunciation_practice and
 * vocab_capture both use ref "daily", so a click on one would label the other too.
 */
const joinKey = (p: { recId: string; itemType: string; itemRef?: string }) =>
    `${p.recId}|${p.itemType}|${p.itemRef ?? ''}`;

interface ImpRow {
    userId: Types.ObjectId;
    occurredAt: Date;
    props: {
        recId: string;
        itemType: string;
        itemRef?: string;
        position: number;
        signals: Record<string, number>;
        segment?: string;
        explored?: boolean;
    };
}

/**
 * Which server-recorded activity proves that a recommended item was actually done.
 * Returns `<eventType>|<key>`; key is the skill for drills, the resource for resources and
 * empty for activity-level items.
 */
export function outcomeKey(itemType: string, itemRef?: string): string | null {
    switch (itemType) {
        case 'skill_drill':
            return `question_answered|${itemRef ?? ''}`;
        case 'resource':
            return `resource_viewed|${itemRef ?? ''}`;
        case 'flashcard_review':
            return 'flashcard_reviewed|';
        case 'mock_test':
            return 'test_submitted|';
        case 'pronunciation_practice':
            return 'pronunciation_scored|';
        case 'vocab_capture':
            return 'vocab_captured|';
        default:
            return null;
    }
}

/** True if any time in the ascending list falls in (t0, t0 + window]. */
export function followedWithin(
    times: number[] | undefined,
    t0: number,
    windowMs = OUTCOME_WINDOW_MS
): boolean {
    if (!times || times.length === 0) return false;
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] > t0) hi = mid;
        else lo = mid + 1;
    }
    return lo < times.length && times[lo] <= t0 + windowMs;
}

const OUTCOME_TYPES = [
    'question_answered',
    'resource_viewed',
    'flashcard_reviewed',
    'test_submitted',
    'pronunciation_scored',
    'vocab_captured',
];

/** user|eventType|key → ascending activity times (first and last per hour bucket). */
async function loadOutcomes(
    since: Date,
    userIds: Types.ObjectId[]
): Promise<Map<string, number[]>> {
    const rows = await LearningEvent.aggregate<{
        _id: { u: Types.ObjectId; t: string; k: string | null; h: string };
        first: Date;
        last: Date;
    }>([
        {
            $match: {
                userId: { $in: userIds },
                type: { $in: OUTCOME_TYPES },
                occurredAt: { $gte: since },
                $or: [
                    { type: { $ne: 'resource_viewed' } },
                    { 'props.completed': true },
                ],
            },
        },
        {
            $group: {
                _id: {
                    u: '$userId',
                    t: '$type',
                    k: {
                        $switch: {
                            branches: [
                                {
                                    case: {
                                        $eq: ['$type', 'question_answered'],
                                    },
                                    then: '$props.skillKey',
                                },
                                {
                                    case: { $eq: ['$type', 'resource_viewed'] },
                                    then: '$props.resourceId',
                                },
                            ],
                            default: '',
                        },
                    },
                    h: {
                        $dateToString: {
                            format: '%Y-%m-%dT%H',
                            date: '$occurredAt',
                        },
                    },
                },
                // first AND last time in the bucket: activity earlier in the same hour as
                // the impression must not hide activity that came after it
                first: { $min: '$occurredAt' },
                last: { $max: '$occurredAt' },
            },
        },
    ]);
    const out = new Map<string, number[]>();
    for (const r of rows) {
        const key = `${r._id.u.toString()}|${r._id.t}|${r._id.k ?? ''}`;
        (out.get(key) ?? out.set(key, []).get(key)!).push(
            r.first.getTime(),
            r.last.getTime()
        );
    }
    for (const v of out.values()) v.sort((a, b) => a - b);
    return out;
}

const refSet = async (type: string, since: Date) =>
    new Set(
        (
            await LearningEvent.find({ type, occurredAt: { $gte: since } })
                .select('props.recId props.itemType props.itemRef')
                .lean<
                    Array<{
                        props: {
                            recId: string;
                            itemType: string;
                            itemRef?: string;
                        };
                    }>
                >()
        ).map((c) => joinKey(c.props))
    );

/**
 * Impressions (personalised lists only — cold-start lists ignore the variant) joined to
 * feedback by (recId, itemType, itemRef).
 *
 *  - label: with RECSYS_TRAIN_LABEL=outcome (default) a row is positive only if the item was
 *    clicked AND the matching activity was recorded within 24 h (or the client reported
 *    completion). `click` keeps the old behaviour.
 *  - segment: the value logged at serve time; the as-of feature-store join is only a fallback
 *    for impressions logged before that field existed.
 */
export async function loadTrainingRows(
    since: Date,
    limit = MAX_ROWS
): Promise<TrainingRow[]> {
    const imps = await LearningEvent.find({
        type: 'rec_impression',
        occurredAt: { $gte: since },
        'props.mode': 'personalized',
        'props.signals': { $exists: true },
    })
        .sort({ occurredAt: 1 })
        .limit(limit)
        .select(
            'userId occurredAt props.recId props.itemType props.itemRef props.position props.signals props.segment props.explored'
        )
        .lean<ImpRow[]>();
    if (imps.length === 0) return [];

    const outcomeLabel = recsysConfig.trainLabel() === 'outcome';
    const userIds = [
        ...new Map(imps.map((i) => [i.userId.toString(), i.userId])).values(),
    ];
    const [clicked, completed, outcomes] = await Promise.all([
        refSet('rec_click', since),
        outcomeLabel
            ? refSet('rec_complete', since)
            : Promise.resolve(new Set<string>()),
        outcomeLabel
            ? loadOutcomes(since, userIds)
            : Promise.resolve(new Map<string, number[]>()),
    ]);

    // Feature-store join only for legacy impressions without a serve-time segment.
    const legacy = imps
        .map((i, idx) => ({ i, idx }))
        .filter(({ i }) => !SEGMENTS.includes(i.props.segment as Segment));
    const joined = legacy.length
        ? await featureStore.getHistoricalFeatures(
              legacy.map(({ i }) => ({
                  userId: i.userId.toString(),
                  t: i.occurredAt,
              }))
          )
        : [];
    const legacySegment = new Map<number, Segment | null>(
        legacy.map(({ idx }, j) => [
            idx,
            joined[j].values
                ? segmentFromQuestions(joined[j].values?.questions30)
                : null,
        ])
    );

    return imps.map((i, idx) => {
        const key = joinKey(i.props);
        const wasClicked = clicked.has(key);
        const ok = outcomeKey(i.props.itemType, i.props.itemRef);
        const verified =
            completed.has(key) ||
            (ok !== null &&
                followedWithin(
                    outcomes.get(`${i.userId.toString()}|${ok}`),
                    i.occurredAt.getTime()
                ));
        return {
            userId: i.userId.toString(),
            recId: i.props.recId,
            itemKey: key,
            signals: i.props.signals,
            position: i.props.position,
            segment: SEGMENTS.includes(i.props.segment as Segment)
                ? (i.props.segment as Segment)
                : (legacySegment.get(idx) ?? null),
            clicked: wasClicked,
            label: outcomeLabel ? wasClicked && verified : wasClicked,
            ...(i.props.explored ? { explored: true } : {}),
        };
    });
}

/**
 * Explored lists (randomised slot + logged pool) with the reward of the randomly placed item,
 * for the counterfactual replay estimator. `rows` supplies the labels so training and
 * evaluation share one definition of success.
 */
export async function loadExploreLogs(
    since: Date,
    rows: TrainingRow[],
    limit = 50_000
): Promise<ExploreLog[]> {
    const label = new Map(
        rows
            .filter((r) => r.itemKey)
            .map((r) => [r.itemKey!, r.label ?? r.clicked])
    );
    const lists = await RecServed.find({
        servedAt: { $gte: since },
        mode: 'personalized',
        explore: { $exists: true },
        'pool.0': { $exists: true },
    })
        .sort({ servedAt: -1 })
        .limit(limit)
        .select('recId items pool')
        .lean<
            Array<{
                recId: string;
                items: Array<{
                    itemType: string;
                    itemRef: string;
                    explored?: boolean;
                }>;
                pool: Array<{
                    itemType: string;
                    itemRef: string;
                    signals: Record<string, number>;
                }>;
            }>
        >();
    const out: ExploreLog[] = [];
    for (const l of lists) {
        const picked = l.items.find((i) => i.explored);
        if (!picked) continue;
        const key = joinKey({ recId: l.recId, ...picked });
        if (!label.has(key)) continue; // impression not logged (no analytics consent)
        out.push({
            pool: l.pool.map((p) => ({
                id: `${p.itemType}:${p.itemRef}`,
                signals: p.signals,
            })),
            pickedId: `${picked.itemType}:${picked.itemRef}`,
            reward: label.get(key) ? 1 : 0,
        });
    }
    return out;
}
