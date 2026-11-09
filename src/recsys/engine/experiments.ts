import { createHash } from 'node:crypto';

/**
 * Deterministic hash bucketing. Same user + experiment → same variant forever (until the
 * experiment key/salt changes), no storage needed, reproducible in analysis.
 */
export interface ExperimentDef {
    key: string;
    enabled: boolean;
    variants: Array<{ name: string; weight: number }>;
}

export const RANKER_EXPERIMENT: ExperimentDef = {
    key: 'rec_ranker_v1',
    enabled: true,
    variants: [
        { name: 'control', weight: 50 },
        { name: 'srs_heavy', weight: 50 },
    ],
};

/**
 * Separate hash layer for the learned ranker. Users whose layer bucket falls under the model's
 * allocation get `learned`; everyone else keeps their existing control/srs_heavy assignment, so
 * adding or removing a model never reshuffles the original experiment.
 */
export const LEARNED_LAYER = 'rec_learned_layer_v1';

/** Uniform value in [0,1) derived from sha256(experiment:user). */
export function bucket(userId: string, experimentKey: string): number {
    const h = createHash('sha256')
        .update(`${experimentKey}:${userId}`)
        .digest();
    return h.readUInt32BE(0) / 0x1_0000_0000;
}

export function assignVariant(
    userId: string,
    exp: ExperimentDef = RANKER_EXPERIMENT,
    forced: string | undefined = process.env.RECSYS_FORCE_VARIANT
): string {
    const names = exp.variants.map((v) => v.name);
    if (forced && names.includes(forced)) return forced; // kill switch / debugging
    if (!exp.enabled) return exp.variants[0].name;
    const total = exp.variants.reduce((a, v) => a + v.weight, 0);
    let point = bucket(userId, exp.key) * total;
    for (const v of exp.variants) {
        if (point < v.weight) return v.name;
        point -= v.weight;
    }
    return exp.variants[exp.variants.length - 1].name;
}
