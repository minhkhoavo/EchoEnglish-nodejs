import { Types } from 'mongoose';
import { LearningEvent } from '../events/eventModel.js';
import { CleanEvent, DailyFacts } from '../etl/models.js';
import { LearnerFeatures, SkillMastery } from '../features/featureModels.js';
import { Consent, ConsentLedger } from './consentModel.js';
import { consentService } from './consentService.js';
import { recommenderService } from '../engine/recommender.js';
import { RecExposure } from '../engine/exposureModel.js';

const EXPORT_EVENT_CAP = 20_000;

/**
 * Data-subject rights (PDPL access + erasure). Everything keyed by userId so both operations
 * are a handful of indexed queries. Decree 356 response targets: access 2 working days to
 * respond / 10 days to execute; erasure 2 / 20 (see 03-architecture.md §8) — these endpoints
 * execute immediately, so the SLA is met by construction.
 */
export class DataSubjectService {
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
        ]);
        return {
            exportedAt: new Date().toISOString(),
            events,
            eventsTruncated: eventCount > EXPORT_EVENT_CAP,
            dailyFacts: facts,
            skillMastery: mastery,
            features,
            recommendationState: exposure,
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
        const [events, clean, facts, mastery, features, exposure] =
            await Promise.all([
                LearningEvent.deleteMany({ userId: uid }),
                CleanEvent.deleteMany({ userId: uid }),
                DailyFacts.deleteMany({ userId: uid }),
                SkillMastery.deleteMany({ userId: uid }),
                LearnerFeatures.deleteMany({ userId: uid }),
                RecExposure.deleteMany({ userId: uid }),
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
            },
            consentWithdrawn: true,
        };
    }
}

export const dataSubjectService = new DataSubjectService();
