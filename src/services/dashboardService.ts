import { User } from '~/models/userModel.js';
import { TestResult } from '~/models/testResultModel.js';
import { Payment } from '~/models/payment.js';
import { Resource } from '~/models/resource.js';
import mongoose from 'mongoose';
import dayjs from 'dayjs';

class DashboardService {
    private buildDateMatch(from: string, to: string) {
        return {
            $match: {
                createdAt: {
                    $gte: new Date(from),
                    $lte: new Date(to),
                },
            },
        };
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
        const totalUsers = await User.countDocuments();
        const timeline = await User.aggregate([
            this.buildDateMatch(from, to),
            this.groupBy(by),
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
        ]);

        return { totalUsers, timeline };
    }

    public async getTestStats(from: string, to: string, by: string) {
        const totalTests = await TestResult.countDocuments();
        const timeline = await TestResult.aggregate([
            this.buildDateMatch(from, to),
            this.groupBy(by),
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
        ]);

        const avgScoreByType = await TestResult.aggregate([
            this.buildDateMatch(from, to),
            {
                $group: {
                    _id: '$testType',
                    avgScore: { $avg: '$score' },
                    count: { $sum: 1 },
                },
            },
        ]);

        return { totalTests, timeline, avgScoreByType };
    }

    public async getPaymentStats(from: string, to: string, by: string) {
        const totalPayments = await Payment.countDocuments();
        const timeline = await Payment.aggregate([
            this.buildDateMatch(from, to),
            {
                $group: {
                    _id: this.groupBy(by)._id,
                    totalTokens: { $sum: '$tokens' },
                    totalAmount: { $sum: '$amount' },
                },
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
        ]);

        return { totalPayments, timeline };
    }

    public async getResourceStats(from: string, to: string, by: string) {
        const totalResources = await Resource.countDocuments();
        const approved = await Resource.countDocuments({ approved: true });
        const notApproved = await Resource.countDocuments({ approved: false });

        const timeline = await Resource.aggregate([
            this.buildDateMatch(from, to),
            {
                $group: {
                    _id: { type: '$type', ...this.groupBy(by)._id },
                    count: { $sum: 1 },
                },
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
        ]);

        return { totalResources, approved, notApproved, timeline };
    }
}

export default new DashboardService();
