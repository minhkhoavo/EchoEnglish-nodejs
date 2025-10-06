import mongoose from 'mongoose';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { ObjectId } from 'mongodb';

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

    public async getTestById(testId: string, partNumbers?: number[]) {
        const db = await this.getDb();
        const objectId = new ObjectId(testId);

        // Nếu không truyền parts → trả về toàn bộ test
        if (!partNumbers || partNumbers.length === 0) {
            const test = await db
                .collection('tests')
                .findOne({ _id: objectId });
            if (!test) {
                throw new ApiError(ErrorMessage.TEST_NOT_FOUND);
            }
            return test;
        }

        // Nếu có parts → lọc trong mảng parts
        const testArray = await db
            .collection('tests')
            .aggregate([
                { $match: { _id: objectId } },
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
                                    $in: [
                                        '$$part.partName',
                                        partNumbers.map((n) => `Part ${n}`),
                                    ],
                                },
                            },
                        },
                    },
                },
            ])
            .sort({ partName: 1 })
            .toArray();

        if (testArray.length === 0) {
            throw new ApiError(ErrorMessage.TEST_NOT_FOUND);
        }

        const test = testArray[0];
        if (!test.parts || test.parts.length === 0) {
            throw new ApiError(ErrorMessage.PART_NOT_FOUND);
        }

        return test;
    }
}

export default new TestService();
