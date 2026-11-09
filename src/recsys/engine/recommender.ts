import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
    ExposureMap,
    LearnerProfile,
    RecContext,
    RecommendationResponse,
    ResourceLike,
    Variant,
} from './types.js';
import { decideMode, generateCandidates, learnerCefr } from './candidates.js';
import { ALGO_VERSION, VARIANTS, rankCandidates } from './ranker.js';
import {
    applyGuardrails,
    DEFAULT_GUARDRAILS,
    GuardrailConfig,
} from './guardrails.js';
import { explain } from './explain.js';
import { assignVariant } from './experiments.js';
import { LearnerFeatureSet } from '../features/featureModels.js';
import { LearnerFeatures } from '../features/featureModels.js';
import { LearningEvent } from '../events/eventModel.js';
import { CleanEvent } from '../etl/models.js';
import { consentService } from '../privacy/consentService.js';
import { eventService } from '../events/eventService.js';
import { exposureService } from './exposureService.js';
import { recsysConfig } from '../config.js';
import { User } from '../../models/userModel.js';
import { Resource } from '../../models/resource.js';

const BEST_HOUR_BY_PREFERENCE: Record<string, number> = {
    morning: 7,
    afternoon: 14,
    evening: 20,
    night: 22,
};

/** Pure orchestration: context → ranked, guarded, explained recommendations. */
export function buildRecommendations(
    ctx: RecContext,
    variant: Variant,
    limit = DEFAULT_GUARDRAILS.limit,
    guard: GuardrailConfig = { ...DEFAULT_GUARDRAILS, limit }
): Omit<RecommendationResponse, 'recId' | 'generatedAt'> & {
    suppressed: Array<{ id: string; rule: string }>;
} {
    const mode = decideMode(ctx);
    const candidates = generateCandidates(ctx);
    const ranked = rankCandidates(candidates, variant, mode, ctx);
    const { selected, suppressed } = applyGuardrails(
        ranked,
        ctx,
        learnerCefr(ctx),
        guard
    );

    const items = selected.map((c, i) => ({
        rank: i + 1,
        id: c.id,
        type: c.type,
        ref: c.ref,
        title: c.title,
        estMinutes: c.estMinutes,
        skillKey: c.skillKey,
        score: c.score,
        reason: explain(c),
        action: c.action,
    }));

    const bestHour =
        ctx.personalization && ctx.features?.timing.bestHours.length
            ? ctx.features.timing.bestHours[0]
            : (BEST_HOUR_BY_PREFERENCE[ctx.profile.preferredStudyTime ?? ''] ??
              null);
    return {
        variant: variant.name,
        algo: ALGO_VERSION,
        mode,
        timing: {
            bestHour,
            suggestion:
                bestHour === null
                    ? 'Study at a consistent time each day to build the habit.'
                    : `You tend to study around ${String(bestHour).padStart(2, '0')}:00 — schedule this session then.`,
        },
        totalMinutes: items.reduce((a, i) => a + i.estMinutes, 0),
        items,
        suppressed,
    };
}

/** Data access used by the service. Overridable in tests. */
export interface RecDeps {
    loadFeatures(userId: string): Promise<LearnerFeatureSet | null>;
    loadProfile(userId: string): Promise<LearnerProfile>;
    loadResources(profile: LearnerProfile): Promise<ResourceLike[]>;
    loadExposure(userId: string, now: Date): Promise<ExposureMap>;
    loadPopularity(): Promise<Map<string, number>>;
    hasPersonalizationConsent(userId: string): Promise<boolean>;
}

const DAY_MS = 86_400_000;

