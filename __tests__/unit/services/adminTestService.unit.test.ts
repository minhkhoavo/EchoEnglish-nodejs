/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import adminTestService from '~/services/adminTestService.js';
import TestModel from '~/models/testModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import * as XLSX from 'xlsx';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';

// ──────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────
jest.mock('~/models/testModel.js', () => {
    const mockModel: any = jest.fn().mockImplementation(function (
        this: any,
        data: any
    ) {
        Object.assign(this, data);
        this.save = jest.fn().mockResolvedValue(this);
        return this;
    });
    mockModel.find = jest.fn();
    mockModel.findOne = jest.fn();
    mockModel.findOneAndUpdate = jest.fn();
    mockModel.countDocuments = jest.fn();
    return { __esModule: true, default: mockModel };
});

jest.mock('~/ai/provider/googleGenAIClient.js', () => ({
    __esModule: true,
    GoogleGenAIClient: jest.fn().mockImplementation(() => ({
        generate: jest.fn(),
    })),
    googleGenAIClient: {
        generate: jest.fn(),
        getModel: jest.fn(),
    },
}));

jest.mock('@langchain/core/output_parsers', () => ({
    __esModule: true,
    JsonOutputParser: jest.fn().mockImplementation(() => ({
        getFormatInstructions: jest.fn().mockReturnValue('format-instructions'),
        parse: jest.fn().mockResolvedValue({ parsed: true }),
    })),
}));

const mockedTestModel = TestModel as any;
const MockedGoogleGenAIClient = GoogleGenAIClient as jest.MockedClass<
    typeof GoogleGenAIClient
>;

// ──────────────────────────────────────────────
// Fixtures & Helpers
// ──────────────────────────────────────────────
const VALID_ID = new mongoose.Types.ObjectId().toString();
const INVALID_ID = 'invalid-id';

function buildMockTest(overrides: Record<string, any> = {}) {
    return {
        _id: new mongoose.Types.ObjectId(),
        testTitle: 'Test 1',
        type: 'listening-reading',
        duration: 120,
        number_of_questions: 0,
        number_of_parts: 7,
        parts: [],
        isDeleted: false,
        save: jest.fn().mockResolvedValue(true),
        ...overrides,
    };
}

function buildChainedFind(result: any[]) {
    return {
        select: jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnValue({
                skip: jest.fn().mockReturnValue({
                    limit: jest.fn().mockReturnValue({
                        lean: jest.fn().mockResolvedValue(result),
                    }),
                }),
            }),
        }),
    };
}

