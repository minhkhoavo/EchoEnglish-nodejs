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
        if (!mongoose.Types.ObjectId.isValid(testId)) {
            return null;
        }
        const test = await db
            .collection('sw_tests')
            .findOne({ testId: new mongoose.Types.ObjectId(testId) });
        return test;
    }

    public async getTestByPart(testId: number | string, partNumber: number) {
        const db = await this.getDb();
        if (
            typeof testId === 'string' &&
            !mongoose.Types.ObjectId.isValid(testId)
        )
            return null;
        const matchCond = {
            testId:
                typeof testId === 'string'
                    ? new mongoose.Types.ObjectId(testId)
                    : testId,
        };
        // Find the test and filter the part by offset
        const result = await db
            .collection('sw_tests')
            .aggregate([
                { $match: matchCond },
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
