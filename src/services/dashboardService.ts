import { User } from '~/models/userModel.js';
import { TestResult } from '~/models/testResultModel.js';
import { Payment } from '~/models/payment.js';
import { Resource } from '~/models/resource.js';

class DashboardService {
    private buildDateMatch(from?: string, to?: string) {
        const match: Record<string, unknown> = {};

        if (from) {
            const start = new Date(from);
            start.setHours(0, 0, 0, 0);
            match.$gte = start;
        }

        if (to) {
            const end = new Date(to);
            end.setHours(23, 59, 59, 999);
            match.$lte = end;
        }

        return Object.keys(match).length > 0
            ? { $match: { createdAt: match } }
            : { $match: {} };
    }

    private groupBy(by: string) {
        if (by === 'month') {
            return {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' },
                    },
                    count: { $sum: 1 },
                },
            };
        }
        return {
            $group: {
                _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                    day: { $dayOfMonth: '$createdAt' },
                },
                count: { $sum: 1 },
            },
        };
    }

    public async getUserStats(from: string, to: string, by: string) {
        const dateMatch = this.buildDateMatch(from, to);

        const totalUsers = await User.countDocuments(dateMatch.$match);
        const timeline = await User.aggregate([
            dateMatch,
            this.groupBy(by),
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
            {
                $project: {
                    _id: 0,
                    date: '$_id', // đổi tên _id thành date
                    count: 1,
                },
            },
        ]);

        return { totalUsers, timeline };
    }

    public async getTestStats(from: string, to: string, by: string) {
        const dateMatch = this.buildDateMatch(from, to);
        const totalTests = await TestResult.countDocuments(dateMatch.$match);
        const timeline = await TestResult.aggregate([
            dateMatch,
            this.groupBy(by),
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
            {
                $project: {
                    _id: 0,
                    date: '$_id', // đổi tên _id thành date
                    count: 1,
                },
            },
        ]);

        const avgScoreByType = await TestResult.aggregate([
            dateMatch,
            {
                $group: {
                    _id: '$testType',
                    avgScore: { $avg: '$score' },
                    count: { $sum: 1 },
                },
            },
        ]);

        // Top user theo điểm cao nhất
        const topUsers = await TestResult.aggregate([
            dateMatch,
            {
                $group: {
                    //nhom theo userID
                    _id: '$userId',
                    highestScore: { $max: '$score' },
                    totalTests: { $sum: 1 },
                },
            },
            { $sort: { highestScore: -1 } },
            { $limit: 5 },
            {
                $lookup: {
                    //Join user
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'userInfo', //lưu vào
                },
            },
            { $unwind: '$userInfo' },
            {
                $project: {
                    //chọn các field trả về
                    _id: 0,
                    userId: '$_id',
                    highestScore: 1,
                    totalTests: 1,
                    fullName: '$userInfo.fullName',
                    email: '$userInfo.email',
                    address: '$userInfo.address',
                    image: '$userInfo.image',
                },
            },
        ]);

        return { totalTests, timeline, avgScoreByType, topUsers };
    }

    public async getPaymentStats(from: string, to: string, by: string) {
        const dateMatch = this.buildDateMatch(from, to);

        const overallStats = await Payment.aggregate([
            dateMatch,
            {
                $group: {
                    _id: null,
                    totalPayments: { $sum: 1 },
                    successfulPayments: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'SUCCEEDED'] }, 1, 0],
                        },
                    },
                    totalCreditsSold: {
                        $sum: {
                            $cond: [
                                { $eq: ['$status', 'SUCCEEDED'] },
                                '$tokens',
                                0,
                            ],
                        },
                    },
                },
            },
        ]);

        const stats = overallStats[0] || {
            totalPayments: 0,
            successfulPayments: 0,
            totalCreditsSold: 0,
        };

        const byGateway = await Payment.aggregate([
            dateMatch,
            { $match: { status: 'SUCCEEDED' } },
            {
                $group: {
                    _id: '$paymentGateway',
                    count: { $sum: 1 },
                    credits: { $sum: '$tokens' },
                },
            },
            {
                $project: {
                    _id: 0,
                    gateway: '$_id',
                    count: 1,
                    credits: 1,
                },
            },
        ]);

        const idExpr =
            by === 'month'
                ? {
                      year: { $year: '$createdAt' },
                      month: { $month: '$createdAt' },
                  }
                : {
                      year: { $year: '$createdAt' },
                      month: { $month: '$createdAt' },
                      day: { $dayOfMonth: '$createdAt' },
                  };

        const timeline = await Payment.aggregate([
            dateMatch,
            { $match: { status: 'SUCCEEDED' } },
            {
                $group: {
                    _id: idExpr,
                    creditsSold: { $sum: '$tokens' },
                    successfulOrders: { $sum: 1 },
                },
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
            {
                $project: {
                    _id: 0,
                    date: '$_id',
                    creditsSold: 1,
                    successfulOrders: 1,
                },
            },
        ]);

        return {
            totalPayments: stats.totalPayments,
            successfulPayments: stats.successfulPayments,
            totalCreditsSold: stats.totalCreditsSold,
            byGateway,
            timeline,
        };
    }

    public async getResourceStats() {
        const totalResources = await Resource.countDocuments();
        const approved = await Resource.countDocuments({ approved: true });
        const notApproved = await Resource.countDocuments({ approved: false });

        // Thống kê theo domain, sort giảm dần theo count
        const byDomain = await Resource.aggregate([
            {
                $group: {
                    _id: '$labels.domain',
                    total: { $sum: 1 },
                    approvedCount: {
                        $sum: { $cond: [{ $eq: ['$approved', true] }, 1, 0] },
                    },
                    notApprovedCount: {
                        $sum: { $cond: [{ $eq: ['$approved', false] }, 1, 0] },
                    },
                },
            },
            { $sort: { count: -1 } },
            {
                $project: {
                    _id: 0,
                    domain: '$_id',
                    total: 1,
                    approvedCount: 1,
                    notApprovedCount: 1,
                },
            },
        ]);

        return { totalResources, approved, notApproved, byDomain };
    }
}

export default new DashboardService();
