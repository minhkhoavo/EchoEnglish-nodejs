import { Types } from 'mongoose';
import { CleanEvent, DailyFactsData } from '../etl/models.js';
import { localDayHour } from '../etl/clean.js';
import { DailyFacts } from '../etl/models.js';
import { Flashcard } from '../../models/flashcardModel.js';
import {
    LearnerFeatureSet,
    LearnerFeatures,
    SkillFeature,
    SkillMastery,
} from './featureModels.js';
import {
    MasteryState,
    newMastery,
    updateMastery,
    viewMastery,
} from './mastery.js';
import { CardLike, cardRetention } from './retention.js';
import { recsysConfig } from '../config.js';
import { featureStore } from '../featurestore/store.js';

const DAY_MS = 86_400_000;
const dayKey = (d: Date) => localDayHour(d).day;
const addDays = (day: string, delta: number) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS)
        .toISOString()
        .slice(0, 10);

/** Days between `today` and the most recent day where `pick(row) > 0`; null if none. */
function daysSinceLast(
    rows: DailyFactsData[],
    today: string,
    pick: (r: DailyFactsData) => number
): number | null {
    const last = rows
        .filter((r) => pick(r) > 0)
        .map((r) => r.day)
        .sort()
        .pop();
    return last
        ? Math.round(
              (Date.parse(`${today}T00:00:00Z`) -
                  Date.parse(`${last}T00:00:00Z`)) /
                  DAY_MS
          )
        : null;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/** Consecutive active days ending today, or yesterday (a learner is not "broken" until the day is over). */
export function computeStreak(activeDays: Set<string>, today: string): number {
    let cursor = activeDays.has(today) ? today : addDays(today, -1);
    let streak = 0;
    while (activeDays.has(cursor)) {
        streak++;
        cursor = addDays(cursor, -1);
    }
    return streak;
}

/** Least-squares slope (points per test) over consecutive test scores; null if < 2 tests. */
export function scoreTrend(scores: number[]): number | null {
    const n = scores.length;
    if (n < 2) return null;
    const xm = (n - 1) / 2;
    const ym = scores.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    scores.forEach((y, x) => {
        num += (x - xm) * (y - ym);
        den += (x - xm) ** 2;
    });
    return den === 0 ? null : num / den;
}

export interface FeatureInput {
    userId: string;
    now: Date;
    facts: DailyFactsData[]; // last ~30 days
    masteries: Array<{ skillKey: string } & MasteryState>;
    cards: CardLike[];
}

/** Pure: facts + mastery + cards → feature set. */
export function computeFeatures(i: FeatureInput): LearnerFeatureSet {
    const today = dayKey(i.now);
    const d7 = addDays(today, -6);
    const f30 = i.facts;
    const f7 = f30.filter((f) => f.day >= d7);
    const activeSet = new Set(
        f30.filter((f) => f.learningActions > 0).map((f) => f.day)
    );
    const sum = <K extends keyof DailyFactsData>(
        rows: DailyFactsData[],
        k: K
    ) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

    const lastActive = [...activeSet].sort().pop();
    const hours = new Array(24).fill(0);
    for (const f of f30) f.activeHours.forEach((c, h) => (hours[h] += c));
    const bestHours = hours
        .map((c, h) => ({ c, h }))
        .filter((x) => x.c > 0)
        .sort((a, b) => b.c - a.c || a.h - b.h)
        .slice(0, 2)
        .map((x) => x.h);

    const testScores = f30
        .filter((f) => f.lastTestScore !== undefined)
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((f) => f.lastTestScore as number);

    const rets = i.cards.map((c) => cardRetention(c, i.now));
    const seen = rets.filter((r) => !r.isNew);
    const skills: SkillFeature[] = i.masteries.map((m) => {
        const v = viewMastery(m, i.now);
        return {
            skillKey: m.skillKey,
            mastery: v.mastery,
            confidence: v.confidence,
            n: m.n,
            daysSincePractice: v.daysSincePractice,
        };
    });

    const imp = sum(f30, 'recImpressions');
    return {
        userId: i.userId,
        computedAt: i.now,
        activity: {
            activeDays7: f7.filter((f) => f.learningActions > 0).length,
            activeDays30: activeSet.size,
            studyMin7: Math.round(sum(f7, 'studySeconds') / 60),
            studyMin30: Math.round(sum(f30, 'studySeconds') / 60),
            streak: computeStreak(activeSet, today),
            daysSinceActive: lastActive
                ? Math.round(
                      (Date.parse(`${today}T00:00:00Z`) -
                          Date.parse(`${lastActive}T00:00:00Z`)) /
                          DAY_MS
                  )
                : null,
        },
        performance: {
            acc7: ratio(
                sum(f7, 'questionsCorrect'),
                sum(f7, 'questionsAnswered')
            ),
            acc30: ratio(
                sum(f30, 'questionsCorrect'),
                sum(f30, 'questionsAnswered')
            ),
            questions30: sum(f30, 'questionsAnswered'),
            lastTestScore: testScores.length
                ? testScores[testScores.length - 1]
                : null,
            scoreTrend: scoreTrend(testScores),
        },
        srs: {
            total: i.cards.length,
            due: rets.filter((r) => r.due).length,
            newCards: rets.filter((r) => r.isNew).length,
            avgRetrievability: seen.length
                ? seen.reduce((a, r) => a + r.retrievability, 0) / seen.length
                : null,
            overdueMax: rets.reduce((a, r) => Math.max(a, r.overdueDays), 0),
        },
        timing: { bestHours },
        daysSince: {
            test: daysSinceLast(f30, today, (r) => r.testsSubmitted),
            pronunciation: daysSinceLast(
                f30,
                today,
                (r) => r.pronunciationAttempts
            ),
            vocab: daysSinceLast(f30, today, (r) => r.vocabCaptured),
        },
        engagement: {
            recImpressions30: imp,
            recCtr30: ratio(sum(f30, 'recClicks'), imp),
            dismissRate30: ratio(sum(f30, 'recDismisses'), imp),
            resourceCompletionRate30: ratio(
                sum(f30, 'resourcesCompleted'),
                sum(f30, 'resourcesViewed')
            ),
        },
        skills,
    };
}

export class FeatureBuilder {
    /**
     * Fold new `question_answered` events into per-skill mastery, in occurrence order.
     * Idempotent via the cursor on the feature doc (newest receivedAt already applied).
     */
    async updateMastery(userId: string, now = new Date()): Promise<number> {
        const uid = new Types.ObjectId(userId);
        const cur = await LearnerFeatures.findOne({ userId: uid })
            .select('masteryCursorId')
            .lean<{ masteryCursorId?: Types.ObjectId } | null>();
        // Cursor = silver _id (insertion order). A timestamp cursor would permanently skip
        // re-queued rejected events and the tail of a batch split across ETL runs.
        const filter: Record<string, unknown> = {
            userId: uid,
            type: 'question_answered',
        };
        if (cur?.masteryCursorId) filter._id = { $gt: cur.masteryCursorId };
        const events = await CleanEvent.find(filter)
            .sort({ occurredAt: 1, _id: 1 })
            .select('props occurredAt')
            .lean<
                Array<{
                    _id: Types.ObjectId;
                    props: {
                        skillKey: string;
                        correct: boolean;
                        difficulty?: string;
                    };
                    occurredAt: Date;
                }>
            >();
        if (events.length === 0) return 0;

        const rows = await SkillMastery.find({ userId: uid }).lean<
            Array<{ skillKey: string } & MasteryState>
        >();
        const state = new Map<string, MasteryState>(
            rows.map((r) => [r.skillKey, r])
        );
        let maxId = cur?.masteryCursorId ?? events[0]._id;
        const touched = new Set<string>();
        for (const e of events) {
            const key = e.props.skillKey;
            state.set(
                key,
                updateMastery(state.get(key) ?? newMastery(), {
                    correct: e.props.correct === true,
                    difficulty: e.props.difficulty,
                    at: e.occurredAt,
                })
            );
            touched.add(key);
            if (e._id.toString() > maxId.toString()) maxId = e._id;
        }
        await SkillMastery.bulkWrite(
            [...touched].map((k) => {
                const s = state.get(k)!;
                return {
                    updateOne: {
                        filter: { userId: uid, skillKey: k },
                        update: {
                            $set: {
                                theta: s.theta,
                                n: s.n,
                                correct: s.correct,
                                lastPracticedAt: s.lastPracticedAt,
                            },
                        },
                        upsert: true,
                    },
                };
            })
        );
        await LearnerFeatures.updateOne(
            { userId: uid },
            {
                $set: { masteryCursorId: maxId },
                $setOnInsert: {
                    computedAt: now,
                    pipelineVersion: recsysConfig.pipelineVersion,
                },
            },
            { upsert: true }
        );
        return events.length;
    }

    /** Recompute and persist the full feature set for one learner. */
    async build(userId: string, now = new Date()): Promise<LearnerFeatureSet> {
        await this.updateMastery(userId, now);
        const uid = new Types.ObjectId(userId);
        const since = dayKey(new Date(now.getTime() - 29 * DAY_MS));
        const [facts, masteries, cards] = await Promise.all([
            DailyFacts.find({ userId: uid, day: { $gte: since } }).lean<
                DailyFactsData[]
            >(),
            SkillMastery.find({ userId: uid }).lean<
                Array<{ skillKey: string } & MasteryState>
            >(),
            Flashcard.find({ createBy: uid })
                .select('level_memory nextReviewDate lastReviewDate')
                .limit(5000)
                .lean<CardLike[]>(),
        ]);
        const features = computeFeatures({
            userId,
            now,
            facts,
            masteries,
            cards,
        });
        const { userId: _u, computedAt, ...body } = features;
        void _u;
        await LearnerFeatures.updateOne(
            { userId: uid },
            {
                $set: {
                    ...body,
                    computedAt,
                    pipelineVersion: recsysConfig.pipelineVersion,
                },
            },
            { upsert: true }
        );
        if (recsysConfig.featureStore.snapshotsEnabled()) {
            // Offline copy for point-in-time training joins; must never break serving features.
            await featureStore
                .snapshot(features, now)
                .catch((e) =>
                    console.error(
                        '[recsys] feature snapshot failed:',
                        (e as Error).message
                    )
                );
        }
        return features;
    }

    async buildMany(userIds: string[], now = new Date()): Promise<void> {
        for (const id of userIds) {
            try {
                await this.build(id, now);
            } catch (err) {
                console.error(
                    `[recsys] feature build failed for ${id}:`,
                    (err as Error).message
                );
            }
        }
    }
}

export const featureBuilder = new FeatureBuilder();
