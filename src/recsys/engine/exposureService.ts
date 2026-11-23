import { Types } from 'mongoose';
import { RecExposure } from './exposureModel.js';
import { ExposureMap } from './types.js';

const DAY_MS = 86_400_000;
const TTL_DAYS = 30;
const MAX_IMPRESSIONS = 20;

export type FeedbackKind = 'click' | 'complete' | 'dismiss';

export class ExposureService {
    async recordImpressions(
        userId: string,
        itemIds: string[],
        now = new Date()
    ): Promise<void> {
        if (itemIds.length === 0) return;
        const uid = new Types.ObjectId(userId);
        const expireAt = new Date(now.getTime() + TTL_DAYS * DAY_MS);
        await RecExposure.bulkWrite(
            itemIds.map((itemId) => ({
                updateOne: {
                    filter: { userId: uid, itemId },
                    update: {
                        $push: {
                            impressions: {
                                $each: [now],
                                $slice: -MAX_IMPRESSIONS,
                            },
                        },
                        $set: { expireAt },
                    } as Record<string, unknown>,
                    upsert: true,
                },
            })),
            { ordered: false }
        );
    }

    async recordFeedback(
        userId: string,
        itemId: string,
        kind: FeedbackKind,
        opts: { reason?: string; now?: Date } = {}
    ): Promise<void> {
        const now = opts.now ?? new Date();
        const field =
            kind === 'click'
                ? 'clickedAt'
                : kind === 'complete'
                  ? 'completedAt'
                  : 'dismissedAt';
        await RecExposure.updateOne(
            { userId: new Types.ObjectId(userId), itemId },
            {
                $set: {
                    [field]: now,
                    ...(kind === 'dismiss' && opts.reason
                        ? { dismissReason: opts.reason }
                        : {}),
                    expireAt: new Date(now.getTime() + TTL_DAYS * DAY_MS),
                },
            },
            { upsert: true }
        );
    }

    async load(userId: string, now = new Date()): Promise<ExposureMap> {
        const rows = await RecExposure.find({
            userId: new Types.ObjectId(userId),
        }).lean<
            Array<{
                itemId: string;
                impressions?: Date[];
                clickedAt?: Date;
                completedAt?: Date;
                dismissedAt?: Date;
            }>
        >();
        const map: ExposureMap = new Map();
        for (const r of rows) {
            map.set(r.itemId, {
                shown7d: (r.impressions ?? []).filter(
                    (d) => now.getTime() - d.getTime() < 7 * DAY_MS
                ).length,
                clicked: !!r.clickedAt,
                completedAt: r.completedAt,
                dismissedAt: r.dismissedAt,
            });
        }
        return map;
    }
}

export const exposureService = new ExposureService();
