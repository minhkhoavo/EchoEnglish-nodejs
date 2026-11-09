import { localDayHour } from '../etl/clean.js';
import { User } from '../../models/userModel.js';
import { Payment } from '../../models/payment.js';
import { TransactionType } from '../../enum/transactionType.js';
import { PaymentStatus } from '../../enum/paymentStatus.js';
import {
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
import {
    AnalyticsSource,
    backendFromEnv,
    clickhouseSource,
    mongoSource,
} from './sources.js';

const MAX_WINDOW_DAYS = 90;

export class KpiService {
    constructor(
        /** Injected for tests; default picks the backend from RECSYS_ANALYTICS_BACKEND. */
        private readonly sourceFor: () => AnalyticsSource = () =>
            backendFromEnv() === 'clickhouse' ? clickhouseSource() : mongoSource
    ) {}

    /**
     * Run against the configured source; if the warehouse is unavailable, answer from Mongo and
     * SAY SO (`backend` + `fallbackReason`) instead of failing or silently mixing backends.
     */
    private async withSource<T>(
        run: (src: AnalyticsSource) => Promise<T>
    ): Promise<T & { backend: string; fallbackReason?: string }> {
        const src = this.sourceFor();
        try {
            return { ...(await run(src)), backend: src.name };
        } catch (err) {
            if (src.name === 'mongo') throw err;
            const fallbackReason = (err as Error).message.slice(0, 200);
            console.error(
                '[recsys] warehouse KPI read failed:',
                fallbackReason
            );
            return {
                ...(await run(mongoSource)),
                backend: 'mongo',
                fallbackReason,
            };
        }
    }

    /**
     * Platform KPI overview for [today-windowDays, today]. Reads only gold facts + users +
     * payments (never raw events) so it stays cheap.
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

        return this.withSource(async (src) => {
            const [rows, users, purchases] = await Promise.all([
                src.facts(factsFrom),
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
            // Users/payments live in Mongo with real ids; map them into the source's key space.
            const keys = await src.keys([
                ...new Set([
                    ...users.map((u) => u._id.toString()),
                    ...purchases.map((p) => p.user.toString()),
                ]),
            ]);
            const key = (id: string) => keys.get(id) ?? id;

            const inWindow = rows.filter((r) => r.day >= from);
            const active = activeDaysByUser(rows);
            const signups: SignupRow[] = users.map((u) => ({
                userId: key(u._id.toString()),
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
                        userId: key(p.user.toString()),
                        amountVnd: p.amount ?? 0,
                        credits: p.tokens ?? 0,
                    })),
                }),
            };
        });
    }

    /** Recommendation experiment read-out by variant × mode (consenting users only). */
    async experiments(opts: { windowDays?: number; now?: Date } = {}) {
        const now = opts.now ?? new Date();
        const since = new Date(
            now.getTime() -
                Math.min(MAX_WINDOW_DAYS, opts.windowDays ?? 14) * 86_400_000
        );
        return this.withSource(async (src) => ({
            variants: experimentReadout(await src.variantRows(since)),
        }));
    }
}

export const kpiService = new KpiService();
