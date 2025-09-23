import mongoose from 'mongoose';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

class SpeakingWritingService {
    private async getDb() {
        if (mongoose.connection.readyState !== 1) {
            throw new ApiError(ErrorMessage.INTERNAL_ERROR);
        }
        return mongoose.connection.db!;
    }

    public async getAllTests(query: Record<string, unknown> = {}) {
        const db = await this.getDb();
        const tests = await db
            .collection('sw_tests')
            .find(query, {
                projection: {
                    testId: 1,
                    testTitle: 1,
                    type: 1,
                    number_of_parts: 1,
                    number_of_questions: 1,
                    duration: 1,
                    _id: 0,
                },
            })
            .toArray();
        return tests;
    }

    public async getTestById(testId: string) {
        const db = await this.getDb();
        const test = await db
            .collection('sw_tests')
            .findOne({ testId: parseInt(testId) });
        return test;
    }

    public async getTestByPart(testId: number | string, partNumber: number) {
        const db = await this.getDb();
        // Ensure testId is number
        const testIdNum =
            typeof testId === 'string' ? parseInt(testId) : testId;
        // Find the test and filter the part by offset
        const result = await db
            .collection('sw_tests')
            .aggregate([
                { $match: { testId: testIdNum } },
                {
                    $project: {
                        _id: 0,
                        testId: 1,
                        testTitle: 1,
                        type: 1,
                        part: {
                            $filter: {
                                input: '$parts',
                                as: 'part',
                                cond: { $eq: ['$$part.offset', partNumber] },
                            },
                        },
                    },
                },
            ])
            .toArray();

        if (result.length === 0) {
            return null;
        }
        const test = result[0];
        if (!test.part || test.part.length === 0) {
            return null; // Part not found
        }

        return test;
    }
}

export default new SpeakingWritingService();
