import { Warehouse } from './clickhouse.js';
import { markWarehouseDeleted, recentTombstones } from '../stream/erasure.js';

/**
 * Delete a data subject's rows from the warehouse (lightweight DELETE, synchronous so the
 * erase response can state the truth).
 */
export async function eraseFromWarehouse(
    wh: Pick<Warehouse, 'command'>,
    pseudonyms: string[],
    table = 'events'
): Promise<void> {
    if (pseudonyms.length === 0) return;
    await wh.command(
        `DELETE FROM ${table} WHERE user_pseudo IN {p:Array(String)} SETTINGS mutations_sync = 2`,
        { p: pseudonyms }
    );
}

/**
 * Closes the loader/erase race: an insert that passed the tombstone check just before the
 * tombstone was written could land after the first DELETE. Re-applying deletes for tombstones
 * younger than `windowMs` makes the outcome converge without a distributed lock.
 */
export async function sweepRecentTombstones(
    wh: Pick<Warehouse, 'command'>,
    now = new Date(),
    windowMs = 60 * 60_000
): Promise<number> {
    const recent = await recentTombstones(new Date(now.getTime() - windowMs));
    const pseudonyms = recent.map((t) => t.pseudonym);
    await eraseFromWarehouse(wh, pseudonyms);
    await markWarehouseDeleted(pseudonyms);
    return recent.length;
}
