import { Types } from 'mongoose';
import { RecServed } from './servedModel.js';
import { recsysConfig } from '../config.js';

export interface ServedItem {
    itemType: string;
    itemRef: string;
    position: number;
    score: number;
    /** Ranking signals at serve time (analytics consent only). */
    signals?: Record<string, number>;
    /** True for the item placed by the randomised slot. */
    explored?: boolean;
}

export interface PoolItem {
    itemType: string;
    itemRef: string;
    score: number;
    signals: Record<string, number>;
}

export interface ServedList {
    recId: string;
    userId: string;
    servedAt: Date;
    variant: string;
    mode: 'personalized' | 'cold_start';
    algo: string;
    segment?: string;
    featuresAt?: Date;
    items: ServedItem[];
    explore?: { slot: number; propensity: number; replaced: string };
    pool?: PoolItem[];
}

const DAY_MS = 86_400_000;

type Stored = Omit<ServedList, 'userId'> & { userId: Types.ObjectId };
const toList = (d: Stored): ServedList => ({
    ...d,
    userId: d.userId.toString(),
});

export class ServedService {
    async record(list: ServedList): Promise<void> {
        await RecServed.create({
            ...list,
            userId: new Types.ObjectId(list.userId),
            expireAt: new Date(
                list.servedAt.getTime() +
                    recsysConfig.servedRetentionDays() * DAY_MS
            ),
        });
    }

    /** The list, only if it was served to THIS user. */
    async find(userId: string, recId: string): Promise<ServedList | null> {
        if (!Types.ObjectId.isValid(userId)) return null;
        const d = await RecServed.findOne({
            recId,
            userId: new Types.ObjectId(userId),
        })
            .select('-_id -expireAt -pool')
            .lean<Stored | null>();
        return d ? toList(d) : null;
    }

    async findMany(
        userId: string,
        recIds: string[]
    ): Promise<Map<string, ServedList>> {
        const out = new Map<string, ServedList>();
        if (recIds.length === 0 || !Types.ObjectId.isValid(userId)) return out;
        const rows = await RecServed.find({
            recId: { $in: [...new Set(recIds)] },
            userId: new Types.ObjectId(userId),
        })
            .select('-_id -expireAt -pool')
            .lean<Stored[]>();
        for (const r of rows) out.set(r.recId, toList(r));
        return out;
    }
}

export const servedService = new ServedService();

export const servedItem = (
    list: ServedList | null | undefined,
    itemType: string,
    itemRef: string | undefined
): ServedItem | undefined =>
    list?.items.find((i) => i.itemType === itemType && i.itemRef === itemRef);
