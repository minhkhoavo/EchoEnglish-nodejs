import mongoose, { Schema, model } from 'mongoose';

/**
 * Erasure tombstones: the only record that a user asked to be erased, keyed by *pseudonym*
 * (no raw user id). Kafka cannot delete single records and the warehouse is eventually
 * consistent, so exporter and loader consult this list to guarantee that nothing at or before
 * the erasure time is (re)written downstream. Kept without TTL on purpose: expiring it would
 * let late service events of an erased user flow again without a fresh consent.
 */
const schema = new Schema(
    {
        pseudonym: { type: String, required: true },
        region: { type: String, required: true },
        at: { type: Date, required: true },
        /** True until a warehouse DELETE for this pseudonym is known to have succeeded. */
        warehousePending: { type: Boolean, default: true },
    },
    { collection: 'recsys_erasure_tombstones', versionKey: false }
);
schema.index({ pseudonym: 1 }, { unique: true });
schema.index({ at: 1 });

export const ErasureTombstone =
    mongoose.models.RecsysErasureTombstone ||
    model('RecsysErasureTombstone', schema);

export async function recordTombstones(
    entries: Array<{ pseudonym: string; region: string }>,
    at = new Date()
): Promise<void> {
    if (entries.length === 0) return;
    await ErasureTombstone.bulkWrite(
        entries.map((e) => ({
            updateOne: {
                filter: { pseudonym: e.pseudonym },
                update: {
                    $set: { region: e.region, at, warehousePending: true },
                },
                upsert: true,
            },
        })),
        { ordered: false }
    );
}

export type TombstoneMap = Map<string, Date>;

export async function loadTombstones(
    pseudonyms: string[]
): Promise<TombstoneMap> {
    if (pseudonyms.length === 0) return new Map();
    const rows = await ErasureTombstone.find({
        pseudonym: { $in: pseudonyms },
    }).lean<Array<{ pseudonym: string; at: Date }>>();
    return new Map(rows.map((r) => [r.pseudonym, r.at]));
}

/**
 * Tombstones whose warehouse delete must (re)run: those younger than `since` (race window with
 * in-flight inserts) and any whose last delete failed (warehouse outage).
 */
export async function recentTombstones(
    since: Date
): Promise<Array<{ pseudonym: string; region: string; at: Date }>> {
    return ErasureTombstone.find({
        $or: [{ at: { $gte: since } }, { warehousePending: true }],
    }).lean<Array<{ pseudonym: string; region: string; at: Date }>>();
}

export async function markWarehouseDeleted(
    pseudonyms: string[]
): Promise<void> {
    if (pseudonyms.length === 0) return;
    await ErasureTombstone.updateMany(
        { pseudonym: { $in: pseudonyms } },
        { $set: { warehousePending: false } }
    );
}

/** An event is suppressed if it occurred at or before the erasure of its (pseudonymous) subject. */
export function isErased(
    tombstones: TombstoneMap,
    pseudonym: string,
    occurredAt: Date
): boolean {
    const at = tombstones.get(pseudonym);
    return at !== undefined && occurredAt.getTime() <= at.getTime();
}
