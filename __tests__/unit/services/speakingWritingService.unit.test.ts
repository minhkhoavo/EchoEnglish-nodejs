/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { Types } from 'mongoose';
import speakingWritingService from '~/services/speakingWritingService.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

// ──────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────
jest.mock('mongoose', () => {
    const actualMongoose = jest.requireActual('mongoose');
    return {
        ...actualMongoose,
        connection: {
            readyState: 1,
            db: null,
        },
    };
});

describe('SpeakingWritingService', () => {
    let mockDb: any;
    let mockCollection: any;
    let mockFind: jest.Mock;
    let mockSort: jest.Mock;
    let mockToArray: jest.Mock;
    let mockAggregate: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();

        mockToArray = jest.fn();
        mockSort = jest.fn().mockReturnValue({ toArray: mockToArray });
        mockFind = jest.fn().mockReturnValue({ sort: mockSort });
        mockAggregate = jest
            .fn()
            .mockReturnValue({
                sort: jest.fn().mockReturnValue({ toArray: mockToArray }),
            });

        mockCollection = {
            findOne: jest.fn(),
            find: mockFind,
            aggregate: mockAggregate,
        };

        mockDb = {
            collection: jest.fn().mockReturnValue(mockCollection),
        };

        (mongoose.connection as any).readyState = 1;
        (mongoose.connection as any).db = mockDb;
    });

    // ════════════════════════════════════════════
    // getDb Connection Guard
    // ════════════════════════════════════════════
    describe('getDb Connection Guard', () => {
        it('should throw ApiError INTERNAL_ERROR if readyState !== 1', async () => {
            (mongoose.connection as any).readyState = 0;

            await expect(
                speakingWritingService.getAllTests()
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                speakingWritingService.getAllTests()
            ).rejects.toMatchObject({
                status: ErrorMessage.INTERNAL_ERROR.status,
                message: ErrorMessage.INTERNAL_ERROR.message,
            });
        });
    });

    // ════════════════════════════════════════════
    // getAllTests()
    // ════════════════════════════════════════════
    describe('getAllTests', () => {
        it('should query sw_tests collection with default empty query', async () => {
            const mockTests = [
                {
                    _id: 'test-1',
                    testTitle: 'TOEIC Speaking Test 1',
                    type: 'speaking',
                },
            ];
            mockToArray.mockResolvedValue(mockTests);

            const result = await speakingWritingService.getAllTests();

            expect(mockDb.collection).toHaveBeenCalledWith('sw_tests');
            expect(mockFind).toHaveBeenCalledWith(
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

        it('should pass custom query filter when provided', async () => {
            mockToArray.mockResolvedValue([]);
            const customQuery = { type: 'speaking' };

            await speakingWritingService.getAllTests(customQuery);

            expect(mockFind).toHaveBeenCalledWith(
                customQuery,
                expect.any(Object)
            );
        });
    });

    // ════════════════════════════════════════════
    // getTestById()
    // ════════════════════════════════════════════
    describe('getTestById', () => {
        const validId = new Types.ObjectId().toString();

        it('should return full test when no partNumbers are provided', async () => {
            const mockTest = { _id: validId, testTitle: 'Test 1', parts: [] };
            mockCollection.findOne.mockResolvedValue(mockTest);

            const result = await speakingWritingService.getTestById(validId);

            expect(mockDb.collection).toHaveBeenCalledWith('sw_tests');
            expect(mockCollection.findOne).toHaveBeenCalledWith({
                _id: expect.any(Object), // ObjectId instance
            });
            expect(result).toEqual(mockTest);
        });

        it('should return full test when partNumbers is empty array', async () => {
            const mockTest = { _id: validId, testTitle: 'Test 1', parts: [] };
            mockCollection.findOne.mockResolvedValue(mockTest);

            const result = await speakingWritingService.getTestById(
                validId,
                []
            );

            expect(mockCollection.findOne).toHaveBeenCalled();
            expect(result).toEqual(mockTest);
        });

        it('should throw ApiError TEST_NOT_FOUND when test does not exist (no parts)', async () => {
            mockCollection.findOne.mockResolvedValue(null);

            await expect(
                speakingWritingService.getTestById(validId)
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                speakingWritingService.getTestById(validId)
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
                message: ErrorMessage.TEST_NOT_FOUND.message,
            });
        });

        it('should use aggregate pipeline when partNumbers are provided', async () => {
            const mockTest = {
                _id: validId,
                testTitle: 'Test 1',
                type: 'speaking',
                parts: [{ offset: 1, partName: 'Part 1' }],
            };
            mockToArray.mockResolvedValue([mockTest]);

            const result = await speakingWritingService.getTestById(
                validId,
                [1, 2]
            );

            expect(mockAggregate).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ $match: expect.any(Object) }),
                    expect.objectContaining({ $project: expect.any(Object) }),
                ])
            );
            expect(result).toEqual(mockTest);
        });

        it('should throw ApiError TEST_NOT_FOUND when aggregate returns empty', async () => {
            mockToArray.mockResolvedValue([]);

            await expect(
                speakingWritingService.getTestById(validId, [1])
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                speakingWritingService.getTestById(validId, [1])
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
                message: ErrorMessage.TEST_NOT_FOUND.message,
            });
        });

        it('should throw ApiError PART_NOT_FOUND when test found but has no matching parts', async () => {
            const mockTest = {
                _id: validId,
                testTitle: 'Test 1',
                type: 'speaking',
                parts: [], // No matching parts
            };
            mockToArray.mockResolvedValue([mockTest]);

            await expect(
                speakingWritingService.getTestById(validId, [99])
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                speakingWritingService.getTestById(validId, [99])
            ).rejects.toMatchObject({
                status: ErrorMessage.PART_NOT_FOUND.status,
                message: ErrorMessage.PART_NOT_FOUND.message,
            });
        });

        it('should throw ApiError PART_NOT_FOUND when parts is undefined/null', async () => {
            const mockTest = {
                _id: validId,
                testTitle: 'Test 1',
                type: 'speaking',
                parts: null,
            };
            mockToArray.mockResolvedValue([mockTest]);

            await expect(
                speakingWritingService.getTestById(validId, [1])
            ).rejects.toBeInstanceOf(ApiError);

            await expect(
                speakingWritingService.getTestById(validId, [1])
            ).rejects.toMatchObject({
                status: ErrorMessage.PART_NOT_FOUND.status,
            });
        });
    });
});
