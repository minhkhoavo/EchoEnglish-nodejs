import mongoose from 'mongoose';
import TestModel, {
    ITest,
    IPart,
    IQuestion,
    IQuestionGroup,
} from '../models/testModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { ObjectId } from 'mongodb';
import * as XLSX from 'xlsx';

interface CreateTestDto {
    testTitle: string;
    type?: 'listening-reading';
    duration?: number;
    number_of_questions?: number;
    number_of_parts?: number;
    parts?: IPart[];
}

interface UpdateTestDto {
    testTitle?: string;
    duration?: number;
    number_of_questions?: number;
    number_of_parts?: number;
    parts?: IPart[];
}

interface ExcelQuestion {
    partNumber: number;
    questionNumber: number;
    questionText?: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD?: string;
    correctAnswer: string;
    explanation?: string;
    audioUrl?: string;
    imageUrls?: string;
    passageHtml?: string;
    transcript?: string;
    translation?: string;
    groupId?: string; // For grouping questions in Parts 3,4,6,7
    difficulty?: string;
    domain?: string;
}

class AdminTestService {
    /**
     * Create a new test
     */
    public async createTest(data: CreateTestDto): Promise<ITest> {
        // Tạo 7 parts mặc định
        const defaultParts: IPart[] = [];
        for (let i = 1; i <= 7; i++) {
            const part: IPart = {
                _id: new mongoose.Types.ObjectId(),
                partName: `Part ${i}`,
            };

            // Parts 1, 2, 5 có individual questions
            if ([1, 2, 5].includes(i)) {
                part.questions = [];
            } else {
                // Parts 3, 4, 6, 7 có question groups
                part.questionGroups = [];
            }

            defaultParts.push(part);
        }

        const test = new TestModel({
            testTitle: data.testTitle,
            type: data.type || 'listening-reading',
            duration: data.duration || 120,
            number_of_questions: data.number_of_questions || 0,
            number_of_parts: data.number_of_parts || 7,
            parts: data.parts || defaultParts,
        });

        await test.save();
        return test;
    }

