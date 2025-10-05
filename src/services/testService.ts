import mongoose from 'mongoose';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

class TestService {
    private async getDb() {
        if (mongoose.connection.readyState !== 1) {
            throw new ApiError(ErrorMessage.INTERNAL_ERROR);
        }
        return mongoose.connection.db!;
    }

    public async getAllTests() {
        const db = await this.getDb();
        const tests = await db
            .collection('tests')
            .find(
                {},
                {
                    projection: {
                        _id: 1,
                        testTitle: 1,
                        type: 1,
                        number_of_parts: 1,
                        number_of_questions: 1,
                        duration: 1,
                    },
                }
            )
            .sort({ testTitle: 1 }) // Sort by title ascending
            .toArray();

        return Array.isArray(tests) ? tests : [];
    }

    public async getTestById(testId: string) {
        const db = await this.getDb();
        // Try to query by _id as ObjectId
        const queries: Array<Record<string, unknown>> = [];
        try {
            if (mongoose.Types.ObjectId.isValid(testId)) {
                queries.push({ _id: new mongoose.Types.ObjectId(testId) });
            }
        } catch {
            // ignore invalid ObjectId creation errors
        }
        if (/^\d+$/.test(testId)) {
            queries.push({ _id: parseInt(testId, 10) });
        }
        queries.push({ _id: testId });

        let found: Record<string, unknown> | null = null;
        for (const q of queries) {
            found = (await db.collection('tests').findOne(q)) as Record<
                string,
                unknown
            > | null;
            if (found) break;
        }

        return found;
    }

    public async getTestByPart(testId: string, partNumber: number) {
        const db = await this.getDb();

        // Build $match conditions to handle different stored id types
        const matchConditions: Array<Record<string, unknown>> = [];
        try {
            if (mongoose.Types.ObjectId.isValid(testId)) {
                matchConditions.push({
                    _id: new mongoose.Types.ObjectId(testId),
                });
            }
        } catch {
            // ignore invalid ObjectId creation errors
        }
        if (/^\d+$/.test(testId)) {
            matchConditions.push({ _id: parseInt(testId, 10) });
        }
        matchConditions.push({ _id: testId });

        const result = await db
            .collection('tests')
            .aggregate([
                { $match: { $or: matchConditions } },
                {
                    $project: {
                        _id: 1,
                        testTitle: 1,
                        type: 1,
                        parts: {
                            $filter: {
                                input: '$parts',
                                as: 'part',
                                cond: {
                                    $eq: [
                                        '$$part.partName',
                                        `Part ${partNumber}`,
                                    ],
                                },
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
        if (test.parts.length === 0) {
            return null; // Part not found
        }

        return test;
    }
}

export default new TestService();
