import { Types } from 'mongoose';
import { LearningEvent } from '../events/eventModel.js';
import { featureStore } from '../featurestore/store.js';
import { Segment, segmentFromQuestions } from './model.js';
import { TrainingRow } from './train.js';

/** Newest impressions only: ~9 parameters need far fewer rows, and training runs in the API process. */
const MAX_ROWS = 200_000;

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
    };
}

/**
 * Impressions (personalised lists only — cold-start lists ignore the variant) joined to clicks
 * by (recId, itemType, itemRef), and to the learner's features AS OF the impression via the feature store
 * (so the segment is what the ranker would have known then, never a later value).
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
            'userId occurredAt props.recId props.itemType props.itemRef props.position props.signals'
        )
        .lean<ImpRow[]>();
    if (imps.length === 0) return [];

    const clicks = await LearningEvent.find({
        type: 'rec_click',
        occurredAt: { $gte: since },
    })
        .select('props.recId props.itemType props.itemRef')
        .lean<
            Array<{
                props: { recId: string; itemType: string; itemRef?: string };
            }>
        >();
    const clicked = new Set(clicks.map((c) => joinKey(c.props)));

    const joined = await featureStore.getHistoricalFeatures(
        imps.map((i) => ({ userId: i.userId.toString(), t: i.occurredAt }))
    );
    return imps.map((i, idx) => {
        const q = joined[idx].values?.questions30;
        const segment: Segment | null = joined[idx].values
            ? segmentFromQuestions(q)
            : null;
        return {
            userId: i.userId.toString(),
            recId: i.props.recId,
            signals: i.props.signals,
            position: i.props.position,
            segment,
            clicked: clicked.has(joinKey(i.props)),
        };
    });
}
