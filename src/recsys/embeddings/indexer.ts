import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { Resource } from '../../models/resource.js';
import { recsysConfig } from '../config.js';
import { EmbeddingProvider } from './provider.js';
import { ContentEmbedding, encodeVector } from './store.js';

interface ResourceDoc {
    _id: Types.ObjectId;
    title?: string;
    summary?: string;
    labels?: { cefr?: string; domain?: string; topic?: string[] };
}

/** What gets embedded: title + summary + the tags we already trust. Capped to bound cost. */
export function embeddingText(r: ResourceDoc): string {
    return [
        r.title,
        r.summary,
        r.labels?.domain,
        r.labels?.cefr,
        ...(r.labels?.topic ?? []),
    ]
        .filter(Boolean)
        .join('. ')
        .slice(0, 2000);
}

export const contentHash = (text: string, provider: string): string =>
    createHash('sha256')
        .update(`${provider}\n${text}`)
        .digest('hex')
        .slice(0, 32);

export interface IndexReport {
    scanned: number;
    embedded: number;
    skippedFresh: number;
    failedBatches: number;
    /** ≈ chars/4; the API does not report tokens. Job-level cost (no learner is involved). */
    estTokens: number;
}

/**
 * OFFLINE job — never on the request path. Embeds resources that are new or whose text (or the
 * provider/model) changed, in batches, with a per-run cap. Safe to re-run: unchanged content is
 * skipped by hash, so cost is proportional to change, not catalogue size.
 */
export async function indexResources(
    provider: EmbeddingProvider,
    opts: { now?: Date; maxPerRun?: number } = {}
): Promise<IndexReport> {
    const now = opts.now ?? new Date();
    const cap = opts.maxPerRun ?? recsysConfig.embeddings.maxPerRun();
    const report: IndexReport = {
        scanned: 0,
        embedded: 0,
        skippedFresh: 0,
        failedBatches: 0,
        estTokens: 0,
    };

    const docs = await Resource.find({ suitableForLearners: true })
        .sort({ publishedAt: -1 })
        .limit(5000)
        .select('title summary labels')
        .lean<ResourceDoc[]>();
    report.scanned = docs.length;
    const existing = new Map(
        (
            await ContentEmbedding.find({
                resourceId: { $in: docs.map((d) => d._id) },
            })
                .select('resourceId contentHash')
                .lean<
                    Array<{ resourceId: Types.ObjectId; contentHash: string }>
                >()
        ).map((e) => [e.resourceId.toString(), e.contentHash])
    );

    const todo: Array<{ id: Types.ObjectId; text: string; hash: string }> = [];
    for (const d of docs) {
        const text = embeddingText(d);
        if (!text) continue;
        const hash = contentHash(text, provider.name);
        if (existing.get(d._id.toString()) === hash) report.skippedFresh++;
        else todo.push({ id: d._id, text, hash });
    }
    for (
        let i = 0;
        i < Math.min(todo.length, cap);
        i += recsysConfig.embeddings.batchSize
    ) {
        const batch = todo.slice(
            i,
            Math.min(i + recsysConfig.embeddings.batchSize, cap)
        );
        try {
            const vecs = await provider.embed(batch.map((b) => b.text));
            await ContentEmbedding.bulkWrite(
                batch.map((b, j) => ({
                    updateOne: {
                        filter: { resourceId: b.id },
                        update: {
                            $set: {
                                contentHash: b.hash,
                                provider: provider.name,
                                dims: vecs[j].length,
                                vector: encodeVector(vecs[j]),
                                updatedAt: now,
                            },
                        },
                        upsert: true,
                    },
                })),
                { ordered: false }
            );
            report.embedded += batch.length;
            report.estTokens += Math.ceil(
                batch.reduce((a, b) => a + b.text.length, 0) / 4
            );
        } catch (err) {
            report.failedBatches++;
            console.error(
                '[recsys] embedding batch failed:',
                (err as Error).message
            );
        }
    }
    return report;
}
