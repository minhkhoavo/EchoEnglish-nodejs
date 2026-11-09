import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { LearningEvent } from '../events/eventModel.js';
import { CleanEvent, DailyFacts, PipelineLock, PipelineRun } from './models.js';
import { cleanEvent, CleanedEvent, RawEventLike } from './clean.js';
import { aggregateDay } from './aggregate.js';
import { DqCheck, dqStatus, evaluateDataQuality } from './dataQuality.js';
import { recsysConfig } from '../config.js';

const LOCK_ID = 'etl';
const MAX_BATCHES_PER_RUN = 10;

export interface RunSummary {
    runId: string;
    status: 'ok' | 'degraded' | 'failed';
    counts: {
        read: number;
        cleaned: number;
        rejected: number;
        alreadyClean: number;
        factsUpserted: number;
        usersTouched: number;
    };
    dq: DqCheck[];
    touchedUserIds: string[];
    error?: string;
}

export interface RunOptions {
    now?: Date;
    maxBatches?: number;
    owner?: string;
    /** Called with the users whose facts changed (feature layer hooks in here). */
    afterFacts?: (userIds: string[]) => Promise<void>;
}

export class PipelineService {
    /** Mongo-based lease: only one instance runs the ETL at a time; expires if the holder dies. */
    async acquireLease(owner: string, now = new Date()): Promise<boolean> {
        try {
            const doc = await PipelineLock.findOneAndUpdate(
                {
                    _id: LOCK_ID,
                    $or: [{ expiresAt: { $lte: now } }, { owner }],
                },
                {
                    $set: {
                        owner,
                        expiresAt: new Date(
                            now.getTime() + recsysConfig.leaseTtlMs
                        ),
                    },
                },
                { upsert: true, new: true }
            ).lean<{ owner: string } | null>();
            return doc?.owner === owner;
        } catch (err) {
            if ((err as { code?: number }).code === 11000) return false;
            throw err;
        }
    }

    async releaseLease(owner: string): Promise<void> {
        await PipelineLock.deleteOne({ _id: LOCK_ID, owner });
    }

    /** One scheduled tick. Returns null when another instance holds the lease. */
    async runOnce(opts: RunOptions = {}): Promise<RunSummary | null> {
        const now = opts.now ?? new Date();
        const owner = opts.owner ?? randomUUID();
        if (!(await this.acquireLease(owner, now))) return null;

        const runId = randomUUID();
        await PipelineRun.create({
            runId,
            pipelineVersion: recsysConfig.pipelineVersion,
            startedAt: now,
            status: 'running',
        });
        const summary: RunSummary = {
            runId,
            status: 'ok',
            counts: {
                read: 0,
                cleaned: 0,
                rejected: 0,
                alreadyClean: 0,
                factsUpserted: 0,
                usersTouched: 0,
            },
            dq: [],
            touchedUserIds: [],
        };
        const touched = new Map<string, Set<string>>(); // userId -> days
        let questionEvents = 0;
        let unknownSkill = 0;
        let nullRequired = 0;
        let minRecv: Date | undefined;
        let maxRecv: Date | undefined;

        try {
            const batchSize = recsysConfig.pipelineBatchSize();
            for (let b = 0; b < (opts.maxBatches ?? MAX_BATCHES_PER_RUN); b++) {
                const pending = await LearningEvent.find({
                    'processing.status': 'pending',
                })
                    .sort({ receivedAt: 1, _id: 1 })
                    .limit(batchSize)
                    .lean<RawEventLike[]>();
                if (pending.length === 0) break;
                summary.counts.read += pending.length;

                const good: CleanedEvent[] = [];
                const bad: Array<{ id: unknown; reason: string }> = [];
                for (const raw of pending) {
                    const out = cleanEvent(raw);
                    if (out.ok) good.push(out.event);
                    else bad.push({ id: raw._id, reason: out.reason });
                    if (!minRecv || raw.receivedAt < minRecv)
                        minRecv = raw.receivedAt;
                    if (!maxRecv || raw.receivedAt > maxRecv)
                        maxRecv = raw.receivedAt;
                }

                if (good.length > 0) {
                    const res = await CleanEvent.bulkWrite(
                        good.map((e) => ({
                            updateOne: {
                                filter: { eventId: e.eventId },
                                update: {
                                    $setOnInsert: {
                                        ...e,
                                        pipelineVersion:
                                            recsysConfig.pipelineVersion,
                                        runId,
                                    },
                                },
                                upsert: true,
                            },
                        })),
                        { ordered: false }
                    );
                    summary.counts.cleaned += res.upsertedCount;
                    summary.counts.alreadyClean +=
                        good.length - res.upsertedCount;
                    for (const e of good) {
                        const uid = String(e.userId);
                        if (!uid || !e.day) nullRequired++;
                        if (!touched.has(uid)) touched.set(uid, new Set());
                        touched.get(uid)!.add(e.day);
                        if (e.type === 'question_answered') {
                            questionEvents++;
                            const k = String(e.props.skillKey ?? '');
                            if (
                                k.startsWith('unknown') ||
                                k.startsWith('part:')
                            )
                                unknownSkill++;
                        }
                    }
                    await LearningEvent.updateMany(
                        { _id: { $in: good.map((e) => e.rawId) } },
                        {
                            $set: {
                                'processing.status': 'processed',
                                'processing.processedAt': now,
                                'processing.pipelineVersion':
                                    recsysConfig.pipelineVersion,
                            },
                        }
                    );
                }
                if (bad.length > 0) {
                    summary.counts.rejected += bad.length;
                    await LearningEvent.bulkWrite(
                        bad.map((x) => ({
                            updateOne: {
                                filter: { _id: x.id },
                                update: {
                                    $set: {
                                        'processing.status': 'rejected',
                                        'processing.reason': x.reason.slice(
                                            0,
                                            200
                                        ),
                                        'processing.processedAt': now,
                                        'processing.pipelineVersion':
                                            recsysConfig.pipelineVersion,
                                    },
                                },
                            },
                        }))
                    );
                }
                if (pending.length < batchSize) break;
            }

            summary.counts.factsUpserted = await this.recomputeFacts(
                touched,
                runId
            );
            summary.touchedUserIds = [...touched.keys()];
            summary.counts.usersTouched = touched.size;

            const oldest = await LearningEvent.findOne({
                'processing.status': 'pending',
            })
                .sort({ receivedAt: 1 })
                .select('receivedAt')
                .lean<{ receivedAt: Date } | null>();
            summary.dq = evaluateDataQuality({
                read: summary.counts.read,
                rejected: summary.counts.rejected,
                alreadyClean: summary.counts.alreadyClean,
                questionEvents,
                unknownSkillEvents: unknownSkill,
                nullRequiredFields: nullRequired,
                oldestPendingMinutes: oldest
                    ? Math.max(
                          0,
                          (now.getTime() - oldest.receivedAt.getTime()) / 60_000
                      )
                    : 0,
            });
            summary.status = dqStatus(summary.dq);

            if (opts.afterFacts && summary.touchedUserIds.length > 0) {
                await opts.afterFacts(summary.touchedUserIds);
            }
        } catch (err) {
            summary.status = 'failed';
            summary.error = (err as Error).message;
        } finally {
            await PipelineRun.updateOne(
                { runId },
                {
                    $set: {
                        status: summary.status,
                        finishedAt: new Date(),
                        counts: summary.counts,
                        dq: summary.dq,
                        error: summary.error,
                        range: {
                            minReceivedAt: minRecv,
                            maxReceivedAt: maxRecv,
                        },
                    },
                }
            );
            await this.releaseLease(owner);
        }
        return summary;
    }

