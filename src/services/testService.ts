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

        // If no parts are passed → return the entire test
        if (!partNumbers || partNumbers.length === 0) {
            const test = await db
                .collection('tests')
                .findOne({ _id: objectId });
            if (!test) {
                throw new ApiError(ErrorMessage.TEST_NOT_FOUND);
            }
            return test;
        }

        // If parts are provided → filter within the parts array
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
                    questions?: Array<{
                        _id: ObjectId;
                        [key: string]: unknown;
                    }>;
                    questionGroups?: Array<{
                        questions: Array<{
                            _id: ObjectId;
                            [key: string]: unknown;
                        }>;
                        groupContext?: Record<string, unknown>;
                    }>;
                }) => {
                    const existingPartData = foundParts.get(part.partName) || {
                        partName: part.partName,
                        questions: [],
                        questionGroups: [],
                    };

                    let hasMatchingQuestionsInCurrentPart = false;

                    // Check individual questions (Parts 1, 2, 5)
                    if (part.questions) {
                        const matchingQuestions = part.questions.filter((q) =>
                            objectIds.some((id) => id.equals(q._id))
                        );
                        if (matchingQuestions.length > 0) {
                            // Add the found questions to the questions array of existingPartData
                            existingPartData.questions.push(
                                ...matchingQuestions
                            );
                            hasMatchingQuestionsInCurrentPart = true;
                        }
                    }

                    // Check question groups (Parts 3, 4, 6, 7)
                    if (part.questionGroups) {
                        part.questionGroups.forEach((group) => {
                            const hasMatchingQuestionInGroup =
                                group.questions?.some((q) =>
                                    objectIds.some((id) => id.equals(q._id))
                                );
                            if (hasMatchingQuestionInGroup) {
                                // Add the entire group to the questionGroups array of existingPartData
                                existingPartData.questionGroups.push({
                                    groupContext: group.groupContext || {},
                                    questions: group.questions,
                                });
                                hasMatchingQuestionsInCurrentPart = true;
                            }
                        });
                    }

                    // If this part (from the current test) contains matching questions, update the Map with the merged data.
                    if (hasMatchingQuestionsInCurrentPart) {
                        foundParts.set(part.partName, existingPartData);
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
                    } else {
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

    private normalizeSkills(skills: string[]): string[] {
        const normalized = new Set<string>();
        for (const skill of skills) {
            normalized.add(skill);
            // Convert snake_case to camelCase
            if (skill.includes('_')) {
                const camel = skill.replace(/_([a-z0-9])/gi, (_, g) =>
                    g.toUpperCase()
                );
                normalized.add(camel);
            }
            // Convert camelCase to snake_case
            const snake = skill.replace(
                /[A-Z0-9]/g,
                (letter) => `_${letter.toLowerCase()}`
            );
            normalized.add(snake);
        }
        return Array.from(normalized);
    }

    /**
     * Search and return an array of random question IDs based on skill or domain.
     * @param criteria - Search criteria
     * @param criteria.skills - Array of skills to search for
     * @param criteria.domains - Array of domains to search for
     * @param criteria.parts - Array of TOEIC part numbers (as strings, e.g. "5") to restrict the search to
     * @param limit - Maximum number of question IDs to return
     * @returns An array of ObjectIds of questions
     */
    public async findRandomQuestionIds(
        criteria: { skills?: string[]; domains?: string[]; parts?: string[] },
        limit: number = 10
    ): Promise<string[]> {
        const { skills = [], domains = [], parts = [] } = criteria;

        if (skills.length === 0 && domains.length === 0) {
            return [];
        }

        try {
            const db = await this.getDb();
            const collection = db.collection('tests');

            const orConditions: Record<string, unknown>[] = [];
            if (skills.length > 0) {
                const normalizedSkills = this.normalizeSkills(skills);
                const skillsQuery = { $in: normalizedSkills };
                orConditions.push(
                    { 'skillTags.skills': skillsQuery },
                    { 'skillTags.questionForm': skillsQuery },
                    { 'skillTags.questionFunction': skillsQuery },
                    { 'skillTags.question_function': skillsQuery },
                    { 'skillTags.skillCategory': skillsQuery },
                    { 'skillTags.skillDetail': skillsQuery },
                    { 'skillTags.grammarPoint': skillsQuery },
                    { 'skillTags.vocabPoint': skillsQuery },
                    { 'skillTags.tagType': skillsQuery }
                );
            }
            if (domains.length > 0) {
                orConditions.push({ 'contentTags.domain': { $in: domains } });
            }

            const pipeline: Record<string, unknown>[] = [
                { $unwind: '$parts' },
                {
                    $project: {
                        questionsList: {
                            $ifNull: [
                                '$parts.questions',
                                '$parts.questionGroups.questions',
                            ],
                        },
                    },
                },
                { $unwind: '$questionsList' },
                {
                    $unwind: {
                        path: '$questionsList',
                        preserveNullAndEmptyArrays: true,
                    },
                },
                { $replaceRoot: { newRoot: '$questionsList' } },
                { $match: { _id: { $exists: true } } },
                { $match: { $or: orConditions } },
            ];

            if (parts.length > 0) {
                pipeline.push({ $match: { 'skillTags.part': { $in: parts } } });
            }

            pipeline.push(
                // Some tests contain the same question _id more than once
                // (e.g. duplicated part/question-group entries from data
                // imports), which would otherwise let $sample pick — and
                // this function return — the same question id twice.
                { $group: { _id: '$_id' } },
                { $sample: { size: limit } }
            );

            const results = await collection.aggregate(pipeline).toArray();
            return results.map((doc) => doc._id.toString());
        } catch (error) {
            console.error('Error finding random question IDs:', error);
            return [];
        }
    }
}

export default new TestService();
