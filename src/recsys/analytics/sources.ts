import { DailyFacts } from '../etl/models.js';
import { LearningEvent } from '../events/eventModel.js';
import { recsysConfig } from '../config.js';
import { FactRow, VariantRow } from './kpi.js';
import { pseudonymise, requirePseudonymSalt } from '../stream/pseudonym.js';
import { regionService } from '../stream/regions.js';
import { createWarehouse, Warehouse } from '../warehouse/clickhouse.js';

/**
 * Where KPI inputs come from. The KPI math (kpi.ts) is pure over FactRow / VariantRow, so
 * switching backend never changes a definition — only where the rows are read from.
 */
export interface AnalyticsSource {
    readonly name: 'mongo' | 'clickhouse';
    /** Real user id → the key used by this source's fact rows. */
    keys(userIds: string[]): Promise<Map<string, string>>;
    facts(fromDay: string): Promise<FactRow[]>;
    variantRows(since: Date): Promise<VariantRow[]>;
}

type MongoFact = Omit<FactRow, 'userId'> & { userId: { toString(): string } };

export const mongoSource: AnalyticsSource = {
    name: 'mongo',
    async keys(userIds) {
        return new Map(userIds.map((u) => [u, u]));
    },
    async facts(fromDay) {
        const facts = await DailyFacts.find({ day: { $gte: fromDay } })
            .select(
                'userId day learningActions studySeconds creditsSpent aiCostUsd lastTestScore'
            )
            .lean<MongoFact[]>();
        return facts.map((f) => ({ ...f, userId: f.userId.toString() }));
    },
    async variantRows(since) {
        // Group by variant AND mode: cold-start lists ignore the variant (mode absent on
        // legacy rows → 'unknown'), so mixing them would dilute any real difference.
        const key = {
            v: '$props.variant',
            m: { $ifNull: ['$props.mode', 'unknown'] },
        };
        const imps = await LearningEvent.aggregate<{
            _id: { v: string; m: string };
            impressions: number;
            users: string[];
        }>([
            { $match: { type: 'rec_impression', occurredAt: { $gte: since } } },
            {
                $group: {
                    _id: key,
                    impressions: { $sum: 1 },
                    users: { $addToSet: '$userId' },
                },
            },
        ]);
        const outcomes = await LearningEvent.aggregate<{
            _id: { v: string; m: string; t: string };
            n: number;
        }>([
            {
                $match: {
                    type: { $in: ['rec_click', 'rec_complete', 'rec_dismiss'] },
                    occurredAt: { $gte: since },
                },
            },
            { $group: { _id: { ...key, t: '$type' }, n: { $sum: 1 } } },
        ]);
        const get = (v: string, m: string, t: string) =>
            outcomes.find(
                (o) => o._id.v === v && o._id.m === m && o._id.t === t
            )?.n ?? 0;
        return imps.map((i) => ({
            variant: i._id.v,
            mode: i._id.m,
            impressions: i.impressions,
            users: i.users.length,
            clicks: get(i._id.v, i._id.m, 'rec_click'),
            completes: get(i._id.v, i._id.m, 'rec_complete'),
            dismisses: get(i._id.v, i._id.m, 'rec_dismiss'),
        }));
    },
};

/**
 * ClickHouse reads the dbt marts (`learner_daily_facts`) and staging view (`stg_events`), so the
 * SQL definitions of facts live in exactly one place (analytics/dbt).
 */
export function clickhouseSource(
    open: () => Promise<Warehouse> = () => createWarehouse()
): AnalyticsSource {
    const withWh = async <T>(fn: (wh: Warehouse) => Promise<T>) => {
        const wh = await open();
        try {
            return await fn(wh);
        } finally {
            await wh.close();
        }
    };
    return {
        name: 'clickhouse',
        async keys(userIds) {
            const salt = requirePseudonymSalt();
            const regions = await regionService.resolve(userIds);
            return new Map(
                userIds.map((u) => [u, pseudonymise(u, regions.get(u)!, salt)])
            );
        },
        facts: (fromDay) =>
            withWh(async (wh) => {
                const rows = await wh.query<{
                    user_pseudo: string;
                    day_str: string;
                    learning_actions: string;
                    study_seconds: string;
                    credits_spent: number;
                    ai_cost_usd: number;
                    last_test_score: number | null;
                }>(
                    `SELECT user_pseudo, toString(day) AS day_str, learning_actions, study_seconds,
                            credits_spent, ai_cost_usd, last_test_score
                     FROM learner_daily_facts WHERE day >= {from:Date}`,
                    { from: fromDay }
                );
                return rows.map((r) => ({
                    userId: r.user_pseudo,
                    day: r.day_str,
                    learningActions: Number(r.learning_actions),
                    studySeconds: Number(r.study_seconds),
                    creditsSpent: Number(r.credits_spent),
                    aiCostUsd: Number(r.ai_cost_usd),
                    ...(r.last_test_score !== null
                        ? { lastTestScore: Number(r.last_test_score) }
                        : {}),
                }));
            }),
        variantRows: (since) =>
            withWh(async (wh) => {
                const rows = await wh.query<{
                    variant: string;
                    mode: string;
                    impressions: string;
                    users: string;
                    clicks: string;
                    completes: string;
                    dismisses: string;
                }>(
                    `SELECT variant, if(mode = '', 'unknown', mode) AS mode,
                            countIf(type = 'rec_impression') AS impressions,
                            uniqExactIf(user_pseudo, type = 'rec_impression') AS users,
                            countIf(type = 'rec_click') AS clicks,
                            countIf(type = 'rec_complete') AS completes,
                            countIf(type = 'rec_dismiss') AS dismisses
                     FROM stg_events
                     WHERE type IN ('rec_impression','rec_click','rec_complete','rec_dismiss')
                       AND occurred_at >= parseDateTime64BestEffort({since:String}, 3, 'UTC')
                     GROUP BY variant, mode
                     HAVING impressions > 0`,
                    { since: since.toISOString() }
                );
                return rows.map((r) => ({
                    variant: r.variant,
                    mode: r.mode,
                    impressions: Number(r.impressions),
                    users: Number(r.users),
                    clicks: Number(r.clicks),
                    completes: Number(r.completes),
                    dismisses: Number(r.dismisses),
                }));
            }),
    };
}

export function backendFromEnv(): 'mongo' | 'clickhouse' {
    return recsysConfig.analyticsBackend() === 'clickhouse'
        ? 'clickhouse'
        : 'mongo';
}
