import { Types } from 'mongoose';
import { LearningEvent } from '../events/eventModel.js';
import { CleanEvent, DailyFacts } from '../etl/models.js';
import { LearnerFeatures, SkillMastery } from '../features/featureModels.js';
import { Consent, ConsentLedger } from './consentModel.js';
import { consentService } from './consentService.js';
import { recommenderService } from '../engine/recommender.js';
import { RecExposure } from '../engine/exposureModel.js';
import { RecServed } from '../engine/servedModel.js';
import { FeatureSnapshot } from '../featurestore/snapshotModel.js';
import { recsysConfig } from '../config.js';
import { pseudonymise, requirePseudonymSalt } from '../stream/pseudonym.js';
import { markWarehouseDeleted, recordTombstones } from '../stream/erasure.js';
import { LearnerRegion, knownRegions } from '../stream/regions.js';
import { createWarehouse, Warehouse } from '../warehouse/clickhouse.js';
import { eraseFromWarehouse } from '../warehouse/erasure.js';

const EXPORT_EVENT_CAP = 20_000;

/**
 * Data-subject rights (PDPL access + erasure). Everything keyed by userId so both operations
 * are a handful of indexed queries. Decree 356 response targets: access 2 working days to
 * respond / 10 days to execute; erasure 2 / 20 (see 03-architecture.md §8) — these endpoints
 * execute immediately, so the SLA is met by construction.
 */
export type WarehouseErasure = 'deleted' | 'failed' | 'not_enabled';

export class DataSubjectService {
    constructor(
        private readonly openWarehouse: () => Promise<Warehouse> = () =>
            createWarehouse()
    ) {}

    /**
     * Phase 3 downstream copies. Tombstones are written FIRST so the exporter/loader stop
     * handling this subject before the Mongo rows disappear; the warehouse delete follows. If it
     * fails the tombstone stays `warehousePending` and the loader's sweep retries it.
     */
    private async propagateErasure(userId: string): Promise<{
        tombstones: number;
        warehouse: WarehouseErasure;
    }> {
        let salt: string;
        try {
            salt = requirePseudonymSalt();
        } catch {
            return { tombstones: 0, warehouse: 'not_enabled' }; // nothing was ever exported
        }
        const entries = knownRegions().map((region) => ({
            region,
            pseudonym: pseudonymise(userId, region, salt),
        }));
        await recordTombstones(entries);
        if (!recsysConfig.clickhouse.enabled())
            return { tombstones: entries.length, warehouse: 'not_enabled' };
        const pseudonyms = entries.map((e) => e.pseudonym);
        try {
            const wh = await this.openWarehouse();
            try {
                await eraseFromWarehouse(wh, pseudonyms);
            } finally {
                await wh.close();
            }
            await markWarehouseDeleted(pseudonyms);
            return { tombstones: entries.length, warehouse: 'deleted' };
        } catch (err) {
            console.error(
                '[recsys] warehouse erase failed (will retry):',
                (err as Error).message
            );
            return { tombstones: entries.length, warehouse: 'failed' };
        }
    }

    async exportUserData(userId: string) {
        const uid = new Types.ObjectId(userId);
        const [
            events,
            facts,
            mastery,
            features,
            consent,
            ledger,
            eventCount,
            exposure,
            snapshots,
            region,
            served,
        ] = await Promise.all([
            LearningEvent.find({ userId: uid })
                .sort({ occurredAt: -1 })
                .limit(EXPORT_EVENT_CAP)
                .select('-_id -__v')
                .lean(),
            DailyFacts.find({ userId: uid })
                .sort({ day: 1 })
                .select('-_id')
                .lean(),
            SkillMastery.find({ userId: uid }).select('-_id').lean(),
            LearnerFeatures.findOne({ userId: uid }).select('-_id').lean(),
            Consent.findOne({ userId: uid }).select('-_id').lean(),
            ConsentLedger.find({ userId: uid })
                .sort({ at: 1 })
                .select('-_id')
                .lean(),
            LearningEvent.countDocuments({ userId: uid }),
            RecExposure.find({ userId: uid }).select('-_id').lean(),
            FeatureSnapshot.find({ userId: uid })
                .sort({ asOf: 1 })
                .select('-_id -userId')
                .lean(),
            LearnerRegion.findOne({ userId: uid })
                .select('-_id -userId')
                .lean(),
            RecServed.find({ userId: uid })
                .sort({ servedAt: -1 })
                .limit(2000)
                .select('-_id -userId -expireAt')
                .lean(),
        ]);
        return {
            exportedAt: new Date().toISOString(),
            events,
            eventsTruncated: eventCount > EXPORT_EVENT_CAP,
            dailyFacts: facts,
            skillMastery: mastery,
            features,
            recommendationState: exposure,
            servedRecommendations: served,
            featureSnapshots: snapshots,
            dataRegion: region,
            consent,
            consentHistory: ledger,
        };
    }

    /**
     * Erase all learning-analytics data for a user, then withdraw consent so nothing is
     * re-collected until they opt in again. The consent ledger is retained as proof of lawful
     * processing (contains no learning content) — counsel to confirm retention period.
     */
    async eraseUserData(userId: string) {
        const uid = new Types.ObjectId(userId);
        const downstream = await this.propagateErasure(userId);
        const [
            events,
            clean,
            facts,
            mastery,
            features,
            exposure,
            snapshots,
            ,
            served,
        ] = await Promise.all([
            LearningEvent.deleteMany({ userId: uid }),
            CleanEvent.deleteMany({ userId: uid }),
            DailyFacts.deleteMany({ userId: uid }),
            SkillMastery.deleteMany({ userId: uid }),
            LearnerFeatures.deleteMany({ userId: uid }),
            RecExposure.deleteMany({ userId: uid }),
            FeatureSnapshot.deleteMany({ userId: uid }),
            LearnerRegion.deleteMany({ userId: uid }),
            RecServed.deleteMany({ userId: uid }),
        ]);
        await consentService.withdrawAll(userId);
        recommenderService.clearCache();
        return {
            erasedAt: new Date().toISOString(),
            deleted: {
                events: events.deletedCount,
                cleanEvents: clean.deletedCount,
                dailyFacts: facts.deletedCount,
                skillMastery: mastery.deletedCount,
                features: features.deletedCount,
                recommendationState: exposure.deletedCount,
                featureSnapshots: snapshots.deletedCount,
                servedRecommendations: served.deletedCount,
            },
            consentWithdrawn: true,
            downstream,
        };
    }
}

export const dataSubjectService = new DataSubjectService();
