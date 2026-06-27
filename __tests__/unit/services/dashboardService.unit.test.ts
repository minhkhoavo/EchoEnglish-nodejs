/* eslint-disable @typescript-eslint/no-explicit-any */
import dashboardService from '~/services/dashboardService.js';
import { User } from '~/models/userModel.js';
import { TestResult } from '~/models/testResultModel.js';
import { Payment } from '~/models/payment.js';
import { Resource } from '~/models/resource.js';

// ──────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────
jest.mock('~/models/userModel.js', () => ({
    User: {
        countDocuments: jest.fn(),
        aggregate: jest.fn(),
    },
}));

jest.mock('~/models/testResultModel.js', () => ({
    TestResult: {
        countDocuments: jest.fn(),
        aggregate: jest.fn(),
    },
}));

jest.mock('~/models/payment.js', () => ({
    Payment: {
        aggregate: jest.fn(),
    },
}));

jest.mock('~/models/resource.js', () => ({
    Resource: {
        countDocuments: jest.fn(),
        aggregate: jest.fn(),
    },
}));

const mockedUser = User as jest.Mocked<typeof User>;
const mockedTestResult = TestResult as jest.Mocked<typeof TestResult>;
const mockedPayment = Payment as jest.Mocked<typeof Payment>;
const mockedResource = Resource as jest.Mocked<typeof Resource>;

