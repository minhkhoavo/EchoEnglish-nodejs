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
import {
    decideMode,
    generateCandidates,
    learnerCefr,
    rankWeakSkills,
} from './candidates.js';
import { CEFR_ORDER, cefrIndex } from './cefr.js';
import { topicKeywordsForSkill } from './contentTags.js';
import { ALGO_VERSION, VARIANTS, rankCandidates } from './ranker.js';
import {
    applyGuardrails,
    DEFAULT_GUARDRAILS,
    explorationPool,
    exploreSwap,
    GuardrailConfig,
} from './guardrails.js';
import { explain } from './explain.js';
import {
    assignVariant,
    bucket,
    EXPLORE_LAYER,
    LEARNED_LAYER,
    seededRng,
} from './experiments.js';
import { PoolItem, servedService } from './servedService.js';
import { modelRegistry } from '../learning/registry.js';
import { segmentOf, weightsFor } from '../learning/model.js';
import { providerNameFromEnv } from '../embeddings/provider.js';
import {
    buildSemanticContext,
    SemanticContext,
} from '../embeddings/semantic.js';
import { LearnerFeatureSet } from '../features/featureModels.js';
import { LearnerFeatures } from '../features/featureModels.js';
import { featureBuilder } from '../features/featureBuilder.js';
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
    guard: GuardrailConfig = { ...DEFAULT_GUARDRAILS, limit },
    /** When given, ONE slot is filled uniformly at random from the eligible pool. */
    explore?: { rng: () => number }
): Omit<RecommendationResponse, 'recId' | 'generatedAt'> & {
    suppressed: Array<{ id: string; rule: string }>;
    /** Ranking signals per item id, for impression logging only (never returned to clients). */
    signalsById: Record<string, Record<string, number>>;
    /** Eligible candidates that were not shown (logging only). */
    pool: PoolItem[];
    explore?: {
        slot: number;
        propensity: number;
        picked: string;
        replaced: string;
    };
} {
    const mode = decideMode(ctx);
    const candidates = generateCandidates(ctx);
    const ranked = rankCandidates(candidates, variant, mode, ctx);
    const guarded = applyGuardrails(ranked, ctx, learnerCefr(ctx), guard);
    const { suppressed } = guarded;
    // The pool is fixed BEFORE the swap: it is the set the random pick was drawn from.
    const poolCands = explorationPool(guarded.selected, guarded.kept);
    const swap = explore
        ? exploreSwap(guarded.selected, poolCands, explore.rng)
        : null;
    const selected = swap ? swap.selected : guarded.selected;

    const items = selected.map((c, i) => ({
        rank: i + 1,
        id: c.id,
        type: c.type,
        ref: c.ref,
        title: c.title,
        titleI18n: { en: c.title, vi: c.titleVi ?? c.title },
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
            suggestion: timingText(bestHour).en,
            suggestionI18n: timingText(bestHour),
        },
        totalMinutes: items.reduce((a, i) => a + i.estMinutes, 0),
        items,
        suppressed,
        signalsById: Object.fromEntries(
            selected.map((c) => [c.id, positiveSignals(c.signals)])
        ),
        pool: poolCands.map((c) => ({
            itemType: c.type,
            itemRef: c.ref,
            score: c.score,
            signals: positiveSignals(c.signals),
        })),
        ...(swap
            ? {
                  explore: {
                      slot: swap.slot,
                      propensity: swap.propensity,
                      picked: swap.pickedId,
                      replaced: swap.replacedId,
                  },
              }
            : {}),
    };
}

const timingText = (bestHour: number | null) =>
    bestHour === null
        ? {
              en: 'Study at a consistent time each day to build the habit.',
              vi: 'Hãy học vào một khung giờ cố định mỗi ngày để tạo thói quen.',
          }
        : {
              en: `You tend to study around ${String(bestHour).padStart(2, '0')}:00 — schedule this session then.`,
              vi: `Bạn thường học vào khoảng ${String(bestHour).padStart(2, '0')}:00 — hãy xếp buổi học này vào giờ đó.`,
          };

const positiveSignals = (signals: object): Record<string, number> =>
    Object.fromEntries(
        Object.entries(signals).filter(
            ([, v]) => typeof v === 'number' && v > 0
        )
    ) as Record<string, number>;

/** What the learner needs, turned into index-backed catalogue queries (see loadResources). */
export interface RetrievalHints {
    /** CEFR labels within one step of the learner's level. */
    cefr: string[];
    /** Resource topics that train the learner's weak skills. */
    topics: string[];
    /** Most-completed resources in the last 30 days. */
    popularIds: string[];
}

const RETRIEVAL_LIMIT = {
    recent: 100,
    interest: 100,
    level: 100,
    topic: 100,
    popular: 50,
};
const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
/** Labels are free text written by the labelling prompt: match the common casings exactly. */
const casings = (xs: string[]) => [
    ...new Set(
        xs.flatMap((x) => [
            x.toLowerCase(),
            x.toUpperCase(),
            titleCase(x.toLowerCase()),
            x[0]?.toUpperCase() + x.slice(1).toLowerCase(),
        ])
    ),
];

export function retrievalHints(
    ctx: Pick<
        RecContext,
        'features' | 'profile' | 'personalization' | 'popularity'
    >
): RetrievalHints {
    const level = learnerCefr(ctx as RecContext);
    const i = level ? cefrIndex(level) : -1;
    const weak =
        ctx.personalization && ctx.features
            ? rankWeakSkills(ctx.features.skills)
            : [];
    return {
        cefr: level ? CEFR_ORDER.slice(Math.max(0, i - 1), i + 2) : [],
        topics: [
            ...new Set(weak.flatMap((w) => topicKeywordsForSkill(w.skillKey))),
        ],
        popularIds: [...ctx.popularity.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, RETRIEVAL_LIMIT.popular)
            .map(([id]) => id),
    };
}

/** Data access used by the service. Overridable in tests. */
export interface RecDeps {
    loadFeatures(userId: string, now?: Date): Promise<LearnerFeatureSet | null>;
    loadProfile(userId: string): Promise<LearnerProfile>;
    loadResources(
        profile: LearnerProfile,
        hints?: RetrievalHints
    ): Promise<ResourceLike[]>;
    loadExposure(userId: string, now: Date): Promise<ExposureMap>;
    loadPopularity(): Promise<Map<string, number>>;
    hasPersonalizationConsent(userId: string): Promise<boolean>;
    /** Optional: gates what is logged about a served list (signals, not-shown pool). */
    hasAnalyticsConsent?(userId: string): Promise<boolean>;
    /** Optional: embedding similarity to what the learner finished (flagged; null = unavailable). */
    loadSemantic?(
        resources: ResourceLike[],
        exposure: ExposureMap
    ): Promise<SemanticContext | null>;
}

const DAY_MS = 86_400_000;
/** Time-dependent features (due cards, days since X, mastery decay) are refreshed on read past this age. */
export const FEATURE_MAX_AGE_MS = 6 * 3_600_000;

export const mongoDeps: RecDeps = {
    /**
     * Features are rebuilt by the ETL only when a learner produces events, so for someone who
     * has been away they describe the day they left (due cards, days since active, decayed
     * mastery are all stale). Rebuild on read once they are older than FEATURE_MAX_AGE_MS; a
     * failed rebuild serves the stored copy.
     */
    async loadFeatures(userId, now = new Date()) {
        const doc = await LearnerFeatures.findOne({
            userId: new Types.ObjectId(userId),
        }).lean<
            | (Omit<LearnerFeatureSet, 'userId'> & { userId: Types.ObjectId })
            | null
        >();
        if (!doc) return null;
        const stored = { ...doc, userId } as LearnerFeatureSet;
        const age = now.getTime() - new Date(doc.computedAt).getTime();
        if (age <= FEATURE_MAX_AGE_MS) return stored;
        try {
            return await featureBuilder.build(userId, now);
        } catch (e) {
            console.error(
                '[recsys] stale feature rebuild failed:',
                (e as Error).message
            );
            return stored;
        }
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

    /**
     * Retrieval: one bounded, index-backed query per reason a resource can be recommended
     * (recent, interest domain, level, weak-skill topic, popular). Cost is independent of the
     * catalogue size — the previous version only ever saw the 200 newest resources, so an older
     * resource that matched a weak skill could never be found.
     */
    async loadResources(profile, hints) {
        const fields = 'type title labels suitableForLearners publishedAt';
        const find = (filter: Record<string, unknown>, limit: number) =>
            Resource.find({ suitableForLearners: true, ...filter })
                .sort({ publishedAt: -1 })
                .limit(limit)
                .select(fields)
                .lean<ResourceLike[]>();
        const none = Promise.resolve([] as ResourceLike[]);
        const domains = casings(profile.interests); // tolerate legacy upper-case labels
        const popular = (hints?.popularIds ?? []).filter((id) =>
            Types.ObjectId.isValid(id)
        );
        const groups = await Promise.all([
            find({}, RETRIEVAL_LIMIT.recent),
            domains.length
                ? find(
                      { 'labels.domain': { $in: domains } },
                      RETRIEVAL_LIMIT.interest
                  )
                : none,
            hints?.cefr.length
                ? find(
                      { 'labels.cefr': { $in: casings(hints.cefr) } },
                      RETRIEVAL_LIMIT.level
                  )
                : none,
            hints?.topics.length
                ? find(
                      { 'labels.topic': { $in: casings(hints.topics) } },
                      RETRIEVAL_LIMIT.topic
                  )
                : none,
            popular.length
                ? find(
                      {
                          _id: {
                              $in: popular.map((id) => new Types.ObjectId(id)),
                          },
                      },
                      RETRIEVAL_LIMIT.popular
                  )
                : none,
        ]);
        const byId = new Map<string, ResourceLike>();
        for (const r of groups.flat()) byId.set(r._id.toString(), r);
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
    hasAnalyticsConsent: (userId) => consentService.has(userId, 'analytics'),

    async loadSemantic(resources, exposure) {
        if (!recsysConfig.embeddings.enabled()) return null;
        return buildSemanticContext(resources, exposure, providerNameFromEnv());
    },
};

const CACHE_TTL_MS = 120_000;
/** Hard bound on cached lists: the map is per process and must not grow with the user base. */
export const CACHE_MAX_ENTRIES = 5000;
const cache = new Map<string, { exp: number; value: RecommendationResponse }>();

function cachePut(key: string, value: RecommendationResponse, nowMs: number) {
    cache.delete(key); // re-insert so Map order stays oldest-first
    cache.set(key, { exp: nowMs + CACHE_TTL_MS, value });
    if (cache.size <= CACHE_MAX_ENTRIES) return;
    for (const [k, v] of cache) if (v.exp <= nowMs) cache.delete(k);
    for (const k of cache.keys()) {
        if (cache.size <= CACHE_MAX_ENTRIES) break;
        cache.delete(k);
    }
}
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
        // Consent is read BEFORE the cache and is part of the key: a withdrawal takes effect on
        // every instance at once instead of after another process's cache entry expires.
        const personalization =
            await this.deps.hasPersonalizationConsent(userId);
        const key = `${userId}:${limit}:${personalization ? 'p' : 'c'}`;
        const hit = cache.get(key);
        if (!opts.refresh && hit && hit.exp > now.getTime()) return hit.value;

        const [features, profile, exposure] = await Promise.all([
            this.deps.loadFeatures(userId, now),
            this.deps.loadProfile(userId),
            this.deps.loadExposure(userId, now),
        ]);
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
        const resources = await this.deps.loadResources(
            profile,
            retrievalHints({ features, profile, personalization, popularity })
        );

        // Optional signal: any failure just means "no semantic context", never a failed request.
        const semantic = this.deps.loadSemantic
            ? await this.deps.loadSemantic(resources, exposure).catch((e) => {
                  console.error(
                      '[recsys] semantic context failed:',
                      (e as Error).message
                  );
                  return null;
              })
            : null;

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
            semantic,
        };
        const { variant, algo } = await this.chooseVariant(userId, features);
        const recId = randomUUID();
        const explorePct = recsysConfig.explore.pct();
        const exploring =
            explorePct > 0 && bucket(recId, EXPLORE_LAYER) * 100 < explorePct;
        const built = buildRecommendations(
            ctx,
            variant,
            limit,
            undefined,
            exploring ? { rng: seededRng(recId) } : undefined
        );
        const { suppressed: _s, signalsById, pool, explore, ...body } = built;
        void _s;
        const response: RecommendationResponse = {
            recId,
            generatedAt: now.toISOString(),
            ...body,
            ...(algo ? { algo } : {}),
        };
        cachePut(key, response, now.getTime());
        const segment = segmentOf(features);

        // Server-side record of what was served: feedback is attributed against it (variant,
        // mode and position never come from the client). Awaited so feedback sent right after
        // the response can be matched; a failed write never fails the request.
        if (recsysConfig.enabled()) {
            const analytics = this.deps.hasAnalyticsConsent
                ? await this.deps.hasAnalyticsConsent(userId).catch(() => false)
                : false;
            await servedService
                .record({
                    recId,
                    userId,
                    servedAt: now,
                    variant: response.variant,
                    mode: response.mode,
                    algo: response.algo,
                    segment,
                    ...(features ? { featuresAt: features.computedAt } : {}),
                    items: response.items.map((it) => ({
                        itemType: it.type,
                        itemRef: it.ref,
                        position: it.rank - 1,
                        score: it.score,
                        ...(analytics
                            ? { signals: signalsById[it.id] ?? {} }
                            : {}),
                        ...(explore?.picked === it.id
                            ? { explored: true }
                            : {}),
                    })),
                    ...(explore
                        ? {
                              explore: {
                                  slot: explore.slot,
                                  propensity: explore.propensity,
                                  replaced: explore.replaced,
                              },
                          }
                        : {}),
                    ...(analytics ? { pool } : {}),
                })
                .catch((e) =>
                    console.error(
                        '[recsys] served-list write failed:',
                        (e as Error).message
                    )
                );
        }

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
                        signals: signalsById[it.id] ?? {},
                        segment,
                        ...(explore?.picked === it.id
                            ? { explored: true, propensity: explore.propensity }
                            : {}),
                    },
                }))
            );
        }
        return response;
    }

    /**
     * Control/srs_heavy by hash bucket, except for the small share of users routed to the live
     * learned model (own hash layer). Disabled flag, kill switch or any registry failure ⇒ the
     * default path; the request never depends on the registry being healthy.
     */
    private async chooseVariant(
        userId: string,
        features: LearnerFeatureSet | null
    ): Promise<{ variant: Variant; algo?: string }> {
        const fallback = {
            variant: VARIANTS[assignVariant(userId)] ?? VARIANTS.control,
        };
        if (process.env.RECSYS_FORCE_VARIANT || !recsysConfig.retrain.enabled())
            return fallback;
        try {
            const m = await modelRegistry.getActive();
            if (
                m &&
                m.payload &&
                m.status === 'active' &&
                m.dataSource === 'production' &&
                bucket(userId, LEARNED_LAYER) * 100 < m.allocationPct
            )
                return {
                    variant: {
                        name: 'learned',
                        weights: weightsFor(m.payload, segmentOf(features)),
                    },
                    algo: `${m.algo}:v${m.version}`,
                };
        } catch (err) {
            console.error(
                '[recsys] model registry unavailable:',
                (err as Error).message
            );
        }
        return fallback;
    }

    /** Drop this user's cached lists (call after feedback so the next fetch reflects it). */
    invalidate(userId: string) {
        for (const k of cache.keys())
            if (k.startsWith(`${userId}:`)) cache.delete(k);
    }

    cacheSize() {
        return cache.size;
    }

    clearCache() {
        cache.clear();
        popularityCache = null;
    }
}

export const recommenderService = new RecommenderService();
