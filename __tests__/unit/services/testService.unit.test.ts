/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import testService from '~/services/testService.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

// Mock mongoose
jest.mock('mongoose');
const mockedMongoose = mongoose as jest.Mocked<typeof mongoose>;

describe('TestService', () => {
    let mockDb: any;
    let mockCollection: any;

    beforeEach(() => {
        jest.clearAllMocks();

        mockCollection = {
            find: jest.fn(),
            findOne: jest.fn(),
            aggregate: jest.fn(),
        };

        mockDb = {
            collection: jest.fn().mockReturnValue(mockCollection),
        };

        // Reset default active connection state
        (mockedMongoose.connection as any) = {
            readyState: 1,
            db: mockDb,
        };
    });

    // ──────────────────────────────────────────────
    // getDb Helper / Connection Readiness
    // ──────────────────────────────────────────────
    describe('getDb Connection Guard', () => {
        it('should throw ApiError INTERNAL_ERROR if readyState !== 1', async () => {
            (mockedMongoose.connection as any).readyState = 0; // Disconnected

            await expect(testService.getAllTests()).rejects.toBeInstanceOf(
                ApiError
            );
            await expect(testService.getAllTests()).rejects.toMatchObject({
                status: ErrorMessage.INTERNAL_ERROR.status,
                message: ErrorMessage.INTERNAL_ERROR.message,
            });
        });
    });

    // ──────────────────────────────────────────────
    // getAllTests()
    // ──────────────────────────────────────────────
    describe('getAllTests', () => {
        it('should return list of all tests sorted by testTitle ascending', async () => {
            const mockTests = [
                { _id: new ObjectId(), testTitle: 'A Test' },
                { _id: new ObjectId(), testTitle: 'B Test' },
            ];

            const mockSort = jest.fn().mockReturnThis();
            const mockToArray = jest.fn().mockResolvedValue(mockTests);
            mockCollection.find.mockReturnValue({
                sort: mockSort,
                toArray: mockToArray,
            });

            const result = await testService.getAllTests();

            expect(mockDb.collection).toHaveBeenCalledWith('tests');
            expect(mockCollection.find).toHaveBeenCalledWith(
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
            );
            expect(mockSort).toHaveBeenCalledWith({ testTitle: 1 });
            expect(result).toEqual(mockTests);
        });

        it('should return [] if find results are null or not an array', async () => {
            mockCollection.find.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                toArray: jest.fn().mockResolvedValue(null),
            });

            const result = await testService.getAllTests();
            expect(result).toEqual([]);
        });
    });

    // ──────────────────────────────────────────────
    // getTestById()
    // ──────────────────────────────────────────────
    describe('getTestById', () => {
        const testIdStr = '60f8e8b4e7c8e8b4e7c8e8b4';
        const objectId = new ObjectId(testIdStr);

        describe('without partNumbers filter', () => {
            it('should fetch the entire test using findOne', async () => {
                const mockTestDoc = { _id: objectId, testTitle: 'Full Test' };
                mockCollection.findOne.mockResolvedValue(mockTestDoc);

                const result = await testService.getTestById(testIdStr);

                expect(mockCollection.findOne).toHaveBeenCalledWith({
                    _id: objectId,
                });
                expect(result).toEqual(mockTestDoc);
            });

            it('should throw ApiError TEST_NOT_FOUND if test does not exist', async () => {
                mockCollection.findOne.mockResolvedValue(null);

                await expect(
                    testService.getTestById(testIdStr)
                ).rejects.toBeInstanceOf(ApiError);
                await expect(
                    testService.getTestById(testIdStr)
                ).rejects.toMatchObject({
                    status: ErrorMessage.TEST_NOT_FOUND.status,
                    message: ErrorMessage.TEST_NOT_FOUND.message,
                });
            });
        });

        describe('with partNumbers filter', () => {
            it('should run aggregation pipeline to filter parts and return test', async () => {
                const mockAggregatedTest = {
                    _id: objectId,
                    testTitle: 'Filtered Test',
                    parts: [{ partName: 'Part 1', questions: [] }],
                };

                const mockToArray = jest
                    .fn()
                    .mockResolvedValue([mockAggregatedTest]);
                mockCollection.aggregate.mockReturnValue({
                    sort: jest.fn().mockReturnThis(),
                    toArray: mockToArray,
                });

                const result = await testService.getTestById(testIdStr, [1]);

                expect(mockCollection.aggregate).toHaveBeenCalledWith([
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
                                        $in: ['$$part.partName', ['Part 1']],
                                    },
                                },
                            },
                        },
                    },
                ]);
                expect(result).toEqual(mockAggregatedTest);
            });

            it('should throw ApiError TEST_NOT_FOUND if aggregation returns empty array', async () => {
                mockCollection.aggregate.mockReturnValue({
                    sort: jest.fn().mockReturnThis(),
                    toArray: jest.fn().mockResolvedValue([]),
                });

                await expect(
                    testService.getTestById(testIdStr, [1])
                ).rejects.toBeInstanceOf(ApiError);
                await expect(
                    testService.getTestById(testIdStr, [1])
                ).rejects.toMatchObject({
                    status: ErrorMessage.TEST_NOT_FOUND.status,
                });
            });

            it('should throw ApiError PART_NOT_FOUND if test has no parts property or parts list is empty', async () => {
                const mockTestNoParts = {
                    _id: objectId,
                    testTitle: 'Filtered Test',
                    parts: [],
                };
                mockCollection.aggregate.mockReturnValue({
                    sort: jest.fn().mockReturnThis(),
                    toArray: jest.fn().mockResolvedValue([mockTestNoParts]),
                });

                await expect(
                    testService.getTestById(testIdStr, [1])
                ).rejects.toBeInstanceOf(ApiError);
                await expect(
                    testService.getTestById(testIdStr, [1])
                ).rejects.toMatchObject({
                    status: ErrorMessage.PART_NOT_FOUND.status,
                    message: ErrorMessage.PART_NOT_FOUND.message,
                });
            });
        });
    });

    // ──────────────────────────────────────────────
    // getQuestionsByIds()
    // ──────────────────────────────────────────────
    describe('getQuestionsByIds', () => {
        it('should throw ApiError INVALID_INPUT if questionIds is empty', async () => {
            await expect(
                testService.getQuestionsByIds([])
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                testService.getQuestionsByIds([])
            ).rejects.toMatchObject({
                status: ErrorMessage.INVALID_INPUT.status,
            });
        });

        it('should throw ApiError INVALID_ID if any ID string is invalid', async () => {
            await expect(
                testService.getQuestionsByIds([
                    'invalid-hex',
                    '60f8e8b4e7c8e8b4e7c8e8b4',
                ])
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                testService.getQuestionsByIds([
                    'invalid-hex',
                    '60f8e8b4e7c8e8b4e7c8e8b4',
                ])
            ).rejects.toMatchObject({
                status: ErrorMessage.INVALID_ID.status,
            });
        });

        it('should extract individual questions (Parts 1, 2, 5) and groups (Parts 3, 4, 6, 7), merging and sorting parts', async () => {
            const qId1 = new ObjectId();
            const qId2 = new ObjectId();
            const qId3 = new ObjectId();

            const mockTest1 = {
                title: 'Test Doc 1',
                parts: [
                    {
                        partName: 'Part 1',
                        questions: [
                            {
                                _id: new ObjectId(),
                                content: 'Non matching Q in Part 1',
                            },
                        ],
                    },
                    {
                        partName: 'Part 5',
                        questions: [
                            { _id: qId1, content: 'Q1 content' },
                            { _id: new ObjectId(), content: 'Q Other' },
                        ],
                    },
                    {
                        partName: 'Part 3',
                        questionGroups: [
                            {
                                groupContext: { passage: 'Context 1' },
                                questions: [
                                    { _id: qId2, content: 'Q2 content' },
                                ],
                            },
                            {
                                questions: [
                                    {
                                        _id: new ObjectId(),
                                        content: 'Q Other Group',
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        partName: 'Part 6',
                        questions: [
                            {
                                _id: new ObjectId(),
                                content: 'Part6 Q1 non matching',
                            },
                        ],
                        questionGroups: [
                            {
                                questions: [
                                    { _id: qId2, content: 'Part6 Q2 Group' },
                                ],
                            },
                        ],
                    },
                ],
            };

            const mockTest2 = {
                title: 'Test Doc 2',
                parts: [
                    {
                        partName: 'Part 5',
                        questions: [{ _id: qId3, content: 'Q3 content' }],
                    },
                ],
            };

            mockCollection.find.mockReturnValue({
                toArray: jest.fn().mockResolvedValue([mockTest1, mockTest2]),
            });

            const result = await testService.getQuestionsByIds([
                qId1.toString(),
                qId2.toString(),
                qId3.toString(),
            ]);

            expect(mockCollection.find).toHaveBeenCalledWith({
                $or: [
                    { 'parts.questions._id': { $in: [qId1, qId2, qId3] } },
                    {
                        'parts.questionGroups.questions._id': {
                            $in: [qId1, qId2, qId3],
                        },
                    },
                ],
            });

            // Verification of title and structure
            expect(result.title).toBe('Practice Test');
            expect(result.parts).toHaveLength(3);

            // Verified alphabetic sorting: Part 3, Part 5, Part 6
            expect(result.parts[0].partName).toBe('Part 3');
            expect(result.parts[1].partName).toBe('Part 5');
            expect(result.parts[2].partName).toBe('Part 6');

            // QuestionGroups assertion
            expect(result.parts[0]).toEqual({
                partName: 'Part 3',
                questionGroups: [
                    {
                        groupContext: { passage: 'Context 1' },
                        questions: [{ _id: qId2, content: 'Q2 content' }],
                    },
                ],
            });

            // Individual Questions assertion (merged from Test1 and Test2)
            expect(result.parts[1]).toEqual({
                partName: 'Part 5',
                questions: [
                    { _id: qId1, content: 'Q1 content' },
                    { _id: qId3, content: 'Q3 content' },
                ],
            });

            // Part containing both questions and groups (should return only groups)
            expect(result.parts[2]).toEqual({
                partName: 'Part 6',
                questionGroups: [
                    {
                        groupContext: {},
                        questions: [{ _id: qId2, content: 'Part6 Q2 Group' }],
                    },
                ],
            });
        });
    });

    // ──────────────────────────────────────────────
    // findRandomQuestionIds()
    // ──────────────────────────────────────────────
    describe('findRandomQuestionIds', () => {
        it('should return [] if criteria is empty or undefined', async () => {
            const res1 = await testService.findRandomQuestionIds({});
            const res2 = await testService.findRandomQuestionIds({
                skills: [],
                domains: [],
            });

            expect(res1).toEqual([]);
            expect(res2).toEqual([]);
        });

        it('should construct aggregate pipeline with skills filter and limits', async () => {
            const mockQIds = [{ _id: new ObjectId() }, { _id: new ObjectId() }];
            mockCollection.aggregate.mockReturnValue({
                toArray: jest.fn().mockResolvedValue(mockQIds),
            });

            const skills = ['Grammar', 'Listening'];
            const res = await testService.findRandomQuestionIds({ skills }, 5);

            expect(mockCollection.aggregate).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ $unwind: '$parts' }),
                    expect.objectContaining({
                        $project: {
                            questionsList: {
                                $ifNull: [
                                    '$parts.questions',
                                    '$parts.questionGroups.questions',
                                ],
                            },
                        },
                    }),
                    expect.objectContaining({ $sample: { size: 5 } }),
                ])
            );

            // Verify $match $or conditions constructed
            const matchStep = mockCollection.aggregate.mock.calls[0][0].find(
                (step: any) => step.$match && step.$match.$or
            );
            expect(matchStep.$match.$or).toContainEqual({
                'skillTags.skills': { $in: skills },
            });
            expect(matchStep.$match.$or).toContainEqual({
                'skillTags.grammarPoint': { $in: skills },
            });

            expect(res).toEqual(mockQIds.map((doc) => doc._id.toString()));
        });

        it('should construct pipeline with domains filter', async () => {
            const mockQIds = [{ _id: new ObjectId() }];
            mockCollection.aggregate.mockReturnValue({
                toArray: jest.fn().mockResolvedValue(mockQIds),
            });

            const domains = ['business'];
            await testService.findRandomQuestionIds({ domains }, 1);

            const matchStep = mockCollection.aggregate.mock.calls[0][0].find(
                (step: any) => step.$match && step.$match.$or
            );
            expect(matchStep.$match.$or).toContainEqual({
                'contentTags.domain': { $in: domains },
            });
        });

        it('should return [] and log if aggregate pipeline throws an error', async () => {
            mockCollection.aggregate.mockReturnValue({
                toArray: jest
                    .fn()
                    .mockRejectedValue(new Error('Aggregate failed')),
            });

            const consoleSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            const res = await testService.findRandomQuestionIds({
                skills: ['Reading'],
            });

            expect(res).toEqual([]);
            expect(consoleSpy).toHaveBeenCalledWith(
                'Error finding random question IDs:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });
    });
});