describe('AdminTestService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ════════════════════════════════════════════
    // createTest
    // ════════════════════════════════════════════
    describe('createTest', () => {
        it('should create test with default parts when no parts provided', async () => {
            const result = await adminTestService.createTest({
                testTitle: 'New Test',
            });

            expect(mockedTestModel).toHaveBeenCalledWith(
                expect.objectContaining({
                    testTitle: 'New Test',
                    type: 'listening-reading',
                    duration: 120,
                    number_of_questions: 0,
                    number_of_parts: 7,
                })
            );
            expect(result.save).toHaveBeenCalled();
        });

        it('should create 7 default parts with correct structure', async () => {
            await adminTestService.createTest({ testTitle: 'Test' });

            const constructorCall = mockedTestModel.mock.calls[0][0];
            const parts = constructorCall.parts;
            expect(parts.length).toBe(7);

            // Parts 1, 2, 5 have questions array
            expect(parts[0].questions).toEqual([]);
            expect(parts[1].questions).toEqual([]);
            expect(parts[4].questions).toEqual([]);

            // Parts 3, 4, 6, 7 have questionGroups array
            expect(parts[2].questionGroups).toEqual([]);
            expect(parts[3].questionGroups).toEqual([]);
            expect(parts[5].questionGroups).toEqual([]);
            expect(parts[6].questionGroups).toEqual([]);
        });

        it('should use custom values when provided', async () => {
            const customParts = [
                { partName: 'Custom Part', _id: new mongoose.Types.ObjectId() },
            ];
            await adminTestService.createTest({
                testTitle: 'Custom',
                type: 'listening-reading',
                duration: 90,
                number_of_questions: 50,
                number_of_parts: 3,
                parts: customParts as any,
            });

            const constructorCall = mockedTestModel.mock.calls[0][0];
            expect(constructorCall.duration).toBe(90);
            expect(constructorCall.number_of_questions).toBe(50);
            expect(constructorCall.number_of_parts).toBe(3);
            expect(constructorCall.parts).toBe(customParts);
        });
    });

    // ════════════════════════════════════════════
    // getAllTests
    // ════════════════════════════════════════════
    describe('getAllTests', () => {
        it('should return tests with pagination using defaults', async () => {
            const mockTests = [buildMockTest()];
            const chain = buildChainedFind(mockTests);
            mockedTestModel.find.mockReturnValue(chain);
            mockedTestModel.countDocuments.mockResolvedValue(1);

            const result = await adminTestService.getAllTests();

            expect(result.tests).toEqual(mockTests);
            expect(result.pagination).toEqual({
                page: 1,
                limit: 10,
                total: 1,
                totalPages: 1,
            });
        });

        it('should apply search filter when search is provided', async () => {
            const chain = buildChainedFind([]);
            mockedTestModel.find.mockReturnValue(chain);
            mockedTestModel.countDocuments.mockResolvedValue(0);

            await adminTestService.getAllTests(1, 10, 'TOEIC');

            expect(mockedTestModel.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    testTitle: { $regex: 'TOEIC', $options: 'i' },
                })
            );
        });

        it('should paginate correctly with page=2 limit=5', async () => {
            const chain = buildChainedFind([]);
            mockedTestModel.find.mockReturnValue(chain);
            mockedTestModel.countDocuments.mockResolvedValue(15);

            const result = await adminTestService.getAllTests(2, 5);

            expect(result.pagination).toEqual({
                page: 2,
                limit: 5,
                total: 15,
                totalPages: 3,
            });
        });
    });

    // ════════════════════════════════════════════
    // getTestById
    // ════════════════════════════════════════════
    describe('getTestById', () => {
        it('should throw ApiError INVALID_ID for invalid testId', async () => {
            await expect(
                adminTestService.getTestById(INVALID_ID)
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                adminTestService.getTestById(INVALID_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.INVALID_ID.status,
                message: ErrorMessage.INVALID_ID.message,
            });
        });

        it('should throw ApiError TEST_NOT_FOUND when test not found', async () => {
            mockedTestModel.findOne.mockResolvedValue(null);

            await expect(
                adminTestService.getTestById(VALID_ID)
            ).rejects.toBeInstanceOf(ApiError);
            await expect(
                adminTestService.getTestById(VALID_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
                message: ErrorMessage.TEST_NOT_FOUND.message,
            });
        });

        it('should return test when found', async () => {
            const mockTest = buildMockTest();
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const result = await adminTestService.getTestById(VALID_ID);

            expect(result).toBe(mockTest);
            expect(mockedTestModel.findOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    isDeleted: { $ne: true },
                })
            );
        });
    });

    // ════════════════════════════════════════════
    // updateTest
    // ════════════════════════════════════════════
    describe('updateTest', () => {
        it('should throw ApiError INVALID_ID for invalid testId', async () => {
            await expect(
                adminTestService.updateTest(INVALID_ID, {
                    testTitle: 'Updated',
                })
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw ApiError TEST_NOT_FOUND when test not found', async () => {
            mockedTestModel.findOneAndUpdate.mockResolvedValue(null);

            await expect(
                adminTestService.updateTest(VALID_ID, { testTitle: 'Updated' })
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
            });
        });

        it('should return updated test when found', async () => {
            const updatedTest = buildMockTest({ testTitle: 'Updated' });
            mockedTestModel.findOneAndUpdate.mockResolvedValue(updatedTest);

            const result = await adminTestService.updateTest(VALID_ID, {
                testTitle: 'Updated',
            });

            expect(result).toBe(updatedTest);
            expect(mockedTestModel.findOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    isDeleted: { $ne: true },
                }),
                { $set: { testTitle: 'Updated' } },
                { new: true }
            );
        });
    });

    // ════════════════════════════════════════════
    // deleteTest
    // ════════════════════════════════════════════
    describe('deleteTest', () => {
        it('should throw ApiError INVALID_ID for invalid testId', async () => {
            await expect(
                adminTestService.deleteTest(INVALID_ID)
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw ApiError TEST_NOT_FOUND when test not found', async () => {
            mockedTestModel.findOneAndUpdate.mockResolvedValue(null);

            await expect(
                adminTestService.deleteTest(VALID_ID)
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
            });
        });

        it('should soft delete test when found', async () => {
            mockedTestModel.findOneAndUpdate.mockResolvedValue(buildMockTest());

            await adminTestService.deleteTest(VALID_ID);

            expect(mockedTestModel.findOneAndUpdate).toHaveBeenCalledWith(
                expect.any(Object),
                { $set: { isDeleted: true } },
                { new: true }
            );
        });
    });

    // ════════════════════════════════════════════
    // importFromExcel
    // ════════════════════════════════════════════
    describe('importFromExcel', () => {
        it('should throw ApiError INVALID_ID for invalid testId', async () => {
            await expect(
                adminTestService.importFromExcel(INVALID_ID, Buffer.from(''))
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw ApiError TEST_NOT_FOUND when test not found', async () => {
            mockedTestModel.findOne.mockResolvedValue(null);

            await expect(
                adminTestService.importFromExcel(VALID_ID, Buffer.from(''))
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
            });
        });

        it('should parse Excel and import questions for individual parts (1, 2, 5)', async () => {
            const mockTest = buildMockTest();
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            // Create Excel buffer with part 1 question
            const data = [
                {
                    partNumber: 1,
                    questionNumber: 1,
                    questionText: 'Q1',
                    optionA: 'A',
                    optionB: 'B',
                    optionC: 'C',
                    optionD: 'D',
                    correctAnswer: 'A',
                    explanation: 'Explain',
                    audioUrl: 'audio.mp3',
                    imageUrls: 'img1.png,img2.png',
                    passageHtml: '<p>passage</p>',
                    transcript: 'transcript',
                    translation: 'translation',
                    difficulty: 'A2',
                    domain: 'business,office',
                },
            ];
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            const result = await adminTestService.importFromExcel(
                VALID_ID,
                buffer
            );

            expect(mockTest.save).toHaveBeenCalled();
            expect(result.parts.length).toBe(7);
            // Part 1 should have the question
            expect(result.parts[0].questions!.length).toBe(1);
            expect(result.parts[0].questions![0].correctAnswer).toBe('A');
            expect(result.parts[0].questions![0].options.length).toBe(4);
            // Parts 3,4,6,7 should have empty questionGroups
            expect(result.parts[2].questionGroups).toEqual([]);
        });

        it('should handle group questions for parts 3, 4, 6, 7', async () => {
            const mockTest = buildMockTest();
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const data = [
                {
                    partNumber: 3,
                    questionNumber: 31,
                    optionA: 'A',
                    optionB: 'B',
                    optionC: 'C',
                    correctAnswer: 'B',
                    groupId: 'group1',
                    audioUrl: 'audio.mp3',
                    imageUrls: 'img.png',
                    passageHtml: '<p>passage</p>',
                    transcript: 'transcript',
                    translation: 'translation',
                },
                {
                    partNumber: 3,
                    questionNumber: 32,
                    optionA: 'A',
                    optionB: 'B',
                    optionC: 'C',
                    correctAnswer: 'A',
                    groupId: 'group1',
                },
            ];
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            const result = await adminTestService.importFromExcel(
                VALID_ID,
                buffer
            );

            // Part 3 should have questionGroups with 1 group containing 2 questions
            const part3 = result.parts[2];
            expect(part3.questionGroups!.length).toBe(1);
            expect(part3.questionGroups![0].questions.length).toBe(2);
        });

        it('should auto-generate groupKey when groupId is not provided for group parts', async () => {
            const mockTest = buildMockTest();
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const data = [
                {
                    partNumber: 4,
                    questionNumber: 41,
                    optionA: 'A',
                    optionB: 'B',
                    optionC: 'C',
                    correctAnswer: 'C',
                    // No groupId → auto-generated
                },
            ];
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            const result = await adminTestService.importFromExcel(
                VALID_ID,
                buffer
            );

            const part4 = result.parts[3];
            expect(part4.questionGroups!.length).toBe(1);
        });

        it('should handle questions without optionD (3-option questions) and falsy options', async () => {
            const mockTest = buildMockTest();
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const data = [
                {
                    partNumber: 2,
                    questionNumber: 7,
                    optionA: '',
                    optionB: '',
                    optionC: '',
                    // No optionD
                    correctAnswer: 'A',
                },
            ];
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            const result = await adminTestService.importFromExcel(
                VALID_ID,
                buffer
            );

            const options = result.parts[1].questions![0].options;
            expect(options.length).toBe(3);
            expect(options[0].text).toBe('');
            expect(options[1].text).toBe('');
            expect(options[2].text).toBe('');
        });

        it('should handle questions without optional fields', async () => {
            const mockTest = buildMockTest();
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const data = [
                {
                    partNumber: 5,
                    questionNumber: 101,
                    optionA: 'A',
                    optionB: 'B',
                    optionC: 'C',
                    correctAnswer: 'B',
                    // No questionText, audioUrl, imageUrls, passageHtml, transcript, translation, difficulty, domain
                },
            ];
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            const result = await adminTestService.importFromExcel(
                VALID_ID,
                buffer
            );

            const q = result.parts[4].questions![0];
            expect(q.questionText).toBeNull();
            expect(q.media?.audioUrl).toBeNull();
            expect(q.media?.imageUrls).toBeNull();
            expect(q.contentTags?.difficulty).toBe('B1'); // default
            expect(q.contentTags?.domain).toEqual([]);
        });
    });

    // ════════════════════════════════════════════
    // updatePart
    // ════════════════════════════════════════════
    describe('updatePart', () => {
        it('should throw ApiError INVALID_ID for invalid testId', async () => {
            await expect(
                adminTestService.updatePart(INVALID_ID, 1, {})
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should throw ApiError TEST_NOT_FOUND when test not found', async () => {
            mockedTestModel.findOne.mockResolvedValue(null);

            await expect(
                adminTestService.updatePart(VALID_ID, 1, {})
            ).rejects.toMatchObject({
                status: ErrorMessage.TEST_NOT_FOUND.status,
            });
        });

        it('should update existing part when found', async () => {
            const mockTest = buildMockTest({
                parts: [
                    {
                        _id: new mongoose.Types.ObjectId(),
                        partName: 'Part 1',
                        questions: [],
                    },
                ],
            });
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const result = await adminTestService.updatePart(VALID_ID, 1, {
                questions: [{ questionNumber: 1 } as any],
            });

            expect(mockTest.save).toHaveBeenCalled();
            expect(result.parts[0].questions).toEqual([{ questionNumber: 1 }]);
        });

        it('should add new part when partNumber not found', async () => {
            const mockTest = buildMockTest({
                parts: [
                    {
                        _id: new mongoose.Types.ObjectId(),
                        partName: 'Part 1',
                        questions: [],
                    },
                ],
            });
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const result = await adminTestService.updatePart(VALID_ID, 8, {
                questions: [],
            });

            expect(result.parts.length).toBe(2);
            expect(result.parts[1].partName).toBe('Part 8');
        });
    });

    // ════════════════════════════════════════════
    // getExcelTemplate
    // ════════════════════════════════════════════
    describe('getExcelTemplate', () => {
        it('should return a Buffer with xlsx content', () => {
            const buffer = adminTestService.getExcelTemplate();

            expect(Buffer.isBuffer(buffer)).toBe(true);
            expect(buffer.length).toBeGreaterThan(0);

            // Verify it's a valid xlsx
            const wb = XLSX.read(buffer, { type: 'buffer' });
            expect(wb.SheetNames).toContain('Questions');

            const data = XLSX.utils.sheet_to_json(wb.Sheets['Questions']);
            expect(data.length).toBe(1);
        });
    });

    // ════════════════════════════════════════════
    // exportToExcel
    // ════════════════════════════════════════════
    describe('exportToExcel', () => {
        it('should throw ApiError INVALID_ID for invalid testId', async () => {
            await expect(
                adminTestService.exportToExcel(INVALID_ID)
            ).rejects.toBeInstanceOf(ApiError);
        });

        it('should export test with individual questions to Excel', async () => {
            const mockTest = buildMockTest({
                parts: [
                    {
                        partName: 'Part 1',
                        questions: [
                            {
                                questionNumber: 1,
                                questionText: 'Q1',
                                options: [
                                    { label: 'A', text: 'Opt A' },
                                    { label: 'B', text: 'Opt B' },
                                    { label: 'C', text: 'Opt C' },
                                    { label: 'D', text: 'Opt D' },
                                ],
                                correctAnswer: 'A',
                                explanation: 'Expl',
                                media: {
                                    audioUrl: 'audio.mp3',
                                    imageUrls: ['img1.png', 'img2.png'],
                                    passageHtml: '<p>p</p>',
                                    transcript: 'trans',
                                    translation: 'transl',
                                },
                                contentTags: {
                                    difficulty: 'B1',
                                    domain: ['business', 'office'],
                                },
                            },
                        ],
                    },
                ],
            });
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const buffer = await adminTestService.exportToExcel(VALID_ID);

            expect(Buffer.isBuffer(buffer)).toBe(true);
            const wb = XLSX.read(buffer, { type: 'buffer' });
            const data = XLSX.utils.sheet_to_json(wb.Sheets['Questions']);
            expect(data.length).toBe(1);
            expect((data[0] as any).correctAnswer).toBe('A');
        });

        it('should export test with question groups to Excel', async () => {
            const mockTest = buildMockTest({
                parts: [
                    {
                        partName: 'Part 3',
                        questionGroups: [
                            {
                                // No _id provided to hit group._id?.toString() || '' fallback
                                groupContext: {
                                    audioUrl: 'group-audio.mp3',
                                    imageUrls: ['grp-img.png'],
                                    passageHtml: '<p>group</p>',
                                    transcript: 'grp-trans',
                                    translation: 'grp-transl',
                                },
                                questions: [
                                    {
                                        questionNumber: 31,
                                        options: [
                                            { label: 'A', text: 'A' },
                                            { label: 'B', text: 'B' },
                                            { label: 'C', text: 'C' },
                                        ],
                                        correctAnswer: 'B',
                                        contentTags: {
                                            difficulty: 'A2',
                                            domain: ['travel'],
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const buffer = await adminTestService.exportToExcel(VALID_ID);

            const wb = XLSX.read(buffer, { type: 'buffer' });
            const data = XLSX.utils.sheet_to_json(wb.Sheets['Questions']);
            expect(data.length).toBe(1);
            expect((data[0] as any).groupId).toBe('');
        });

        it('should handle parts with neither questions nor questionGroups', async () => {
            const mockTest = buildMockTest({
                parts: [{ partName: 'Part 1' }],
            });
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const buffer = await adminTestService.exportToExcel(VALID_ID);

            const wb = XLSX.read(buffer, { type: 'buffer' });
            const data = XLSX.utils.sheet_to_json(wb.Sheets['Questions']);
            expect(data.length).toBe(0);
        });

        it('should handle questions with missing optional fields and empty options', async () => {
            const mockTest = buildMockTest({
                parts: [
                    {
                        partName: 'Part 2',
                        questions: [
                            {
                                questionNumber: 1,
                                options: [], // No options to hit q.options[0]?.text fallback
                                correctAnswer: 'A',
                                // No questionText, explanation, media, contentTags
                            },
                        ],
                    },
                    {
                        partName: 'Part 3',
                        questionGroups: [
                            {
                                _id: new mongoose.Types.ObjectId(),
                                groupContext: {}, // Empty context
                                questions: [
                                    {
                                        questionNumber: 31,
                                        options: [], // No options
                                        correctAnswer: 'B',
                                        contentTags: {}, // Empty tags
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
            mockedTestModel.findOne.mockResolvedValue(mockTest);

            const buffer = await adminTestService.exportToExcel(VALID_ID);

            const wb = XLSX.read(buffer, { type: 'buffer' });
            const data = XLSX.utils.sheet_to_json(wb.Sheets['Questions']);
            expect(data.length).toBe(2);
            expect((data[0] as any).optionA).toBe(''); // empty options mapped to ''
            expect((data[1] as any).domain).toBe(''); // empty tags mapped to ''
        });
    });

    // ════════════════════════════════════════════
    // run
    // ════════════════════════════════════════════
    describe('run', () => {
        it('should call GoogleGenAIClient with temperature and parse response', async () => {
            const mockGenerate = jest
                .fn()
                .mockResolvedValue('{"result": true}');
            (MockedGoogleGenAIClient as any).mockImplementation(() => ({
                generate: mockGenerate,
            }));

            const result = await adminTestService.run('test prompt', 0.5);

            expect(MockedGoogleGenAIClient).toHaveBeenCalledWith({
                temperature: 0.5,
            });
            expect(mockGenerate).toHaveBeenCalledWith(
                expect.stringContaining('test prompt')
            );
            expect(result).toEqual({ parsed: true });
        });

        it('should use default temperature of 0.4', async () => {
            const mockGenerate = jest.fn().mockResolvedValue('{}');
            (MockedGoogleGenAIClient as any).mockImplementation(() => ({
                generate: mockGenerate,
            }));

            await adminTestService.run('prompt');

            expect(MockedGoogleGenAIClient).toHaveBeenCalledWith({
                temperature: 0.4,
            });
        });
    });
});
