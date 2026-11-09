import { DailyFacts } from '../etl/models.js';
import { LearningEvent } from '../events/eventModel.js';
import { localDayHour } from '../etl/clean.js';
import { User } from '../../models/userModel.js';
import { Payment } from '../../models/payment.js';
import { TransactionType } from '../../enum/transactionType.js';
import { PaymentStatus } from '../../enum/paymentStatus.js';
import {
    FactRow,
    SignupRow,
    activationRate,
    activeDaysByUser,
    activeUserCounts,
    addDays,
    dayNRetention,
    experimentReadout,
    scoreGain,
    studyTime,
    unitEconomics,
} from './kpi.js';

const MAX_WINDOW_DAYS = 90;

export class KpiService {
    /**
     * Platform KPI overview for [today-windowDays, today]. Reads only gold facts + users +
     * payments (never raw events) so it stays cheap. At > ~50k MAU move this to a warehouse (Phase 3).
     */
    async overview(opts: { windowDays?: number; now?: Date } = {}) {
        const now = opts.now ?? new Date();
        const windowDays = Math.min(
            MAX_WINDOW_DAYS,
            Math.max(7, opts.windowDays ?? 30)
        );
        const today = localDayHour(now).day;
        const from = addDays(today, -(windowDays - 1));
        const fromDate = new Date(now.getTime() - windowDays * 86_400_000);
        // retention needs facts up to 30 days AFTER signup → load a longer fact history
        const factsFrom = addDays(today, -(windowDays + 30));

        const [facts, users, purchases] = await Promise.all([
            DailyFacts.find({ day: { $gte: factsFrom } })
                .select(
                    'userId day learningActions studySeconds creditsSpent aiCostUsd lastTestScore'
                )
                .lean<
                    Array<
                        Omit<FactRow, 'userId'> & {
                            userId: { toString(): string };
                        }
                    >
                >(),
            User.find({ createdAt: { $gte: fromDate } })
                .select('_id createdAt')
                .lean<
                    Array<{ _id: { toString(): string }; createdAt: Date }>
                >(),
            Payment.find({
                type: TransactionType.PURCHASE,
                status: PaymentStatus.SUCCEEDED,
                createdAt: { $gte: fromDate },
            })
                .select('user amount tokens')
                .lean<
                    Array<{
                        user: { toString(): string };
                        amount?: number;
                        tokens?: number;
                    }>
                >(),
        ]);

        const rows: FactRow[] = facts.map((f) => ({
            ...f,
            userId: f.userId.toString(),
        }));
        const inWindow = rows.filter((r) => r.day >= from);
        const active = activeDaysByUser(rows);
        const signups: SignupRow[] = users.map((u) => ({
            userId: u._id.toString(),
            day: localDayHour(u.createdAt).day,
        }));
        const usdToVnd = Number(process.env.RECSYS_USD_VND ?? 25_000);

        return {
            window: { from, to: today, days: windowDays },
            users: activeUserCounts(rows, today),
            activation7d: activationRate(signups, active, today, 7),
            retention: {
                d1: dayNRetention(signups, active, today, 1),
                d7: dayNRetention(signups, active, today, 7),
                d30: dayNRetention(signups, active, today, 30),
            },
            studyTime: studyTime(inWindow),
            scoreGain: scoreGain(
                rows.filter((r) => r.day >= addDays(today, -56))
            ), // 8-week horizon
            unitEconomics: unitEconomics(inWindow, {
                usdToVnd,
                purchases: purchases.map((p) => ({
                    userId: p.user.toString(),
                    amountVnd: p.amount ?? 0,
                    credits: p.tokens ?? 0,
                })),
            }),
        };
    }

    /** Recommendation experiment read-out by variant (consenting users only). */
    async experiments(opts: { windowDays?: number; now?: Date } = {}) {
        const now = opts.now ?? new Date();
        const since = new Date(
            now.getTime() -
                Math.min(MAX_WINDOW_DAYS, opts.windowDays ?? 14) * 86_400_000
        );
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
        return experimentReadout(
            imps.map((i) => ({
                variant: i._id.v,
                mode: i._id.m,
                impressions: i.impressions,
                users: i.users.length,
                clicks: get(i._id.v, i._id.m, 'rec_click'),
                completes: get(i._id.v, i._id.m, 'rec_complete'),
                dismisses: get(i._id.v, i._id.m, 'rec_dismiss'),
            }))
        );
    }
}

export const kpiService = new KpiService();
