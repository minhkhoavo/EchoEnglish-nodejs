import { ResourceLike, ExposureMap } from '../engine/types.js';
import { cosine, loadEmbeddings } from './store.js';

const MAX_SEEDS = 10;

export interface SemanticContext {
    sim: Map<string, number>;
    seedTitle?: string;
}

/**
 * Similarity of each candidate resource to the centroid of what the learner recently finished
 * (`resource:<id>` completions in the exposure map). Seeds are excluded from the result. Returns
 * null when the learner has no usable seeds or the catalogue is not indexed yet — the engine
 * then behaves exactly as without embeddings.
 */
export async function buildSemanticContext(
    resources: ResourceLike[],
    exposure: ExposureMap,
    provider: string,
    load = loadEmbeddings
): Promise<SemanticContext | null> {
    const seeds = [...exposure.entries()]
        .filter(([id, e]) => id.startsWith('resource:') && e.completedAt)
        .sort(
            (a, b) => b[1].completedAt!.getTime() - a[1].completedAt!.getTime()
        )
        .slice(0, MAX_SEEDS)
        .map(([id]) => id.slice('resource:'.length));
    if (seeds.length === 0) return null;
    const candidates = resources.map((r) => r._id.toString());
    const vecs = await load([...new Set([...seeds, ...candidates])], provider);
    const seedVecs = seeds
        .map((s) => vecs.get(s))
        .filter((v): v is Float32Array => !!v);
    if (seedVecs.length === 0) return null;
    const dims = seedVecs[0].length;
    const centroid = new Float32Array(dims);
    for (const v of seedVecs)
        if (v.length === dims)
            for (let i = 0; i < dims; i++)
                centroid[i] += v[i] / seedVecs.length;

    const seedSet = new Set(seeds);
    const sim = new Map<string, number>();
    for (const id of candidates) {
        if (seedSet.has(id)) continue;
        const v = vecs.get(id);
        if (!v) continue;
        const c = cosine(centroid, v);
        if (c > 0) sim.set(id, Number(Math.min(1, c).toFixed(4)));
    }
    const first = resources.find((r) => r._id.toString() === seeds[0]);
    return { sim, seedTitle: first?.title };
}