    /**
     * Get all tests with pagination
     */
    public async getAllTests(
        page: number = 1,
        limit: number = 10,
        search?: string
    ) {
        const query: Record<string, unknown> = { isDeleted: { $ne: true } };

        if (search) {
            query.testTitle = { $regex: search, $options: 'i' };
        }

        const skip = (page - 1) * limit;

        const [tests, total] = await Promise.all([
            TestModel.find(query)
                .select(
                    'testTitle type duration number_of_questions number_of_parts createdAt updatedAt'
                )
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            TestModel.countDocuments(query),
        ]);

        return {
            tests,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Get test by ID with full details
     */
    public async getTestById(testId: string): Promise<ITest> {
        if (!mongoose.Types.ObjectId.isValid(testId)) {
            throw new ApiError(ErrorMessage.INVALID_ID);
        }

        const test = await TestModel.findOne({
            _id: new ObjectId(testId),
            isDeleted: { $ne: true },
        });

        if (!test) {
            throw new ApiError(ErrorMessage.TEST_NOT_FOUND);
        }

        return test;
    }

    /**
     * Update test
     */
    public async updateTest(
        testId: string,
        data: UpdateTestDto
    ): Promise<ITest> {
        if (!mongoose.Types.ObjectId.isValid(testId)) {
            throw new ApiError(ErrorMessage.INVALID_ID);
        }

        const test = await TestModel.findOneAndUpdate(
            { _id: new ObjectId(testId), isDeleted: { $ne: true } },
            { $set: data },
            { new: true }
        );

        if (!test) {
            throw new ApiError(ErrorMessage.TEST_NOT_FOUND);
        }

        return test;
    }

    /**
     * Delete test (soft delete)
     */
    public async deleteTest(testId: string): Promise<void> {
        if (!mongoose.Types.ObjectId.isValid(testId)) {
            throw new ApiError(ErrorMessage.INVALID_ID);
        }

        const result = await TestModel.findOneAndUpdate(
            { _id: new ObjectId(testId), isDeleted: { $ne: true } },
            { $set: { isDeleted: true } },
            { new: true }
        );

        if (!result) {
            throw new ApiError(ErrorMessage.TEST_NOT_FOUND);
        }
    }

    /**
     * Parse Excel file and import questions
     */
    public async importFromExcel(
        testId: string,
        fileBuffer: Buffer
    ): Promise<ITest> {
        if (!mongoose.Types.ObjectId.isValid(testId)) {
            throw new ApiError(ErrorMessage.INVALID_ID);
        }

        const test = await TestModel.findOne({
            _id: new ObjectId(testId),
            isDeleted: { $ne: true },
        });

        if (!test) {
            throw new ApiError(ErrorMessage.TEST_NOT_FOUND);
        }

        // Parse Excel file
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json<ExcelQuestion>(worksheet);

        // Group questions by part
        const partMap = new Map<
            number,
            { questions: IQuestion[]; groups: Map<string, IQuestionGroup> }
        >();

        for (const row of rawData) {
            const partNum = row.partNumber;

            if (!partMap.has(partNum)) {
                partMap.set(partNum, { questions: [], groups: new Map() });
            }

            const partData = partMap.get(partNum)!;

            const question: IQuestion = {
                _id: new mongoose.Types.ObjectId(),
                questionNumber: row.questionNumber,
                questionText: row.questionText || null,
                options: [
                    { label: 'A', text: row.optionA || '' },
                    { label: 'B', text: row.optionB || '' },
                    { label: 'C', text: row.optionC || '' },
                    ...(row.optionD ? [{ label: 'D', text: row.optionD }] : []),
                ],
                correctAnswer: row.correctAnswer,
                explanation: row.explanation || '',
                media: {
                    audioUrl: row.audioUrl || null,
                    imageUrls: row.imageUrls
                        ? row.imageUrls.split(',').map((s) => s.trim())
                        : null,
                    passageHtml: row.passageHtml || null,
                    transcript: row.transcript || null,
                    translation: row.translation || null,
                },
                contentTags: {
                    difficulty: row.difficulty || 'B1',
                    domain: row.domain
                        ? row.domain.split(',').map((s) => s.trim())
                        : [],
                },
                skillTags: {
                    part: String(partNum),
                },
            };

            // Parts 1, 2, 5 have individual questions
            if ([1, 2, 5].includes(partNum)) {
                partData.questions.push(question);
            } else {
                // Parts 3, 4, 6, 7 have question groups
                const groupKey = row.groupId || `group_${row.questionNumber}`;

                if (!partData.groups.has(groupKey)) {
                    partData.groups.set(groupKey, {
                        _id: new mongoose.Types.ObjectId(),
                        groupContext: {
                            audioUrl: row.audioUrl || null,
                            imageUrls: row.imageUrls
                                ? row.imageUrls.split(',').map((s) => s.trim())
                                : null,
                            passageHtml: row.passageHtml || null,
                            transcript: row.transcript || null,
                            translation: row.translation || null,
                        },
                        questions: [],
                    });
                }

                const group = partData.groups.get(groupKey)!;
                question.groupId = group._id;
                group.questions.push(question);
            }
        }

        // Build parts array
        const parts: IPart[] = [];
        for (let i = 1; i <= 7; i++) {
            const partData = partMap.get(i);
            const part: IPart = {
                _id: new mongoose.Types.ObjectId(),
                partName: `Part ${i}`,
            };

            if ([1, 2, 5].includes(i)) {
                part.questions = partData?.questions || [];
            } else {
                part.questionGroups = partData
                    ? Array.from(partData.groups.values())
                    : [];
            }

            parts.push(part);
        }

        // Update test with imported parts
        test.parts = parts;
        test.number_of_questions = rawData.length;
        await test.save();

        return test;
    }

    /**
     * Add or update a single part
     */
    public async updatePart(
        testId: string,
        partNumber: number,
        partData: Partial<IPart>
    ): Promise<ITest> {
        if (!mongoose.Types.ObjectId.isValid(testId)) {
            throw new ApiError(ErrorMessage.INVALID_ID);
        }

        const test = await TestModel.findOne({
            _id: new ObjectId(testId),
            isDeleted: { $ne: true },
        });

        if (!test) {
            throw new ApiError(ErrorMessage.TEST_NOT_FOUND);
        }

        const partIndex = test.parts.findIndex(
            (p) => p.partName === `Part ${partNumber}`
        );

        if (partIndex === -1) {
            // Add new part
            test.parts.push({
                _id: new mongoose.Types.ObjectId(),
                partName: `Part ${partNumber}`,
                ...partData,
            });
        } else {
            // Update existing part
            test.parts[partIndex] = {
                ...test.parts[partIndex],
                ...partData,
            };
        }

        await test.save();
        return test;
    }

    /**
     * Get Excel template for import
     */
    public getExcelTemplate(): Buffer {
        const templateData = [
            {
                partNumber: 1,
                questionNumber: 1,
                questionText: '',
                optionA: 'Option A text',
                optionB: 'Option B text',
                optionC: 'Option C text',
                optionD: 'Option D text',
                correctAnswer: 'A',
                explanation: 'Explanation here',
                audioUrl: 'https://example.com/audio.mp3',
                imageUrls:
                    'https://example.com/image1.png,https://example.com/image2.png',
                passageHtml: '',
                transcript: 'Audio transcript',
                translation: '',
                groupId: '',
                difficulty: 'B1',
                domain: 'business,office',
            },
        ];

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(templateData);

        // Set column widths
        worksheet['!cols'] = [
            { wch: 12 }, // partNumber
            { wch: 15 }, // questionNumber
            { wch: 50 }, // questionText
            { wch: 30 }, // optionA
            { wch: 30 }, // optionB
            { wch: 30 }, // optionC
            { wch: 30 }, // optionD
            { wch: 15 }, // correctAnswer
            { wch: 50 }, // explanation
            { wch: 50 }, // audioUrl
            { wch: 50 }, // imageUrls
            { wch: 50 }, // passageHtml
            { wch: 50 }, // transcript
            { wch: 50 }, // translation
            { wch: 15 }, // groupId
            { wch: 12 }, // difficulty
            { wch: 30 }, // domain
        ];

        XLSX.utils.book_append_sheet(workbook, worksheet, 'Questions');

        return XLSX.write(workbook, {
            type: 'buffer',
            bookType: 'xlsx',
        }) as Buffer;
    }

    /**
     * Export test to Excel
     */
    public async exportToExcel(testId: string): Promise<Buffer> {
        const test = await this.getTestById(testId);
        const rows: ExcelQuestion[] = [];

        for (const part of test.parts) {
            const partNum = parseInt(part.partName.replace('Part ', ''));

            if (part.questions) {
                for (const q of part.questions) {
                    rows.push({
                        partNumber: partNum,
                        questionNumber: q.questionNumber,
                        questionText: q.questionText || '',
                        optionA: q.options[0]?.text || '',
                        optionB: q.options[1]?.text || '',
                        optionC: q.options[2]?.text || '',
                        optionD: q.options[3]?.text || '',
                        correctAnswer: q.correctAnswer,
                        explanation: q.explanation || '',
                        audioUrl: q.media?.audioUrl || '',
                        imageUrls: q.media?.imageUrls?.join(',') || '',
                        passageHtml: q.media?.passageHtml || '',
                        transcript: q.media?.transcript || '',
                        translation: q.media?.translation || '',
                        groupId: '',
                        difficulty: q.contentTags?.difficulty || '',
                        domain: q.contentTags?.domain?.join(',') || '',
                    });
                }
            }

            if (part.questionGroups) {
                for (const group of part.questionGroups) {
                    for (const q of group.questions) {
                        rows.push({
                            partNumber: partNum,
                            questionNumber: q.questionNumber,
                            questionText: q.questionText || '',
                            optionA: q.options[0]?.text || '',
                            optionB: q.options[1]?.text || '',
                            optionC: q.options[2]?.text || '',
                            optionD: q.options[3]?.text || '',
                            correctAnswer: q.correctAnswer,
                            explanation: q.explanation || '',
                            audioUrl: group.groupContext?.audioUrl || '',
                            imageUrls:
                                group.groupContext?.imageUrls?.join(',') || '',
                            passageHtml: group.groupContext?.passageHtml || '',
                            transcript: group.groupContext?.transcript || '',
                            translation: group.groupContext?.translation || '',
                            groupId: group._id?.toString() || '',
                            difficulty: q.contentTags?.difficulty || '',
                            domain: q.contentTags?.domain?.join(',') || '',
                        });
                    }
                }
            }
        }

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Questions');

        return XLSX.write(workbook, {
            type: 'buffer',
            bookType: 'xlsx',
        }) as Buffer;
    }
}

export default new AdminTestService();