    /**
     * Rebuild gold rows from silver for the given user→days. Replace-not-increment makes this
     * idempotent, safe for late events, and usable for backfills after a pipelineVersion bump.
     */
    async recomputeFacts(
        userDays: Map<string, Set<string>>,
        runId: string
    ): Promise<number> {
        let upserted = 0;
        for (const [userId, daySet] of userDays) {
            const days = [...daySet];
            const rows = await CleanEvent.find({
                userId: new Types.ObjectId(userId),
                day: { $in: days },
            })
                .select('type hour occurredAt props day')
                .lean<
                    Array<{
                        type: string;
                        hour: number;
                        occurredAt: Date;
                        props: Record<string, unknown>;
                        day: string;
                    }>
                >();
            const byDay = new Map<string, typeof rows>();
            for (const r of rows) {
                if (!byDay.has(r.day)) byDay.set(r.day, []);
                byDay.get(r.day)!.push(r);
            }
            const ops = [];
            for (const [day, evs] of byDay) {
                const facts = aggregateDay(userId, day, evs);
                const times = evs.map((e) => e.occurredAt.getTime());
                ops.push({
                    replaceOne: {
                        filter: { userId: new Types.ObjectId(userId), day },
                        replacement: {
                            ...facts,
                            userId: new Types.ObjectId(userId),
                            lineage: {
                                pipelineVersion: recsysConfig.pipelineVersion,
                                runId,
                                sourceEventCount: evs.length,
                                minOccurredAt: new Date(Math.min(...times)),
                                maxOccurredAt: new Date(Math.max(...times)),
                                computedAt: new Date(),
                            },
                        },
                        upsert: true,
                    },
                });
            }
            if (ops.length > 0) {
                await DailyFacts.bulkWrite(ops, { ordered: false });
                upserted += ops.length;
            }
        }
        return upserted;
    }

    /** Backfill: recompute every day present in silver for one user. */
    async rebuildUser(userId: string): Promise<number> {
        const days = await CleanEvent.distinct('day', {
            userId: new Types.ObjectId(userId),
        });
        return this.recomputeFacts(
            new Map([[userId, new Set<string>(days)]]),
            `rebuild-${randomUUID()}`
        );
    }
}

export const pipelineService = new PipelineService();
