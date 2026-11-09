/** Standard top-K ranking metrics. `rels` = graded relevance of the ranked list, in rank order. */

export function precisionAtK(rels: number[], k: number): number {
    const top = rels.slice(0, k);
    return top.length === 0 ? 0 : top.filter((r) => r > 0).length / k;
}

export function recallAtK(
    rels: number[],
    k: number,
    totalRelevant: number
): number {
    if (totalRelevant <= 0) return 0;
    return rels.slice(0, k).filter((r) => r > 0).length / totalRelevant;
}

const dcg = (rels: number[]) =>
    rels.reduce((a, r, i) => a + (Math.pow(2, r) - 1) / Math.log2(i + 2), 0);

/** NDCG@K with exponential gain. `ideal` = all known relevance grades (any order). */
export function ndcgAtK(
    rels: number[],
    k: number,
    ideal: number[] = rels
): number {
    const best = dcg([...ideal].sort((a, b) => b - a).slice(0, k));
    return best === 0 ? 0 : dcg(rels.slice(0, k)) / best;
}

export function mrr(rels: number[]): number {
    const i = rels.findIndex((r) => r > 0);
    return i < 0 ? 0 : 1 / (i + 1);
}

/** Share of the catalogue that was recommended to at least one user. */
export function catalogCoverage(
    recommended: string[][],
    catalogSize: number
): number {
    if (catalogSize <= 0) return 0;
    return new Set(recommended.flat()).size / catalogSize;
}

/** Mean fraction of distinct item types per list (1 = every item a different type). */
export function listDiversity(types: string[][]): number {
    const lists = types.filter((t) => t.length > 0);
    if (lists.length === 0) return 0;
    return (
        lists.reduce((a, t) => a + new Set(t).size / t.length, 0) / lists.length
    );
}

export const mean = (xs: number[]): number =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