export const mongoDeps: RecDeps = {
    async loadFeatures(userId) {
        const doc = await LearnerFeatures.findOne({
            userId: new Types.ObjectId(userId),
        }).lean<
            | (Omit<LearnerFeatureSet, 'userId'> & { userId: Types.ObjectId })
            | null
        >();
        return doc ? ({ ...doc, userId } as LearnerFeatureSet) : null;
    },

    async loadProfile(userId) {
        const u = await User.findById(userId)
            .select('preferences')
            .lean<{ preferences?: Record<string, unknown> } | null>();
        const p = u?.preferences ?? {};
        return {
            targetScore: p.targetScore as number | undefined,
            level: p.currentLevel as string | undefined,
            interests: (p.contentInterests as string[] | undefined) ?? [],
            studyMinutesPerDay: (p.studyTimePerDay as number | undefined) ?? 30,
            preferredStudyTime:
                p.preferredStudyTime as LearnerProfile['preferredStudyTime'],
        };
    },

    async loadResources(profile) {
        const lower = profile.interests.map((d) => d.toLowerCase());
        const both = [...lower, ...lower.map((d) => d.toUpperCase())]; // tolerate legacy upper-case labels
        const [recent, interesting] = await Promise.all([
            Resource.find({ suitableForLearners: true })
                .sort({ publishedAt: -1 })
                .limit(200)
                .select('type title labels suitableForLearners publishedAt')
                .lean<ResourceLike[]>(),
            both.length
                ? Resource.find({
                      suitableForLearners: true,
                      'labels.domain': { $in: both },
                  })
                      .limit(100)
                      .select(
                          'type title labels suitableForLearners publishedAt'
                      )
                      .lean<ResourceLike[]>()
                : Promise.resolve([] as ResourceLike[]),
        ]);
        const byId = new Map<string, ResourceLike>();
        for (const r of [...recent, ...interesting])
            byId.set(r._id.toString(), r);
        return [...byId.values()];
    },

    async loadExposure(userId, now) {
        // Functional store (works without analytics consent) …
        const map = await exposureService.load(userId, now);
        // … plus resource completions seen in behavioural events (only exist for consenting users).
        const since = new Date(now.getTime() - 30 * DAY_MS);
        const viewed = await LearningEvent.find({
            userId: new Types.ObjectId(userId),
            type: 'resource_viewed',
            'props.completed': true,
            occurredAt: { $gte: since },
        })
            .select('occurredAt props.resourceId')
            .lean<Array<{ occurredAt: Date; props: { resourceId: string } }>>();
        for (const r of viewed) {
            const id = `resource:${r.props.resourceId}`;
            const e = map.get(id) ?? { shown7d: 0, clicked: false };
            if (!e.completedAt || r.occurredAt > e.completedAt)
                e.completedAt = r.occurredAt;
            map.set(id, e);
        }
        return map;
    },

    /** Distinct learners who completed/viewed each resource in 30 days, log-scaled to [0,1]. */
    async loadPopularity() {
        const since = new Date(Date.now() - 30 * DAY_MS);
        const rows = await CleanEvent.aggregate<{ _id: string; users: number }>(
            [
                {
                    $match: {
                        type: 'resource_viewed',
                        occurredAt: { $gte: since },
                    },
                },
                { $group: { _id: { r: '$props.resourceId', u: '$userId' } } },
                { $group: { _id: '$_id.r', users: { $sum: 1 } } },
                { $sort: { users: -1 } },
                { $limit: 500 },
            ]
        );
        const max = Math.log1p(rows[0]?.users ?? 0);
        return new Map(
            rows.map((r) => [r._id, max > 0 ? Math.log1p(r.users) / max : 0])
        );
    },

    hasPersonalizationConsent: (userId) =>
        consentService.has(userId, 'personalization'),
};

const CACHE_TTL_MS = 120_000;
const cache = new Map<string, { exp: number; value: RecommendationResponse }>();
let popularityCache: { exp: number; value: Map<string, number> } | null = null;

export class RecommenderService {
    constructor(private readonly deps: RecDeps = mongoDeps) {}

    async recommend(
        userId: string,
        opts: {
            limit?: number;
            now?: Date;
            refresh?: boolean;
            logImpressions?: boolean;
        } = {}
    ): Promise<RecommendationResponse> {
        const now = opts.now ?? new Date();
        const limit = Math.min(
            10,
            Math.max(1, opts.limit ?? DEFAULT_GUARDRAILS.limit)
        );
        const key = `${userId}:${limit}`;
        const hit = cache.get(key);
        if (!opts.refresh && hit && hit.exp > now.getTime()) return hit.value;

        const personalization =
            await this.deps.hasPersonalizationConsent(userId);
        const [features, profile, exposure] = await Promise.all([
            this.deps.loadFeatures(userId),
            this.deps.loadProfile(userId),
            this.deps.loadExposure(userId, now),
        ]);
        const resources = await this.deps.loadResources(profile);
        let popularity =
            popularityCache && popularityCache.exp > now.getTime()
                ? popularityCache.value
                : undefined;
        if (!popularity) {
            popularity = await this.deps.loadPopularity();
            popularityCache = {
                exp: now.getTime() + 10 * 60_000,
                value: popularity,
            };
        }

        const ctx: RecContext = {
            userId,
            now,
            features,
            profile,
            personalization,
            exposure,
            resources,
            popularity,
            availableMinutes: profile.studyMinutesPerDay,
        };
        const variant = VARIANTS[assignVariant(userId)] ?? VARIANTS.control;
        const built = buildRecommendations(ctx, variant, limit);
        const { suppressed: _s, ...body } = built;
        void _s;
        const response: RecommendationResponse = {
            recId: randomUUID(),
            generatedAt: now.toISOString(),
            ...body,
        };
        cache.set(key, { exp: now.getTime() + CACHE_TTL_MS, value: response });

        // Functional repetition guard: recorded for everyone (no consent needed), tiny + TTL'd.
        if (recsysConfig.enabled()) {
            exposureService
                .recordImpressions(
                    userId,
                    response.items.map((i) => i.id),
                    now
                )
                .catch((e) =>
                    console.error(
                        '[recsys] exposure write failed:',
                        (e as Error).message
                    )
                );
        }

        if (opts.logImpressions !== false) {
            // Impressions are behavioural events: stored only for users who consented to analytics.
            void eventService.emitManyAsync(
                userId,
                response.items.map((it) => ({
                    type: 'rec_impression' as const,
                    props: {
                        recId: response.recId,
                        itemType: it.type,
                        itemRef: it.ref,
                        position: it.rank - 1,
                        variant: response.variant,
                        mode: response.mode,
                        algo: response.algo,
                        ...(it.skillKey ? { skillKey: it.skillKey } : {}),
                    },
                }))
            );
        }
        return response;
    }

    /** Drop this user's cached lists (call after feedback so the next fetch reflects it). */
    invalidate(userId: string) {
        for (const k of cache.keys())
            if (k.startsWith(`${userId}:`)) cache.delete(k);
    }

    clearCache() {
        cache.clear();
        popularityCache = null;
    }
}

export const recommenderService = new RecommenderService();
