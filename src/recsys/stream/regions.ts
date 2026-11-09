import { recsysConfig } from '../config.js';

/**
 * Region resolution for sink routing. Replaced by the persisted per-learner tag in T3.8;
 * until then every learner belongs to the default region.
 */
export interface RegionService {
    resolve(userIds: string[]): Promise<Map<string, string>>;
}

/** Regions this deployment knows about (RECSYS_REGIONS, comma separated). */
export function knownRegions(): string[] {
    const fromEnv = (process.env.RECSYS_REGIONS ?? '')
        .split(',')
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean);
    return fromEnv.length ? fromEnv : [recsysConfig.defaultRegion()];
}

export const regionService: RegionService = {
    async resolve(userIds) {
        const region = recsysConfig.defaultRegion();
        return new Map(userIds.map((u) => [u, region]));
    },
};