describe('DashboardService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ════════════════════════════════════════════
    // buildDateMatch & groupBy (Helper Verification through public methods)
    // ════════════════════════════════════════════
    describe('buildDateMatch Helper logic', () => {
        it('should handle undefined from and to dates by matching everything', async () => {
            (mockedUser.countDocuments as any).mockResolvedValue(10);
            (mockedUser.aggregate as any).mockResolvedValue([]);

            await dashboardService.getUserStats(
                undefined as any,
                undefined as any,
                'day'
            );

            expect(mockedUser.countDocuments).toHaveBeenCalledWith({});
            expect(mockedUser.aggregate).toHaveBeenCalledWith(
                expect.arrayContaining([{ $match: {} }])
            );
        });

        it('should handle only from date by checking boundary (start of day)', async () => {
            (mockedUser.countDocuments as any).mockResolvedValue(10);
            (mockedUser.aggregate as any).mockResolvedValue([]);

            const fromDateStr = '2026-06-15';
            const expectedStart = new Date(fromDateStr);
            expectedStart.setHours(0, 0, 0, 0);

            await dashboardService.getUserStats(
                fromDateStr,
                undefined as any,
                'day'
            );

            expect(mockedUser.countDocuments).toHaveBeenCalledWith({
                createdAt: { $gte: expectedStart },
            });
        });

        it('should handle only to date by checking boundary (end of day)', async () => {
            (mockedUser.countDocuments as any).mockResolvedValue(10);
            (mockedUser.aggregate as any).mockResolvedValue([]);

            const toDateStr = '2026-06-15';
            const expectedEnd = new Date(toDateStr);
            expectedEnd.setHours(23, 59, 59, 999);

            await dashboardService.getUserStats(
                undefined as any,
                toDateStr,
                'day'
            );

            expect(mockedUser.countDocuments).toHaveBeenCalledWith({
                createdAt: { $lte: expectedEnd },
            });
        });

        it('should handle both from and to dates correctly', async () => {
            (mockedUser.countDocuments as any).mockResolvedValue(10);
            (mockedUser.aggregate as any).mockResolvedValue([]);

            const fromDateStr = '2026-06-15';
            const toDateStr = '2026-06-16';
            const expectedStart = new Date(fromDateStr);
            expectedStart.setHours(0, 0, 0, 0);
            const expectedEnd = new Date(toDateStr);
            expectedEnd.setHours(23, 59, 59, 999);

            await dashboardService.getUserStats(fromDateStr, toDateStr, 'day');

            expect(mockedUser.countDocuments).toHaveBeenCalledWith({
                createdAt: {
                    $gte: expectedStart,
                    $lte: expectedEnd,
                },
            });
        });
    });

    describe('groupBy Helper logic', () => {
        it('should group by year and month when by is "month"', async () => {
            (mockedUser.countDocuments as any).mockResolvedValue(10);
            (mockedUser.aggregate as any).mockResolvedValue([]);

            await dashboardService.getUserStats(
                undefined as any,
                undefined as any,
                'month'
            );

            const aggregatePipeline = mockedUser.aggregate.mock.calls[0][0];
            const groupStage = aggregatePipeline.find(
                (stage: any) => stage.$group
            ) as any;
            expect(groupStage).toBeDefined();
            expect(groupStage.$group._id).toEqual({
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
            });
        });

        it('should group by year, month, and day when by is "day"', async () => {
            (mockedUser.countDocuments as any).mockResolvedValue(10);
            (mockedUser.aggregate as any).mockResolvedValue([]);

            await dashboardService.getUserStats(
                undefined as any,
                undefined as any,
                'day'
            );

            const aggregatePipeline = mockedUser.aggregate.mock.calls[0][0];
            const groupStage = aggregatePipeline.find(
                (stage: any) => stage.$group
            ) as any;
            expect(groupStage).toBeDefined();
            expect(groupStage.$group._id).toEqual({
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' },
            });
        });
    });

    // ════════════════════════════════════════════
    // getUserStats()
    // ════════════════════════════════════════════
    describe('getUserStats', () => {
        it('should retrieve user count and monthly timeline statistics successfully', async () => {
            (mockedUser.countDocuments as any).mockResolvedValue(100);
            (mockedUser.aggregate as any).mockResolvedValue([
                { count: 10, date: { year: 2026, month: 6 } },
            ]);

            const result = await dashboardService.getUserStats(
                '2026-06-01',
                '2026-06-30',
                'month'
            );

            expect(mockedUser.countDocuments).toHaveBeenCalledTimes(1);
            expect(mockedUser.aggregate).toHaveBeenCalledTimes(1);
            expect(result).toEqual({
                totalUsers: 100,
                timeline: [{ count: 10, date: { year: 2026, month: 6 } }],
            });
        });
    });

    // ════════════════════════════════════════════
    // getTestStats()
    // ════════════════════════════════════════════
    describe('getTestStats', () => {
        beforeEach(() => {
            // Mock implementations to isolate the multiple aggregates called in getTestStats
            (mockedTestResult.aggregate as any).mockImplementation(
                (pipeline: any) => {
                    // 1. Check if it is timeline aggregate (uses groupBy result and project to date: '$_id')
                    if (
                        pipeline.some(
                            (stage: any) =>
                                stage.$project && stage.$project.date === '$_id'
                        )
                    ) {
                        return Promise.resolve([
                            {
                                count: 15,
                                date: { year: 2026, month: 6, day: 15 },
                            },
                        ]);
                    }
                    // 2. Check if it is avgScoreByType aggregate (groups by '$testType')
                    if (
                        pipeline.some(
                            (stage: any) =>
                                stage.$group && stage.$group._id === '$testType'
                        )
                    ) {
                        return Promise.resolve([
                            {
                                _id: 'listening-reading',
                                avgScore: 450.5,
                                count: 10,
                            },
                        ]);
                    }
                    // 3. Check if it is topUsers aggregate (contains $lookup to users)
                    if (
                        pipeline.some(
                            (stage: any) =>
                                stage.$lookup && stage.$lookup.from === 'users'
                        )
                    ) {
                        return Promise.resolve([
                            {
                                userId: 'user-123',
                                highestScore: 990,
                                totalTests: 5,
                                fullName: 'Nguyen Van A',
                                email: 'a@example.com',
                                address: 'Hanoi',
                                image: 'avatar.png',
                            },
                        ]);
                    }
                    return Promise.resolve([]);
                }
            );
        });

        it('should retrieve test metrics including timeline, average score by type and top users', async () => {
            (mockedTestResult.countDocuments as any).mockResolvedValue(50);

            const result = await dashboardService.getTestStats(
                '2026-06-01',
                '2026-06-30',
                'day'
            );

            expect(mockedTestResult.countDocuments).toHaveBeenCalledTimes(1);
            expect(mockedTestResult.aggregate).toHaveBeenCalledTimes(3);
            expect(result).toEqual({
                totalTests: 50,
                timeline: [
                    { count: 15, date: { year: 2026, month: 6, day: 15 } },
                ],
                avgScoreByType: [
                    { _id: 'listening-reading', avgScore: 450.5, count: 10 },
                ],
                topUsers: [
                    {
                        userId: 'user-123',
                        highestScore: 990,
                        totalTests: 5,
                        fullName: 'Nguyen Van A',
                        email: 'a@example.com',
                        address: 'Hanoi',
                        image: 'avatar.png',
                    },
                ],
            });
        });
    });

    // ════════════════════════════════════════════
    // getPaymentStats()
    // ════════════════════════════════════════════
    describe('getPaymentStats', () => {
        it('should compute payment statistics correctly when overall stats exist', async () => {
            (mockedPayment.aggregate as any).mockImplementation(
                (pipeline: any) => {
                    // 1. Overall stats (group by null)
                    if (
                        pipeline.some(
                            (stage: any) =>
                                stage.$group && stage.$group._id === null
                        )
                    ) {
                        return Promise.resolve([
                            {
                                totalPayments: 20,
                                successfulPayments: 18,
                                totalCreditsSold: 1800,
                            },
                        ]);
                    }
                    // 2. By gateway (match SUCCEEDED and group by $paymentGateway)
                    if (
                        pipeline.some(
                            (stage: any) =>
                                stage.$group &&
                                stage.$group._id === '$paymentGateway'
                        )
                    ) {
                        return Promise.resolve([
                            { gateway: 'VNPAY', count: 10, credits: 1000 },
                            { gateway: 'STRIPE', count: 8, credits: 800 },
                        ]);
                    }
                    // 3. Timeline
                    return Promise.resolve([
                        {
                            date: { year: 2026, month: 6 },
                            creditsSold: 1800,
                            successfulOrders: 18,
                        },
                    ]);
                }
            );

            const result = await dashboardService.getPaymentStats(
                '2026-06-01',
                '2026-06-30',
                'month'
            );

            expect(mockedPayment.aggregate).toHaveBeenCalledTimes(3);
            expect(result).toEqual({
                totalPayments: 20,
                successfulPayments: 18,
                totalCreditsSold: 1800,
                byGateway: [
                    { gateway: 'VNPAY', count: 10, credits: 1000 },
                    { gateway: 'STRIPE', count: 8, credits: 800 },
                ],
                timeline: [
                    {
                        date: { year: 2026, month: 6 },
                        creditsSold: 1800,
                        successfulOrders: 18,
                    },
                ],
            });

            // Verify timeline query groups by year and month
            const timelineAggregate = mockedPayment.aggregate.mock.calls[2][0];
            const groupStage = timelineAggregate.find(
                (stage: any) => stage.$group
            ) as any;
            expect(groupStage).toBeDefined();
            expect(groupStage.$group._id).toEqual({
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
            });
        });

        it('should fall back to zeroed overall stats if overall stats aggregate returns empty list', async () => {
            (mockedPayment.aggregate as any).mockImplementation(
                (pipeline: any) => {
                    // 1. Overall stats (group by null) -> empty list
                    if (
                        pipeline.some(
                            (stage: any) =>
                                stage.$group && stage.$group._id === null
                        )
                    ) {
                        return Promise.resolve([]);
                    }
                    // 2. By gateway
                    if (
                        pipeline.some(
                            (stage: any) =>
                                stage.$group &&
                                stage.$group._id === '$paymentGateway'
                        )
                    ) {
                        return Promise.resolve([]);
                    }
                    // 3. Timeline
                    return Promise.resolve([]);
                }
            );

            const result = await dashboardService.getPaymentStats(
                '2026-06-01',
                '2026-06-30',
                'day'
            );

            expect(result.totalPayments).toBe(0);
            expect(result.successfulPayments).toBe(0);
            expect(result.totalCreditsSold).toBe(0);
            expect(result.byGateway).toEqual([]);
            expect(result.timeline).toEqual([]);

            // Verify timeline query groups by year, month, and day (when by !== 'month')
            const timelineAggregate = mockedPayment.aggregate.mock.calls[2][0];
            const groupStage = timelineAggregate.find(
                (stage: any) => stage.$group
            ) as any;
            expect(groupStage).toBeDefined();
            expect(groupStage.$group._id).toEqual({
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' },
            });
        });
    });

    // ════════════════════════════════════════════
    // getResourceStats()
    // ════════════════════════════════════════════
    describe('getResourceStats', () => {
        it('should count total, suitable and unsuitable resources and aggregate by domain', async () => {
            (mockedResource.countDocuments as any).mockImplementation(
                (query: any) => {
                    if (!query) return Promise.resolve(40);
                    if (query.suitableForLearners === true)
                        return Promise.resolve(25);
                    if (query.suitableForLearners === false)
                        return Promise.resolve(15);
                    return Promise.resolve(0);
                }
            );

            (mockedResource.aggregate as any).mockResolvedValue([
                {
                    domain: 'IELTS',
                    total: 30,
                    suitableForLearnersCount: 20,
                    notSuitableForLearnersCount: 10,
                },
                {
                    domain: 'TOEIC',
                    total: 10,
                    suitableForLearnersCount: 5,
                    notSuitableForLearnersCount: 5,
                },
            ]);

            const result = await dashboardService.getResourceStats();

            expect(mockedResource.countDocuments).toHaveBeenCalledTimes(3);
            expect(mockedResource.countDocuments).toHaveBeenNthCalledWith(1);
            expect(mockedResource.countDocuments).toHaveBeenNthCalledWith(2, {
                suitableForLearners: true,
            });
            expect(mockedResource.countDocuments).toHaveBeenNthCalledWith(3, {
                suitableForLearners: false,
            });

            expect(mockedResource.aggregate).toHaveBeenCalledTimes(1);
            expect(mockedResource.aggregate).toHaveBeenCalledWith([
                {
                    $group: {
                        _id: '$labels.domain',
                        total: { $sum: 1 },
                        suitableForLearnersCount: {
                            $sum: {
                                $cond: [
                                    { $eq: ['$suitableForLearners', true] },
                                    1,
                                    0,
                                ],
                            },
                        },
                        notSuitableForLearnersCount: {
                            $sum: {
                                $cond: [
                                    { $eq: ['$suitableForLearners', false] },
                                    1,
                                    0,
                                ],
                            },
                        },
                    },
                },
                { $sort: { total: -1 } },
                {
                    $project: {
                        _id: 0,
                        domain: '$_id',
                        total: 1,
                        suitableForLearnersCount: 1,
                        notSuitableForLearnersCount: 1,
                    },
                },
            ]);

            expect(result).toEqual({
                totalResources: 40,
                suitableForLearners: 25,
                notSuitableForLearners: 15,
                byDomain: [
                    {
                        domain: 'IELTS',
                        total: 30,
                        suitableForLearnersCount: 20,
                        notSuitableForLearnersCount: 10,
                    },
                    {
                        domain: 'TOEIC',
                        total: 10,
                        suitableForLearnersCount: 5,
                        notSuitableForLearnersCount: 5,
                    },
                ],
            });
        });
    });
});
