import mongoose, { Schema, Types, model } from 'mongoose';

/** Content embeddings. Vectors are Float32 buffers (≈4 B/dim) rather than number arrays. */
const schema = new Schema(
    {
        resourceId: { type: Schema.Types.ObjectId, required: true },
        contentHash: { type: String, required: true },
        provider: { type: String, required: true },
        dims: { type: Number, required: true },
        vector: { type: Buffer, required: true },
        updatedAt: { type: Date, required: true },
    },
    { collection: 'content_embeddings', versionKey: false }
);
schema.index({ resourceId: 1 }, { unique: true });

export const ContentEmbedding =
    mongoose.models.RecsysContentEmbedding ||
    model('RecsysContentEmbedding', schema);

export const encodeVector = (v: number[]): Buffer =>
    Buffer.from(new Float32Array(v).buffer);

export function decodeVector(b: Buffer | { buffer: Buffer }): Float32Array {
    const buf = Buffer.isBuffer(b)
        ? b
        : ((b as { buffer: Buffer }).buffer ?? (b as unknown as Buffer));
    const copy = new Uint8Array(buf.length);
    copy.set(buf);
    return new Float32Array(copy.buffer, 0, Math.floor(buf.length / 4));
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0,
        na = 0,
        nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export interface StoredEmbedding {
    resourceId: Types.ObjectId;
    contentHash: string;
    provider: string;
    vector: Float32Array;
}

export async function loadEmbeddings(
    resourceIds: string[],
    provider: string
): Promise<Map<string, Float32Array>> {
    if (resourceIds.length === 0) return new Map();
    const rows = await ContentEmbedding.find({
        resourceId: { $in: resourceIds.map((i) => new Types.ObjectId(i)) },
        provider,
    })
        .select('resourceId vector')
        .lean<Array<{ resourceId: Types.ObjectId; vector: Buffer }>>();
    return new Map(
        rows.map((r) => [r.resourceId.toString(), decodeVector(r.vector)])
    );
}
