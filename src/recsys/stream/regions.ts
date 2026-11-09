import { recsysConfig } from '../config.js';

/**
 * Region resolution for sink routing. Replaced by the persisted per-learner tag in T3.8;
 * until then every learner belongs to the default region.
 */
export interface RegionService {
    resolve(userIds: string[]): Promise<Map<string, string>>;
}

export const regionService: RegionService = {
    async resolve(userIds) {
        const region = recsysConfig.defaultRegion();
        return new Map(userIds.map((u) => [u, region]));
    },
};
