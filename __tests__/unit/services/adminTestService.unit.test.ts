/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import adminTestService from '~/services/adminTestService.js';
import TestModel from '~/models/testModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import * as XLSX from 'xlsx';
import S3Service from '~/services/s3Service.js';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import axios from 'axios';

// ──────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────
jest.mock('~/models/testModel.js');
jest.mock('xlsx');
jest.mock('~/services/s3Service.js', () => ({
    __esModule: true,
    default: {
        downloadFile: jest.fn(),
    },
}));
jest.mock('~/ai/provider/googleGenAIClient.js', () => ({
    GoogleGenAIClient: jest.fn().mockImplementation(() => ({
        generate: jest.fn(),
    })),
}));
jest.mock('@langchain/core/output_parsers', () => ({
    JsonOutputParser: jest.fn().mockImplementation(() => ({
        getFormatInstructions: jest.fn().mockReturnValue('format-instructions'),
        parse: jest.fn().mockImplementation((val) => JSON.parse(val)),
    })),
}));
jest.mock('axios');

const mockedTestModel = TestModel as jest.Mocked<typeof TestModel>;
const mockedXLSX = XLSX as jest.Mocked<any>;
const mockedS3Service = S3Service as jest.Mocked<any>;
const mockedGoogleGenAIClient = GoogleGenAIClient as jest.Mocked<any>;
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ──────────────────────────────────────────────
// Fixtures & Helpers
// ──────────────────────────────────────────────
const MOCK_TEST_ID = '60f8e8b4e7c8e8b4e7c8e8b4';
const VALID_OBJECT_ID = new ObjectId(MOCK_TEST_ID);

