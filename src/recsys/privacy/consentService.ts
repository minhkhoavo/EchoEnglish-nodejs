import {
    Consent,
    ConsentLedger,
    CONSENT_PURPOSES,
    ConsentPurpose,
} from './consentModel.js';

export const CURRENT_POLICY_VERSION = '2026-01';

export type ConsentState = Record<ConsentPurpose, boolean>;
const NONE: ConsentState = {
    analytics: false,
    personalization: false,
    research: false,
};

interface CacheEntry {
    state: ConsentState;
    exp: number;
}
const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export class ConsentService {
    async get(userId: string): Promise<ConsentState> {
        const hit = cache.get(userId);
        if (hit && hit.exp > Date.now()) return hit.state;
        const doc = await Consent.findOne({ userId }).lean<{
            purposes?: Partial<ConsentState>;
        } | null>();
        const state: ConsentState = { ...NONE, ...(doc?.purposes ?? {}) };
        cache.set(userId, { state, exp: Date.now() + TTL_MS });
        return state;
    }

    async has(userId: string, purpose: ConsentPurpose): Promise<boolean> {
        return (await this.get(userId))[purpose] === true;
    }

    /** Explicit, per-purpose update. Unknown purposes are ignored; every change is ledgered. */
    async update(
        userId: string,
        changes: Partial<Record<string, unknown>>,
        channel: 'web' | 'ios' | 'android' | 'api' = 'api',
        policyVersion = CURRENT_POLICY_VERSION
    ): Promise<ConsentState> {
        const current = await this.get(userId);
        const next = { ...current };
        const ledger: Array<Record<string, unknown>> = [];
        for (const p of CONSENT_PURPOSES) {
            const v = changes[p];
            if (typeof v === 'boolean' && v !== current[p]) {
                next[p] = v;
                ledger.push({
                    userId,
                    policyVersion,
                    purpose: p,
                    granted: v,
                    channel,
                });
            }
        }
        if (ledger.length === 0) return current;
        await Consent.updateOne(
            { userId },
            { $set: { purposes: next, policyVersion, updatedAt: new Date() } },
            { upsert: true }
        );
        await ConsentLedger.insertMany(ledger);
        cache.set(userId, { state: next, exp: Date.now() + TTL_MS });
        return next;
    }

    /** Withdraw everything (PDPL: withdrawing must be as easy as granting). */
    async withdrawAll(
        userId: string,
        channel: 'web' | 'ios' | 'android' | 'api' = 'api'
    ) {
        return this.update(
            userId,
            { analytics: false, personalization: false, research: false },
            channel
        );
    }

    clearCache(userId?: string) {
        if (userId) cache.delete(userId);
        else cache.clear();
    }
}

export const consentService = new ConsentService();
