import { randomUUID } from 'node:crypto';
import mongoose, { Schema, model } from 'mongoose';
import { CleanEvent, PipelineLock } from '../etl/models.js';
import { EVENT_CATEGORY, EventType } from '../events/eventTypes.js';
import { consentService } from '../privacy/consentService.js';
import { recsysConfig } from '../config.js';
import { pseudonymise, requirePseudonymSalt } from './pseudonym.js';
import { CleanRow, EventWire, toWire } from './wire.js';
import { isErased, loadTombstones } from './erasure.js';
import { StreamProducer } from './producer.js';
import { regionService } from './regions.js';

const LEASE_ID = 'stream-exporter';
const STATE_ID = 'silver';

const stateSchema = new Schema(
    {
        _id: { type: String },
        cursorId: { type: Schema.Types.ObjectId },
        updatedAt: { type: Date },
        lastError: { type: String },
        totals: {
            exported: { type: Number, default: 0 },
            skippedConsent: { type: Number, default: 0 },
            skippedErased: { type: Number, default: 0 },
        },
    },
    { collection: 'recsys_stream_state', versionKey: false }
);
export const StreamState =
    mongoose.models.RecsysStreamState ||
    model('RecsysStreamState', stateSchema);

export interface ExportSummary {
    status: 'ok' | 'failed' | 'locked' | 'idle';
    read: number;
    exported: number;
    skippedConsent: number;
    skippedErased: number;
    error?: string;
}

export interface ExporterDeps {
    producer: StreamProducer;
    /** Injectable for tests; defaults to the real secret (fails closed when unset). */
    salt?: string;
}

type SilverRow = CleanRow & { _id: mongoose.Types.ObjectId };

/**
 * Silver → stream. At-least-once: the cursor only advances after the broker acknowledged the
 * batch, so a crash re-sends (the warehouse deduplicates on eventId). Reads silver (validated,
 * deduplicated, lineage-stamped) rather than bronze. Nothing here sits on the request path.
 */
export class StreamExporter {
    constructor(private readonly deps: ExporterDeps) {}

    private async lease(owner: string, now: Date): Promise<boolean> {
        try {
            const d = await PipelineLock.findOneAndUpdate(
                {
                    _id: LEASE_ID,
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
            return d?.owner === owner;
        } catch (err) {
            if ((err as { code?: number }).code === 11000) return false;
            throw err;
        }
    }

    async runOnce(now = new Date()): Promise<ExportSummary> {
        const summary: ExportSummary = {
            status: 'idle',
            read: 0,
            exported: 0,
            skippedConsent: 0,
            skippedErased: 0,
        };
        const salt = this.deps.salt ?? requirePseudonymSalt();
        const owner = randomUUID();
        if (!(await this.lease(owner, now)))
            return { ...summary, status: 'locked' };
        try {
            const state = await StreamState.findById(STATE_ID).lean<{
                cursorId?: mongoose.Types.ObjectId;
            } | null>();
            let cursor = state?.cursorId;
            for (let i = 0; i < recsysConfig.stream.maxBatchesPerRun; i++) {
                const rows = await CleanEvent.find(
                    cursor ? { _id: { $gt: cursor } } : {}
                )
                    .sort({ _id: 1 })
                    .limit(recsysConfig.stream.batchSize())
                    .lean<SilverRow[]>();
                if (rows.length === 0) break;
                summary.read += rows.length;
                await this.exportBatch(rows, salt, summary);
                cursor = rows[rows.length - 1]._id;
                await StreamState.updateOne(
                    { _id: STATE_ID },
                    {
                        $set: { cursorId: cursor, updatedAt: now },
                        $unset: { lastError: '' },
                    },
                    { upsert: true }
                );
                if (rows.length < recsysConfig.stream.batchSize()) break;
            }
            await StreamState.updateOne(
                { _id: STATE_ID },
                {
                    $inc: {
                        'totals.exported': summary.exported,
                        'totals.skippedConsent': summary.skippedConsent,
                        'totals.skippedErased': summary.skippedErased,
                    },
                },
                { upsert: true }
            );
            summary.status = summary.read > 0 ? 'ok' : 'idle';
        } catch (err) {
            summary.status = 'failed';
            summary.error = (err as Error).message;
            await StreamState.updateOne(
                { _id: STATE_ID },
                { $set: { lastError: summary.error.slice(0, 500) } },
                { upsert: true }
            );
        } finally {
            await PipelineLock.deleteOne({ _id: LEASE_ID, owner });
        }
        return summary;
    }

    private async exportBatch(
        rows: SilverRow[],
        salt: string,
        summary: ExportSummary
    ): Promise<void> {
        const userIds = [...new Set(rows.map((r) => r.userId.toString()))];
        const regions = await regionService.resolve(userIds);
        const pseudo = new Map(
            userIds.map((u) => [u, pseudonymise(u, regions.get(u)!, salt)])
        );
        const [tombstones, consent] = await Promise.all([
            loadTombstones([...pseudo.values()]),
            Promise.all(
                userIds.map(
                    async (u) =>
                        [u, await consentService.has(u, 'analytics')] as const
                )
            ).then((x) => new Map(x)),
        ]);

        const byTopic = new Map<string, EventWire[]>();
        for (const r of rows) {
            const uid = r.userId.toString();
            const p = pseudo.get(uid)!;
            const analytics = consent.get(uid) === true;
            if (isErased(tombstones, p, r.occurredAt)) {
                summary.skippedErased++;
                continue;
            }
            const behavioural =
                EVENT_CATEGORY[r.type as EventType] === 'behavioral';
            // Behavioural events need analytics consent; so does anything after an erasure.
            if ((behavioural || tombstones.has(p)) && !analytics) {
                summary.skippedConsent++;
                continue;
            }
            const region = regions.get(uid)!;
            const topic = `${recsysConfig.stream.topicBase()}.${region}`;
            const list = byTopic.get(topic) ?? [];
            list.push(toWire(r, p, region));
            byTopic.set(topic, list);
        }
        for (const [topic, wires] of byTopic) {
            await this.deps.producer.send(
                topic,
                wires.map((w) => ({ key: w.u, value: JSON.stringify(w) }))
            );
            summary.exported += wires.length;
        }
    }
}