function buildMockTest(overrides: Record<string, unknown> = {}) {
    return {
        _id: VALID_OBJECT_ID,
        testTitle: 'English Mock Test',
        type: 'listening-reading',
        duration: 120,
        number_of_questions: 10,
        number_of_parts: 7,
        parts: [
            { _id: new ObjectId(), partName: 'Part 1', questions: [] },
            { _id: new ObjectId(), partName: 'Part 2', questions: [] },
            { _id: new ObjectId(), partName: 'Part 3', questionGroups: [] },
            { _id: new ObjectId(), partName: 'Part 4', questionGroups: [] },
            { _id: new ObjectId(), partName: 'Part 5', questions: [] },
            { _id: new ObjectId(), partName: 'Part 6', questionGroups: [] },
            { _id: new ObjectId(), partName: 'Part 7', questionGroups: [] },
        ],
        isDeleted: false,
        save: jest.fn().mockResolvedValue(true),
        ...overrides,
    };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────
describe('AdminTestService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Setup default instantiation for GoogleGenAIClient mock
        mockedGoogleGenAIClient.mockImplementation(() => ({
            generate: jest.fn().mockResolvedValue('{"result": "success"}'),
        }));
    });

    // ════════════════════════════════════════════
    // createTest()
    // ════════════════════════════════════════════
    describe('createTest', () => {
        it('should create a test document with given options and 7 default parts', async () => {
            const mockSave = jest.fn().mockResolvedValue(true);
            (mockedTestModel as any).mockImplementation(
                (initData: any) =>
                    ({
                        ...initData,
                        save: mockSave,
                    }) as any
            );

            const testData = {
                testTitle: 'TOEIC Prep 1',
            };

            const result = await adminTestService.createTest(testData);

            expect(mockedTestModel).toHaveBeenCalledTimes(1);
            expect(mockSave).toHaveBeenCalledTimes(1);
            expect(result.testTitle).toBe('TOEIC Prep 1');
            expect(result.type).toBe('listening-reading');
            expect(result.duration).toBe(120);
            expect(result.number_of_questions).toBe(0);
            expect(result.number_of_parts).toBe(7);
            expect(result.parts).toHaveLength(7);

            // Check that parts 1, 2, 5 have questions list, and 3, 4, 6, 7 have questionGroups list
            expect(result.parts[0].partName).toBe('Part 1');
            expect(result.parts[0].questions).toBeDefined();
            expect(result.parts[0].questionGroups).toBeUndefined();

            expect(result.parts[2].partName).toBe('Part 3');
            expect(result.parts[2].questionGroups).toBeDefined();
            expect(result.parts[2].questions).toBeUndefined();
        });
    });

    // ════════════════════════════════════════════
    // getAllTests()
    // ════════════════════════════════════════════
    describe('getAllTests', () => {
        it('should paginate, sort, and lean search tests', async () => {
            const mockTests = [
                buildMockTest({ testTitle: 'Test A' }),
                buildMockTest({ testTitle: 'Test B' }),
            ];
            const mockChain = {
                select: jest.fn().mockReturnThis(),
                sort: jest.fn().mockReturnThis(),
                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(mockTests),
            };

            mockedTestModel.find.mockReturnValue(mockChain as any);
            mockedTestModel.countDocuments.mockResolvedValue(100);

            const result = await adminTestService.getAllTests(
                2,
                5,
                'searchkey'
            );

            expect(mockedTestModel.find).toHaveBeenCalledWith({
                isDeleted: { $ne: true },
                testTitle: { $regex: 'searchkey', $options: 'i' },
            });
            expect(mockChain.select).toHaveBeenCalledWith(
                'testTitle type duration number_of_questions number_of_parts createdAt updatedAt'
            );
            expect(mockChain.sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(mockChain.skip).toHaveBeenCalledWith(5); // (2-1)*5
            expect(mockChain.limit).toHaveBeenCalledWith(5);
            expect(mockedTestModel.countDocuments).toHaveBeenCalledWith({
                isDeleted: { $ne: true },
                testTitle: { $regex: 'searchkey', $options: 'i' },
            });

            expect(result).toEqual({
                tests: mockTests,
                pagination: {
                    page: 2,
                    limit: 5,
                    total: 100,
                    totalPages: 20,
                },
            });
        });

        it('should use default pagination parameters if page, limit, and search are omitted', async () => {
            const mockChain = {
                select: jest.fn().mockReturnThis(),
                sort: jest.fn().mockReturnThis(),
                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue([]),
            };
            mockedTestModel.find.mockReturnValue(mockChain as any);
            mockedTestModel.countDocuments.mockResolvedValue(0);

            await adminTestService.getAllTests();

            expect(mockedTestModel.find).toHaveBeenCalledWith({
                isDeleted: { $ne: true },
            });
            expect(mockChain.skip).toHaveBeenCalledWith(0);
            expect(mockChain.limit).toHaveBeenCalledWith(10);
        });
    });

    // ════════════════════════════════════════════
    // getTestById()
    // ════════════════════════════════════════════
    describe('getTestById', () => {
        it('should throw ApiError(INVALID_ID) if provided id is invalid', async () => {
            await expect(
                adminTestService.getTestById('invalid-id')
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                adminTestService.getTestById('invalid-id')
            ).rejects.toMatchObject({
                status: ErrorMessage.INVALID_ID.status,
            });
        });

        it('should throw ApiError(TEST_NOT_FOUND) if test does not exist', async () => {
            mockedTestModel.findOne.mockResolvedValue(null);

            await expect(
                adminTestService.getTestById(MOCK_TEST_ID)
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                adminTestService.getTestById(MOCK_TEST_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
            });
        });

        it('should return found test document', async () => {
            const mockTest = buildMockTest();
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const result = await adminTestService.getTestById(MOCK_TEST_ID);

            expect(mockedTestModel.findOne).toHaveBeenCalledWith({
                _id: VALID_OBJECT_ID,
                isDeleted: { $ne: true },
            });
            expect(result).toEqual(mockTest);
        });
    });

    // ════════════════════════════════════════════
    // updateTest()
    // ════════════════════════════════════════════
    describe('updateTest', () => {
        it('should throw ApiError(INVALID_ID) if provided id is invalid', async () => {
            await expect(
                adminTestService.updateTest('invalid-id', {})
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw ApiError(TEST_NOT_FOUND) if test does not exist', async () => {
            mockedTestModel.findOneAndUpdate.mockResolvedValue(null);

            await expect(
                adminTestService.updateTest(MOCK_TEST_ID, {})
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
            });
        });

        it('should update test with update object and return updated document', async () => {
            const mockTest = buildMockTest({ testTitle: 'Updated Title' });
            mockedTestModel.findOneAndUpdate.mockResolvedValue(mockTest);

            const updateData = { testTitle: 'Updated Title' };
            const result = await adminTestService.updateTest(
                MOCK_TEST_ID,
                updateData
            );

            expect(mockedTestModel.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: VALID_OBJECT_ID, isDeleted: { $ne: true } },
                { $set: updateData },
                { new: true }
            );
            expect(result).toEqual(mockTest);
        });
    });

    // ════════════════════════════════════════════
    // deleteTest()
    // ════════════════════════════════════════════
    describe('deleteTest', () => {
        it('should throw ApiError(INVALID_ID) if provided id is invalid', async () => {
            await expect(
                adminTestService.deleteTest('invalid-id')
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw ApiError(TEST_NOT_FOUND) if test does not exist', async () => {
            mockedTestModel.findOneAndUpdate.mockResolvedValue(null);

            await expect(
                adminTestService.deleteTest(MOCK_TEST_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
            });
        });

        it('should soft delete test by setting isDeleted to true', async () => {
            mockedTestModel.findOneAndUpdate.mockResolvedValue(
                buildMockTest({ isDeleted: true })
            );

            await adminTestService.deleteTest(MOCK_TEST_ID);

            expect(mockedTestModel.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: VALID_OBJECT_ID, isDeleted: { $ne: true } },
                { $set: { isDeleted: true } },
                { new: true }
            );
        });
    });

    // ════════════════════════════════════════════
    // updatePart()
    // ════════════════════════════════════════════
    describe('updatePart', () => {
        it('should throw ApiError(INVALID_ID) if provided id is invalid', async () => {
            await expect(
                adminTestService.updatePart('invalid-id', 1, {})
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw ApiError(TEST_NOT_FOUND) if test does not exist', async () => {
            mockedTestModel.findOne.mockResolvedValue(null);

            await expect(
                adminTestService.updatePart(MOCK_TEST_ID, 1, {})
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
            });
        });

        it('should update an existing part inside parts array', async () => {
            const mockTest = buildMockTest();
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const updateData = {
                questions: [
                    { questionNumber: 1, correctAnswer: 'A', options: [] },
                ],
            };
            await adminTestService.updatePart(MOCK_TEST_ID, 1, updateData);

            expect(mockTest.parts[0].questions).toEqual(updateData.questions);
            expect(mockTest.save).toHaveBeenCalledTimes(1);
        });

        it('should append new part inside parts array if it does not exist', async () => {
            const mockTest = buildMockTest({ parts: [] }); // Empty parts list
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            await adminTestService.updatePart(MOCK_TEST_ID, 1, {
                questions: [],
            });

            expect(mockTest.parts).toHaveLength(1);
            expect(mockTest.parts[0].partName).toBe('Part 1');
            expect(mockTest.save).toHaveBeenCalledTimes(1);
        });
    });

    // ════════════════════════════════════════════
    // getExcelTemplate()
    // ════════════════════════════════════════════
    describe('getExcelTemplate', () => {
        it('should call XLSX book utilities and return write output buffer', () => {
            const mockWorkbook = {};
            const mockWorksheet = {};
            const mockBuffer = Buffer.from('mock-excel-buffer');

            mockedXLSX.utils.book_new.mockReturnValue(mockWorkbook);
            mockedXLSX.utils.json_to_sheet.mockReturnValue(mockWorksheet);
            mockedXLSX.write.mockReturnValue(mockBuffer);

            const result = adminTestService.getExcelTemplate();

            expect(mockedXLSX.utils.book_new).toHaveBeenCalled();
            expect(mockedXLSX.utils.json_to_sheet).toHaveBeenCalled();
            expect(mockedXLSX.utils.book_append_sheet).toHaveBeenCalledWith(
                mockWorkbook,
                mockWorksheet,
                'Questions'
            );
            expect(mockedXLSX.write).toHaveBeenCalledWith(mockWorkbook, {
                type: 'buffer',
                bookType: 'xlsx',
            });
            expect(result).toBe(mockBuffer);
        });
    });

    // ════════════════════════════════════════════
    // exportToExcel()
    // ════════════════════════════════════════════
    describe('exportToExcel', () => {
        it('should flatten test questions and question groups, calling XLSX write', async () => {
            const mockTest = buildMockTest({
                parts: [
                    {
                        partName: 'Part 1',
                        questions: [
                            {
                                questionNumber: 1,
                                questionText: 'Q1',
                                options: [{ label: 'A', text: 'OptA' }],
                                correctAnswer: 'A',
                                explanation: 'Exp1',
                                media: { audioUrl: 'url1' },
                                contentTags: { difficulty: 'B1' },
                            },
                            {
                                questionNumber: 3,
                                options: [],
                                correctAnswer: 'C',
                            },
                        ],
                    },
                    {
                        partName: 'Part 3',
                        questionGroups: [
                            {
                                _id: new mongoose.Types.ObjectId(),
                                groupContext: {},
                                questions: [
                                    {
                                        questionNumber: 2,
                                        options: [],
                                        correctAnswer: 'B',
                                    },
                                ],
                            },
                            {
                                groupContext: {},
                                questions: [
                                    {
                                        questionNumber: 6,
                                        options: [],
                                        correctAnswer: 'A',
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });

            mockedTestModel.findOne.mockResolvedValue(mockTest);
            mockedXLSX.utils.book_new.mockReturnValue({});
            mockedXLSX.write.mockReturnValue(Buffer.from('exported-data'));

            const result = await adminTestService.exportToExcel(MOCK_TEST_ID);

            expect(mockedXLSX.utils.json_to_sheet).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        partNumber: 1,
                        questionNumber: 1,
                        questionText: 'Q1',
                        correctAnswer: 'A',
                    }),
                    expect.objectContaining({
                        partNumber: 1,
                        questionNumber: 3,
                        questionText: '',
                        correctAnswer: 'C',
                        optionA: '',
                        optionB: '',
                        optionC: '',
                        optionD: '',
                        explanation: '',
                        audioUrl: '',
                        imageUrls: '',
                        passageHtml: '',
                        transcript: '',
                        translation: '',
                        difficulty: '',
                        domain: '',
                    }),
                    expect.objectContaining({
                        partNumber: 3,
                        questionNumber: 2,
                        passageHtml: '',
                        correctAnswer: 'B',
                    }),
                    expect.objectContaining({
                        partNumber: 3,
                        questionNumber: 6,
                        groupId: '',
                        correctAnswer: 'A',
                    }),
                ])
            );
            expect(result).toEqual(Buffer.from('exported-data'));
        });
    });

    // ════════════════════════════════════════════
    // run()
    // ════════════════════════════════════════════
    describe('run', () => {
        it('should call GoogleGenAIClient generate and return parsed object response', async () => {
            const clientMock = {
                generate: jest
                    .fn()
                    .mockResolvedValue('{"parsedKey": "parsedVal"}'),
            };
            mockedGoogleGenAIClient.mockImplementation(() => clientMock);

            const result = await adminTestService.run('my-prompt', 0.5);

            expect(mockedGoogleGenAIClient).toHaveBeenCalledWith({
                temperature: 0.5,
            });
            expect(clientMock.generate).toHaveBeenCalledWith(
                expect.stringContaining('my-prompt')
            );
            expect(result).toEqual({ parsedKey: 'parsedVal' });
        });

        it('should use default temperature if omitted in run', async () => {
            const clientMock = {
                generate: jest.fn().mockResolvedValue('{"runDefault": true}'),
            };
            mockedGoogleGenAIClient.mockImplementation(() => clientMock);

            await adminTestService.run('my-prompt');

            expect(mockedGoogleGenAIClient).toHaveBeenCalledWith({
                temperature: 0.4,
            });
        });
    });

    // ════════════════════════════════════════════
    // runWithMedia()
    // ════════════════════════════════════════════
    describe('runWithMedia', () => {
        it('should download AWS images, call client generate, and parse output', async () => {
            const clientMock = {
                generate: jest
                    .fn()
                    .mockResolvedValue('{"mediaResponse": "yes"}'),
            };
            mockedGoogleGenAIClient.mockImplementation(() => clientMock);
            mockedS3Service.downloadFile.mockResolvedValue(
                Buffer.from('image-content')
            );

            const imageUrls = ['https://my-bucket.amazonaws.com/image.png'];
            const result = await adminTestService.runWithMedia('prompt-media', {
                imageUrls,
            });

            expect(mockedS3Service.downloadFile).toHaveBeenCalledWith(
                imageUrls[0]
            );
            expect(clientMock.generate).toHaveBeenCalledWith(
                expect.stringContaining('prompt-media'),
                [
                    {
                        data: Buffer.from('image-content').toString('base64'),
                        mimeType: 'image/png',
                    },
                ]
            );
            expect(result).toEqual({ mediaResponse: 'yes' });
        });

        it('should fetch external URL images using axios when not AWS S3 format', async () => {
            const clientMock = {
                generate: jest
                    .fn()
                    .mockResolvedValue('{"externalResponse": true}'),
            };
            mockedGoogleGenAIClient.mockImplementation(() => clientMock);
            mockedAxios.get.mockResolvedValue({
                data: Buffer.from('ext-img-content'),
                headers: { 'content-type': 'image/jpeg' },
            });

            const imageUrls = ['https://otherwebsite.com/photo.jpeg'];
            const result = await adminTestService.runWithMedia('prompt-ext', {
                imageUrls,
            });

            expect(mockedAxios.get).toHaveBeenCalledWith(imageUrls[0], {
                responseType: 'arraybuffer',
                timeout: 15000,
            });
            expect(clientMock.generate).toHaveBeenCalledWith(
                expect.stringContaining('prompt-ext'),
                [
                    {
                        data: Buffer.from('ext-img-content').toString('base64'),
                        mimeType: 'image/jpeg',
                    },
                ]
            );
            expect(result).toEqual({ externalResponse: true });
        });

        it('should fallback to image guess extension types (webp, gif, bmp, defaults) when content-type is missing', async () => {
            const clientMock = {
                generate: jest
                    .fn()
                    .mockResolvedValue('{"extensionsResponse": true}'),
            };
            mockedGoogleGenAIClient.mockImplementation(() => clientMock);

            // mock axios for various extensions
            mockedAxios.get
                .mockResolvedValueOnce({
                    data: Buffer.from('webp-data'),
                    headers: {},
                })
                .mockResolvedValueOnce({
                    data: Buffer.from('gif-data'),
                    headers: {},
                })
                .mockResolvedValueOnce({
                    data: Buffer.from('bmp-data'),
                    headers: {},
                })
                .mockResolvedValueOnce({
                    data: Buffer.from('fallback-data'),
                    headers: {},
                });

            const imageUrls = [
                'https://other.com/photo.webp',
                'https://other.com/photo.gif',
                'https://other.com/photo.bmp',
                'https://other.com/photo.xyz',
            ];
            await adminTestService.runWithMedia('prompt-ext-guess', {
                imageUrls,
            });

            expect(clientMock.generate).toHaveBeenCalledWith(
                expect.any(String),
                expect.arrayContaining([
                    {
                        data: Buffer.from('webp-data').toString('base64'),
                        mimeType: 'image/webp',
                    },
                    {
                        data: Buffer.from('gif-data').toString('base64'),
                        mimeType: 'image/gif',
                    },
                    {
                        data: Buffer.from('bmp-data').toString('base64'),
                        mimeType: 'image/bmp',
                    },
                    {
                        data: Buffer.from('fallback-data').toString('base64'),
                        mimeType: 'image/jpeg',
                    },
                ])
            );
        });

        it('should handle S3 download or axios failure gracefully by logging error and passing undefined to client.generate', async () => {
            const clientMock = {
                generate: jest
                    .fn()
                    .mockResolvedValue('{"failedFetchResponse": true}'),
            };
            mockedGoogleGenAIClient.mockImplementation(() => clientMock);
            mockedS3Service.downloadFile.mockRejectedValue(
                new Error('S3 Download Error')
            );

            const consoleSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();

            const imageUrls = [
                'https://my-bucket.amazonaws.com/broken-image.png',
            ];
            await adminTestService.runWithMedia('prompt-broken', { imageUrls });

            expect(consoleSpy).toHaveBeenCalledWith(
                '[adminTestService] Failed to fetch image',
                imageUrls[0],
                expect.any(Error)
            );
            expect(clientMock.generate).toHaveBeenCalledWith(
                expect.stringContaining('prompt-broken'),
                undefined
            );

            consoleSpy.mockRestore();
        });

        it('should return null if downloaded AWS S3 file buffer is empty or null', async () => {
            const clientMock = {
                generate: jest
                    .fn()
                    .mockResolvedValue('{"emptyBufferResponse": true}'),
            };
            mockedGoogleGenAIClient.mockImplementation(() => clientMock);
            mockedS3Service.downloadFile.mockResolvedValue(null);
            mockedAxios.get.mockResolvedValue({ data: null, headers: {} });

            await adminTestService.runWithMedia('prompt-empty-buffer', {
                imageUrls: ['https://my-bucket.amazonaws.com/image.png'],
            });

            expect(clientMock.generate).toHaveBeenCalledWith(
                expect.stringContaining('prompt-empty-buffer'),
                undefined
            );
        });

        it('should handle fallback to default jpg mimeType for default guess image extension case', async () => {
            const clientMock = {
                generate: jest
                    .fn()
                    .mockResolvedValue('{"jpgDefaultResponse": true}'),
            };
            mockedGoogleGenAIClient.mockImplementation(() => clientMock);
            mockedAxios.get.mockResolvedValue({
                data: Buffer.from('jpg-data'),
                headers: {},
            });

            await adminTestService.runWithMedia('prompt-ext-jpg', {
                imageUrls: ['https://other.com/photo.jpg'],
            });

            expect(clientMock.generate).toHaveBeenCalledWith(
                expect.any(String),
                [
                    {
                        data: Buffer.from('jpg-data').toString('base64'),
                        mimeType: 'image/jpeg',
                    },
                ]
            );
        });

        it('should use default options when calling runWithMedia with default arguments', async () => {
            const clientMock = {
                generate: jest.fn().mockResolvedValue('{"defaultVal": true}'),
            };
            mockedGoogleGenAIClient.mockImplementation(() => clientMock);

            await adminTestService.runWithMedia('prompt-only');

            expect(mockedGoogleGenAIClient).toHaveBeenCalledWith({
                temperature: 0.7,
                model: 'gemini-2.5-flash',
            });
        });

        it('should return null if S3 downloaded buffer is empty (length 0)', async () => {
            const clientMock = {
                generate: jest.fn().mockResolvedValue('{}'),
            };
            mockedGoogleGenAIClient.mockImplementation(() => clientMock);
            mockedS3Service.downloadFile.mockResolvedValue(Buffer.from(''));

            await adminTestService.runWithMedia('test-empty-len', {
                imageUrls: ['https://my-bucket.amazonaws.com/image.png'],
            });

            expect(clientMock.generate).toHaveBeenCalledWith(
                expect.any(String),
                undefined
            );
        });
    });

    // ════════════════════════════════════════════
    // importFromExcel()
    // ════════════════════════════════════════════
    describe('importFromExcel', () => {
        it('should throw ApiError(INVALID_ID) if provided id is invalid', async () => {
            await expect(
                adminTestService.importFromExcel('invalid-id', Buffer.from(''))
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw ApiError(TEST_NOT_FOUND) if test does not exist', async () => {
            mockedTestModel.findOne.mockResolvedValue(null);

            await expect(
                adminTestService.importFromExcel(MOCK_TEST_ID, Buffer.from(''))
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
            });
        });

        it('should read Excel buffer, sort rows into 7 parts and update the test document', async () => {
            const mockTest = buildMockTest();
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const mockRows = [
                {
                    partNumber: 1,
                    questionNumber: 1,
                    questionText: 'Q1 Text',
                    optionA: 'A',
                    optionB: 'B',
                    optionC: 'C',
                    optionD: 'D',
                    correctAnswer: 'A',
                    difficulty: 'B1',
                    domain: 'finance',
                    imageUrls:
                        'https://example.com/img1.png, https://example.com/img2.png',
                },
                {
                    partNumber: 3,
                    questionNumber: 2,
                    optionA: 'Opt1',
                    optionB: 'Opt2',
                    optionC: 'Opt3',
                    correctAnswer: 'B',
                    groupId: 'group_test_3',
                    imageUrls: 'https://example.com/img3.png',
                },
                {
                    partNumber: 1,
                    questionNumber: 3,
                    correctAnswer: 'C',
                },
                {
                    partNumber: 4,
                    questionNumber: 4,
                    correctAnswer: 'D',
                },
                {
                    partNumber: 3,
                    questionNumber: 5,
                    optionA: 'OptX',
                    optionB: 'OptY',
                    optionC: 'OptZ',
                    correctAnswer: 'A',
                    groupId: 'group_test_3',
                },
            ];

            mockedXLSX.read.mockReturnValue({
                SheetNames: ['Sheet1'],
                Sheets: { Sheet1: {} },
            });
            mockedXLSX.utils.sheet_to_json.mockReturnValue(mockRows);

            const result = await adminTestService.importFromExcel(
                MOCK_TEST_ID,
                Buffer.from('some-buffer')
            );

            expect(mockedXLSX.read).toHaveBeenCalledWith(
                Buffer.from('some-buffer'),
                { type: 'buffer' }
            );
            expect(mockedTestModel.findOne).toHaveBeenCalledWith({
                _id: VALID_OBJECT_ID,
                isDeleted: { $ne: true },
            });

            expect(result.parts[0].questions).toHaveLength(2);
            expect(result.parts[0].questions![0].questionNumber).toBe(1);
            expect(result.parts[0].questions![0].questionText).toBe('Q1 Text');
            expect(result.parts[0].questions![0].options).toEqual([
                { label: 'A', text: 'A' },
                { label: 'B', text: 'B' },
                { label: 'C', text: 'C' },
                { label: 'D', text: 'D' },
            ]);
            expect(result.parts[0].questions![1].questionNumber).toBe(3);
            expect(result.parts[0].questions![1].questionText).toBeNull();
            expect(result.parts[0].questions![1].options).toEqual([
                { label: 'A', text: '' },
                { label: 'B', text: '' },
                { label: 'C', text: '' },
            ]);

            // Part 3 has groups
            expect(result.parts[2].questionGroups).toHaveLength(1);
            expect(result.parts[2].questionGroups![0].questions).toHaveLength(
                2
            );
            expect(
                result.parts[2].questionGroups![0].questions[0].questionNumber
            ).toBe(2);
            expect(
                result.parts[2].questionGroups![0].questions[1].questionNumber
            ).toBe(5);

            expect(mockTest.number_of_questions).toBe(5);
            expect(mockTest.save).toHaveBeenCalledTimes(1);
        });
    });
});
