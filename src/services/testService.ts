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

    public async getQuestionsByIds(questionIds: string[]) {
        const db = await this.getDb();

        // Convert string IDs to ObjectIds
        const objectIds = questionIds.map((id) => {
            try {
                return new ObjectId(id);
            } catch {
                throw new ApiError(ErrorMessage.INVALID_ID);
            }
        });

        if (objectIds.length === 0) {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }

        // Step 1: Find all tests that contain any of the requested question IDs
        const testsWithQuestions = await db
            .collection('tests')
            .find({
                $or: [
                    { 'parts.questions._id': { $in: objectIds } },
                    {
                        'parts.questionGroups.questions._id': {
                            $in: objectIds,
                        },
                    },
                ],
            })
            .toArray();

        // Step 2: Process each test to extract relevant parts and questions
        const foundParts = new Map<
            string,
            {
                partName: string;
                questions: unknown[];
                questionGroups: unknown[];
            }
        >();

        testsWithQuestions.forEach((test) => {
            test.parts?.forEach(
                (part: {
                    partName: string;
                    questions?: Array<{ _id: ObjectId }>;
                    questionGroups?: Array<{
                        questions: Array<{ _id: ObjectId }>;
                        groupContext?: Record<string, unknown>;
                    }>;
                }) => {
                    let hasMatchingQuestions = false;
                    const partData = {
                        partName: part.partName,
                        questions: [] as unknown[],
                        questionGroups: [] as unknown[],
                    };

                    // Check individual questions (Parts 1, 2, 5)
                    if (part.questions) {
                        const matchingQuestions = part.questions.filter((q) =>
                            objectIds.some((id) => id.equals(q._id))
                        );
                        if (matchingQuestions.length > 0) {
                            partData.questions = matchingQuestions;
                            hasMatchingQuestions = true;
                        }
                    }

                    // Check question groups (Parts 3, 4, 6, 7)
                    if (part.questionGroups) {
                        part.questionGroups.forEach((group) => {
                            const hasMatchingQuestion = group.questions?.some(
                                (q) => objectIds.some((id) => id.equals(q._id))
                            );
                            if (hasMatchingQuestion) {
                                // Include the entire group if any question in it matches
                                partData.questionGroups.push({
                                    groupContext: group.groupContext || {},
                                    questions: group.questions || [],
                                });
                                hasMatchingQuestions = true;
                            }
                        });
                    }

                    if (hasMatchingQuestions) {
                        foundParts.set(part.partName, partData);
                    }
                }
            );
        });

        // Step 3: Build response structure
        interface PartResponse {
            partName: string;
            questions?: unknown[];
            questionGroups?: Array<{
                groupContext: Record<string, unknown>;
                questions: unknown[];
            }>;
        }

        const response = {
            title: 'Practice Test',
            parts: Array.from(foundParts.values())
                .map((part) => {
                    const partData: PartResponse = {
                        partName: part.partName,
                    };

                    // Determine structure based on content
                    const hasIndividualQuestions = part.questions.length > 0;
                    const hasQuestionGroups = part.questionGroups.length > 0;

                    if (hasIndividualQuestions && !hasQuestionGroups) {
                        // Parts 1, 2, 5 - individual questions
                        partData.questions = part.questions;
                    } else if (hasQuestionGroups) {
                        // Parts 3, 4, 6, 7 - question groups
                        partData.questionGroups = part.questionGroups as Array<{
                            groupContext: Record<string, unknown>;
                            questions: unknown[];
                        }>;
                    }

                    return partData;
                })
                .sort((a, b) => a.partName.localeCompare(b.partName)),
        };

        return response;
    }
}

export default new TestService();
