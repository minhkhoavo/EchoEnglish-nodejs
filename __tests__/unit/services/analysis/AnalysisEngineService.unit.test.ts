/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { Types } from 'mongoose';
import {
    AnalysisEngineService,
    analysisEngineService,
} from '~/services/analysis/AnalysisEngineService.js';
import { TestResult } from '~/models/testResultModel.js';
import testService from '~/services/testService.js';
import { roadmapMistakeService } from '~/services/recommendation/RoadmapMistakeService.js';
import { SkillCategory } from '~/enum/skillCategory.js';
import { Roadmap } from '~/models/roadmapModel.js';
import { roadmapService } from '~/services/recommendation/RoadmapService.js';

jest.mock('~/models/testResultModel.js');
jest.mock('~/services/testService.js');
jest.mock('~/services/recommendation/RoadmapMistakeService.js');
jest.mock('~/services/recommendation/RoadmapService.js');
jest.mock('~/models/roadmapModel.js', () => ({
    Roadmap: {
        findOne: jest.fn(),
    },
}));

const mockTestResult = TestResult as jest.Mocked<typeof TestResult>;
const mockTestService = testService as jest.Mocked<typeof testService>;
const mockRoadmapMistakeService = roadmapMistakeService as jest.Mocked<
    typeof roadmapMistakeService
>;
const mockRoadmap = Roadmap as jest.Mocked<typeof Roadmap>;

describe('AnalysisEngineService', () => {
    let service: AnalysisEngineService;
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new AnalysisEngineService();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (consoleWarnSpy) consoleWarnSpy.mockRestore();
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
    });

    describe('getAnalysisResult / getAnalysisById', () => {
        it('should return result by id', async () => {
            (mockTestResult.findById as any) = jest
                .fn()
                .mockResolvedValue({ _id: '123' });
            const result1 = await service.getAnalysisResult('123');
            const result2 = await service.getAnalysisById('123');
            expect(result1).toEqual({ _id: '123' });
            expect(result2).toEqual({ _id: '123' });
        });
    });

    describe('deleteAnalysis', () => {
        it('should return true if updated', async () => {
            (mockTestResult.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue({ _id: '123' });
            const result = await service.deleteAnalysis('123');
            expect(result).toBe(true);
        });

        it('should return false if not found', async () => {
            (mockTestResult.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue(null);
            const result = await service.deleteAnalysis('123');
            expect(result).toBe(false);
        });
    });

    describe('normalizeSkillKey', () => {
        it('should return key as is if no underscore', () => {
            expect((service as any).normalizeSkillKey('camelCase')).toBe(
                'camelCase'
            );
        });
        it('should convert snake_case to camelCase', () => {
            expect((service as any).normalizeSkillKey('snake_case_key')).toBe(
                'snakeCaseKey'
            );
        });
    });

    describe('getSkillDisplayName', () => {
        it('should return title case for uppercase keys', () => {
            expect((service as any).getSkillDisplayName('GIST')).toBe('Gist');
        });
        it('should return title case for camelCase keys', () => {
            expect((service as any).getSkillDisplayName('camelCaseKey')).toBe(
                'Camel Case Key'
            );
        });
    });

    describe('extractPartNumberFromMeta', () => {
        it('should extract part number from part string', () => {
            expect(
                (service as any).extractPartNumberFromMeta({ part: 'part 1' })
            ).toBe(1);
        });
        it('should fallback to questionNumber ranges if part string does not match regex', () => {
            expect(
                (service as any).extractPartNumberFromMeta({
                    part: 'invalid part format',
                    questionNumber: 5,
                })
            ).toBe(1);
        });
        it('should fallback to questionNumber ranges', () => {
            expect(
                (service as any).extractPartNumberFromMeta({
                    questionNumber: 1,
                })
            ).toBe(1);
            expect(
                (service as any).extractPartNumberFromMeta({
                    questionNumber: 7,
                })
            ).toBe(2);
            expect(
                (service as any).extractPartNumberFromMeta({
                    questionNumber: 32,
                })
            ).toBe(3);
            expect(
                (service as any).extractPartNumberFromMeta({
                    questionNumber: 71,
                })
            ).toBe(4);
            expect(
                (service as any).extractPartNumberFromMeta({
                    questionNumber: 101,
                })
            ).toBe(5);
            expect(
                (service as any).extractPartNumberFromMeta({
                    questionNumber: 131,
                })
            ).toBe(6);
            expect(
                (service as any).extractPartNumberFromMeta({
                    questionNumber: 147,
                })
            ).toBe(7);
            expect(
                (service as any).extractPartNumberFromMeta({
                    questionNumber: 201,
                })
            ).toBe(0);
        });
    });

    describe('extractDifficultyFromMeta', () => {
        it('should extract difficulty from raw if string', () => {
            expect(
                (service as any).extractDifficultyFromMeta({
                    raw: { difficulty: 'hard' },
                })
            ).toBe('hard');
        });
        it('should default to medium', () => {
            expect(
                (service as any).extractDifficultyFromMeta({ raw: {} })
            ).toBe('medium');
            expect((service as any).extractDifficultyFromMeta({})).toBe(
                'medium'
            );
        });
    });

    describe('extractContentTagsFromMeta', () => {
        it('should extract array content tags and filter non-strings', () => {
            expect(
                (service as any).extractContentTagsFromMeta({
                    contentTags: ['a', 1, 'b', null],
                })
            ).toEqual(['a', 'b']);
        });
        it('should extract object content tags and filter non-strings', () => {
            expect(
                (service as any).extractContentTagsFromMeta({
                    contentTags: { t1: 'a', t2: 'b', t3: 1, t4: {} },
                })
            ).toEqual(['a', 'b']);
        });
        it('should return empty if no content tags', () => {
            expect((service as any).extractContentTagsFromMeta({})).toEqual([]);
        });
        it('should ignore contentTags if it is primitive type (string/number)', () => {
            expect(
                (service as any).extractContentTagsFromMeta({
                    contentTags: 'string tags',
                })
            ).toEqual([]);
        });
    });

    describe('extractSkillTagFromMeta', () => {
        it('should return undefined if no skillTags', () => {
            expect(
                (service as any).extractSkillTagFromMeta({})
            ).toBeUndefined();
            expect(
                (service as any).extractSkillTagFromMeta({
                    skillTags: 'not object',
                })
            ).toBeUndefined();
        });
        it('should return skillCategory if present', () => {
            expect(
                (service as any).extractSkillTagFromMeta({
                    skillTags: { skillCategory: 'cat' },
                })
            ).toBe('cat');
        });
        it('should return skillDetail if present', () => {
            expect(
                (service as any).extractSkillTagFromMeta({
                    skillTags: { skillDetail: 'det' },
                })
            ).toBe('det');
        });
        it('should return questionFunction if present', () => {
            expect(
                (service as any).extractSkillTagFromMeta({
                    skillTags: { questionFunction: 'qf' },
                })
            ).toBe('qf');
        });
        it('should return grammarPoint if present', () => {
            expect(
                (service as any).extractSkillTagFromMeta({
                    skillTags: { grammarPoint: 'gp' },
                })
            ).toBe('gp');
        });
        it('should return vocabPoint if present', () => {
            expect(
                (service as any).extractSkillTagFromMeta({
                    skillTags: { vocabPoint: 'vp' },
                })
            ).toBe('vp');
        });
        it('should return undefined if all fallback fields are falsy', () => {
            expect(
                (service as any).extractSkillTagFromMeta({
                    skillTags: {
                        questionFunction: '',
                        grammarPoint: '',
                        vocabPoint: '',
                    },
                })
            ).toBeUndefined();
        });
    });

    describe('extractQuestionText', () => {
        it('should extract from questionText', () => {
            expect(
                (service as any).extractQuestionText({
                    raw: { questionText: 'q' },
                })
            ).toBe('q');
        });
        it('should extract from passage', () => {
            expect(
                (service as any).extractQuestionText({ raw: { passage: 'p' } })
            ).toBe('p');
        });
        it('should extract from text', () => {
            expect(
                (service as any).extractQuestionText({ raw: { text: 't' } })
            ).toBe('t');
        });
        it('should return undefined if not string', () => {
            expect(
                (service as any).extractQuestionText({ raw: { text: 1 } })
            ).toBeUndefined();
            expect((service as any).extractQuestionText({})).toBeUndefined();
        });
        it('should fallback to undefined if questionText, passage, text are all missing', () => {
            expect(
                (service as any).extractQuestionText({
                    raw: { otherField: 'val' },
                })
            ).toBeUndefined();
        });
    });

    describe('extractSkillKey', () => {
        it('should prioritize skillCategory for part 3,4,7', () => {
            const meta = {
                part: 'part 3',
                skillTags: { skillCategory: 'cat3' },
            };
            expect((service as any).extractSkillKey(meta)).toBe('cat3');
        });

        it('should fallback to skillDetail for part 3,4,7', () => {
            const meta = {
                part: 'part 4',
                skillTags: { skillDetail: 'det_4' },
            };
            expect((service as any).extractSkillKey(meta)).toBe('det_4');
        });

        it('should handle part 1 with skills array', () => {
            const meta = {
                part: 'part1',
                skillTags: { skills: ['first_skill'] },
            };
            expect((service as any).extractSkillKey(meta)).toBe('firstSkill');
        });

        it('should handle part 1 without skills array', () => {
            const meta = { part: 'part 1' };
            expect((service as any).extractSkillKey(meta)).toBe(
                SkillCategory.OTHERS
            );
        });

        it('should handle part 2 with questionFunction', () => {
            const meta1 = {
                part: 'part2',
                skillTags: { questionFunction: 'informationSeeking' },
            };
            expect((service as any).extractSkillKey(meta1)).toBe(
                SkillCategory.DETAIL
            );

            const meta2 = {
                part: 'part 2',
                skillTags: { questionFunction: 'request' },
            };
            expect((service as any).extractSkillKey(meta2)).toBe(
                SkillCategory.SPECIFIC_ACTION
            );

            const meta3 = {
                part: 'part2',
                skillTags: { questionFunction: 'other_func' },
            };
            expect((service as any).extractSkillKey(meta3)).toBe('otherFunc');
        });

        it('should handle part 2 with questionForm', () => {
            const meta = {
                part: 'part2',
                skillTags: { questionForm: 'form_q' },
            };
            expect((service as any).extractSkillKey(meta)).toBe('formQ');
        });

        it('should handle part 2 with nothing', () => {
            const meta = { part: 'part 2' };
            expect((service as any).extractSkillKey(meta)).toBe(
                SkillCategory.OTHERS
            );
        });

        it('should handle part 5 with grammarPoint', () => {
            const meta = {
                part: 'part 5',
                skillTags: { grammarPoint: 'gram_point' },
            };
            expect((service as any).extractSkillKey(meta)).toBe('gramPoint');
        });

        it('should handle part 5 with vocabPoint', () => {
            const meta = {
                part: 'part 5',
                skillTags: { vocabPoint: 'vocab_point' },
            };
            expect((service as any).extractSkillKey(meta)).toBe('vocabPoint');
        });

        it('should handle part 5 with nothing', () => {
            const meta = { part: 'part5' };
            expect((service as any).extractSkillKey(meta)).toBe(
                SkillCategory.OTHERS
            );
        });

        it('should handle part 6 grammar tagType', () => {
            const meta1 = {
                part: 'part 6',
                skillTags: { tagType: 'grammar', grammarPoint: 'gp' },
            };
            expect((service as any).extractSkillKey(meta1)).toBe('gp');

            const meta2 = { part: 'part6', skillTags: { tagType: 'grammar' } };
            expect((service as any).extractSkillKey(meta2)).toBe(
                SkillCategory.GRAMMAR
            );
        });

        it('should handle part 6 vocabulary tagType', () => {
            const meta1 = {
                part: 'part 6',
                skillTags: { tagType: 'vocabulary', vocabPoint: 'vp' },
            };
            expect((service as any).extractSkillKey(meta1)).toBe('vp');

            const meta2 = {
                part: 'part6',
                skillTags: { tagType: 'vocabulary' },
            };
            expect((service as any).extractSkillKey(meta2)).toBe(
                SkillCategory.VOCABULARY
            );
        });

        it('should handle part 6 specific tagTypes', () => {
            const meta1 = {
                part: 'part 6',
                skillTags: { tagType: 'sentence_insertion' },
            };
            expect((service as any).extractSkillKey(meta1)).toBe(
                'sentenceInsertion'
            );

            const meta2 = {
                part: 'part6',
                skillTags: { tagType: 'sentenceInsertion' },
            };
            expect((service as any).extractSkillKey(meta2)).toBe(
                'sentenceInsertion'
            );

            const meta3 = {
                part: 'part 6',
                skillTags: { tagType: 'discourse_connector' },
            };
            expect((service as any).extractSkillKey(meta3)).toBe(
                SkillCategory.COHESION
            );

            const meta4 = {
                part: 'part6',
                skillTags: { tagType: 'discourseConnector' },
            };
            expect((service as any).extractSkillKey(meta4)).toBe(
                SkillCategory.COHESION
            );

            const meta5 = { part: 'part6', skillTags: { tagType: 'unknown' } };
            expect((service as any).extractSkillKey(meta5)).toBe(
                SkillCategory.OTHERS
            );
        });

        it('should handle part 6 without tagType', () => {
            const meta = { part: 'part6' };
            expect((service as any).extractSkillKey(meta)).toBe(
                SkillCategory.OTHERS
            );
        });

        it('should default to OTHERS for unknown part', () => {
            const meta = { part: 'part unknown' };
            expect((service as any).extractSkillKey(meta)).toBe(
                SkillCategory.OTHERS
            );
        });
    });

    describe('extractAndAddMistakes', () => {
        const mockTestResult = {
            userId: 'user1',
            userAnswers: [
                { questionNumber: 1, isCorrect: false },
                { questionNumber: 2, isCorrect: true },
            ],
        };
        const mockMeta = [
            {
                questionNumber: 1,
                questionId: 'q1',
                raw: { text: 'question 1 text', difficulty: 'hard' },
                skillTags: { skillCategory: 'grammar' },
                contentTags: ['tag1'],
                part: 'part 5',
            },
        ];

        it('should skip if no active roadmap found', async () => {
            mockRoadmap.findOne.mockResolvedValueOnce(null);
            await (service as any).extractAndAddMistakes(
                mockTestResult,
                mockMeta
            );
            expect(
                mockRoadmapMistakeService.addMultipleMistakes
            ).not.toHaveBeenCalled();
        });

        it('should skip if no wrong answers', async () => {
            mockRoadmap.findOne.mockResolvedValueOnce({
                currentWeek: 1,
                status: 'active',
            });
            await (service as any).extractAndAddMistakes(
                {
                    ...mockTestResult,
                    userAnswers: [{ questionNumber: 1, isCorrect: true }],
                },
                mockMeta
            );
            expect(
                mockRoadmapMistakeService.addMultipleMistakes
            ).not.toHaveBeenCalled();
        });

        it('should extract and add mistakes successfully', async () => {
            mockRoadmap.findOne.mockResolvedValueOnce({
                currentWeek: 1,
                status: 'active',
            });
            mockRoadmapMistakeService.addMultipleMistakes.mockResolvedValueOnce(
                { addedCount: 1 } as any
            );

            await (service as any).extractAndAddMistakes(
                mockTestResult,
                mockMeta
            );

            expect(
                mockRoadmapMistakeService.addMultipleMistakes
            ).toHaveBeenCalledWith('user1', [
                {
                    questionId: 'q1',
                    questionText: 'question 1 text',
                    contentTags: ['tag1'],
                    skillTag: 'grammar',
                    partNumber: 5,
                    difficulty: 'hard',
                },
            ]);
        });

        it('should handle error internally without throwing', async () => {
            mockRoadmap.findOne.mockRejectedValueOnce(new Error('db error'));
            await expect(
                (service as any).extractAndAddMistakes(mockTestResult, mockMeta)
            ).resolves.toBeUndefined();
        });

        it('should handle missing questionMeta and fallback questionText', async () => {
            mockRoadmap.findOne.mockResolvedValueOnce({
                currentWeek: 1,
                status: 'active',
            });
            mockRoadmapMistakeService.addMultipleMistakes.mockResolvedValueOnce(
                { addedCount: 1 } as any
            );

            const localTr = {
                userId: 'u1',
                userAnswers: [
                    { questionNumber: 1, isCorrect: false }, // meta exists but no raw text
                    { questionNumber: 2, isCorrect: false }, // no meta exists
                ],
            };
            const localMeta = [
                { questionNumber: 1, questionId: 'q1' }, // missing raw, skillTags, contentTags, part
            ];

            await (service as any).extractAndAddMistakes(localTr, localMeta);
            expect(
                mockRoadmapMistakeService.addMultipleMistakes
            ).toHaveBeenCalledWith('u1', [
                {
                    questionId: 'q1',
                    questionText: 'Question 1', // fallback
                    contentTags: [],
                    skillTag: undefined,
                    partNumber: 1, // fallback based on questionNumber 1
                    difficulty: 'medium', // fallback
                },
            ]);
        });

        it('should handle undefined currentWeek', async () => {
            (mockRoadmap.findOne as jest.Mock).mockResolvedValue({
                // missing currentWeek to hit line 507 fallback
            });
            mockRoadmapMistakeService.addMultipleMistakes.mockResolvedValue({
                success: true,
                message: 'ok',
                addedCount: 1,
            });

            await (analysisEngineService as any).extractAndAddMistakes(
                {
                    userId: 'u1',
                    userAnswers: [{ questionNumber: 1, isCorrect: false }],
                } as any,
                [
                    {
                        questionNumber: 1,
                        questionId: 'q1',
                        raw: { questionText: 'text' },
                    },
                ] as any[]
            );
            expect(
                mockRoadmapMistakeService.addMultipleMistakes
            ).toHaveBeenCalled();
        });

        it('should handle empty mistakes when no metadata matches wrong answers', async () => {
            (mockRoadmap.findOne as jest.Mock).mockResolvedValue({
                currentWeek: 1,
            });
            // no metadata matched -> mistakes.length = 0 (hits line 535 false)
            await (analysisEngineService as any).extractAndAddMistakes(
                {
                    userId: 'u1',
                    userAnswers: [{ questionNumber: 1, isCorrect: false }],
                } as any,
                [] as any[]
            );
            expect(
                mockRoadmapMistakeService.addMultipleMistakes
            ).not.toHaveBeenCalled();
        });
    });

    describe('calculateOverallSkills', () => {
        it('should calculate accuracy for overall skills', async () => {
            const tr = {
                userAnswers: [
                    { questionNumber: 1, isCorrect: true },
                    { questionNumber: 2, isCorrect: false },
                    { questionNumber: 3, isCorrect: true },
                ],
            };
            const meta = [
                {
                    questionNumber: 1,
                    skillTags: { skillCategory: SkillCategory.GRAMMAR },
                },
                {
                    questionNumber: 2,
                    skillTags: { skillCategory: SkillCategory.GRAMMAR },
                },
                {
                    questionNumber: 3,
                    skillTags: { skillCategory: SkillCategory.VOCABULARY },
                },
            ];

            const result = await service.calculateOverallSkills(
                tr as any,
                meta as any
            );
            expect(result[SkillCategory.GRAMMAR]).toEqual({
                accuracy: 50,
                correct: 1,
                total: 2,
            });
            expect(result[SkillCategory.VOCABULARY]).toEqual({
                accuracy: 100,
                correct: 1,
                total: 1,
            });
        });

        it('should ignore answers without meta', async () => {
            const tr = {
                userAnswers: [{ questionNumber: 1, isCorrect: true }],
            };
            const result = await service.calculateOverallSkills(tr as any, []);
            expect(Object.keys(result).length).toBe(0);
        });

        it('should skip category if not in skillStats map', async () => {
            const tr = {
                userAnswers: [{ questionNumber: 1, isCorrect: true }],
            };
            const meta = [
                {
                    questionNumber: 1,
                    skillTags: { skillDetail: 'CustomUnknownSkill' },
                },
            ];
            // This category is not in Object.values(SkillCategory)
            const result = await service.calculateOverallSkills(
                tr as any,
                meta as any
            );
            expect(Object.keys(result).length).toBe(0);
        });
    });

    describe('analyzeByPart', () => {
        it('should calculate accuracy and group by skills for parts, hitting existing map branches', async () => {
            const tr = {
                userAnswers: [
                    { questionNumber: 1, isCorrect: true },
                    { questionNumber: 2, isCorrect: false },
                    { questionNumber: 3, isCorrect: true }, // same part and skill to hit 'has' true branch
                    { questionNumber: 4, isCorrect: false }, // for meta.raw?.partName
                    { questionNumber: 5, isCorrect: false }, // for unknown
                    { questionNumber: 8, isCorrect: true }, // empty part string
                    { questionNumber: 9, isCorrect: true }, // empty raw partName string
                ],
            };
            const meta = [
                {
                    questionNumber: 1,
                    raw: { partName: 'part5' },
                    skillTags: { skillCategory: SkillCategory.GRAMMAR },
                },
                {
                    questionNumber: 2,
                    part: 'part5',
                    skillTags: { skillCategory: SkillCategory.VOCABULARY },
                },
                {
                    questionNumber: 3,
                    part: 'part5',
                    skillTags: { skillCategory: SkillCategory.GRAMMAR },
                },
                { questionNumber: 4, raw: { partName: 'part4' } }, // hits meta.raw?.partName
                { questionNumber: 5 }, // hits unknown
                { questionNumber: 8, part: '' }, // hits empty part string
                { questionNumber: 9, raw: { partName: '' } }, // hits empty raw partName
            ];

            const result = await service.analyzeByPart(tr as any, meta as any);
            expect(result).toHaveLength(3);

            // Just test the first part 'part5' remains accurate
            const part5 = result.find((r) => r.part === 'part5')!;
            expect(part5.accuracy).toBe(67);
            expect(part5.correct).toBe(2);
            expect(part5.total).toBe(3);
            expect(part5.skillBreakdown).toHaveLength(2);
        });

        it('should skip answers without meta', async () => {
            const tr = {
                userAnswers: [{ questionNumber: 1, isCorrect: true }],
            };
            const result = await service.analyzeByPart(tr as any, []);
            expect(result).toHaveLength(0);
        });
    });

    describe('analyzeTestResult', () => {
        const mockTestResultId = new Types.ObjectId().toString();

        it('should throw if TestResult not found', async () => {
            (mockTestResult.findById as any) = jest
                .fn()
                .mockResolvedValue(null);
            await expect(
                service.analyzeTestResult(mockTestResultId)
            ).rejects.toThrow(/TestResult not found/);
        });

        it('should throw if test definition not found', async () => {
            (mockTestResult.findById as any) = jest
                .fn()
                .mockResolvedValue({ testId: 't1' });
            mockTestService.getTestById.mockResolvedValueOnce(null as any);
            await expect(
                service.analyzeTestResult(mockTestResultId)
            ).rejects.toThrow(/Test definition not found/);
        });

        it('should analyze correctly with part questions and questionGroups', async () => {
            const testDef = {
                parts: [
                    {
                        partName: 'Part 1',
                        questions: [
                            {
                                _id: 'q1',
                                questionNumber: 1,
                                skillTags: { part: 'part1' },
                                contentTags: ['a'],
                            },
                            {
                                _id: 'q5',
                                questionNumber: 5,
                                skillTags: { part: 'part1' },
                            }, // not answered, hits line 71 false
                        ],
                    },
                    {
                        // partName undefined to hit fallback
                        questionGroups: [
                            {
                                questions: [
                                    {
                                        _id: 'q2',
                                        questionNumber: 2,
                                        skillTags: { part: 'part7' },
                                        contentTags: ['b'],
                                    },
                                    {
                                        _id: 'q3',
                                        questionNumber: 3,
                                        part: 'p3',
                                        contentTags: ['c'],
                                    }, // Hit q.part
                                    {
                                        _id: 'q4',
                                        questionNumber: 4,
                                        partName: 'p4',
                                        contentTags: ['d'],
                                    }, // Hit q.partName
                                    {
                                        _id: 'q6',
                                        questionNumber: 6,
                                        contentTags: ['e'],
                                    }, // Hit unknown
                                    { _id: 'q7', questionNumber: 7 }, // No contentTags, no part => hits line 106 and 251 unknown
                                ],
                            },
                        ],
                    },
                ],
            };
            const tr = {
                _id: mockTestResultId,
                testId: 't1',
                listeningScore: 10,
                readingScore: 20,
                userAnswers: [
                    { questionNumber: 1, isCorrect: true },
                    { questionNumber: 2, isCorrect: false },
                    { questionNumber: 3, isCorrect: true },
                    { questionNumber: 4, isCorrect: true },
                    { questionNumber: 6, isCorrect: false },
                    { questionNumber: 7, isCorrect: true },
                ],
            };

            (mockTestResult.findById as any) = jest.fn().mockResolvedValue(tr);
            mockTestService.getTestById.mockResolvedValueOnce(testDef as any);

            // Mock the update
            (mockTestResult.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue({ ...tr, updated: true });

            // Spy on internal methods to avoid testing them again, we already have unit tests for them
            const extractAndAddMistakesSpy = jest
                .spyOn(service as any, 'extractAndAddMistakes')
                .mockResolvedValue(undefined);

            const result = await service.analyzeTestResult(mockTestResultId);

            expect(mockTestResult.findByIdAndUpdate).toHaveBeenCalled();
            const updateArgs = (mockTestResult.findByIdAndUpdate as any).mock
                .calls[0][1];
            expect(updateArgs['analysis.examAnalysis']).toBeDefined();
            expect(result).toHaveProperty('updated', true);

            extractAndAddMistakesSpy.mockRestore();
        });

        it('should handle undefined parts gracefully', async () => {
            const tr = {
                _id: mockTestResultId,
                testId: 't1',
                userAnswers: [],
            };
            const testDef = {
                parts: undefined,
            };

            (mockTestResult.findById as any) = jest.fn().mockResolvedValue(tr);
            mockTestService.getTestById.mockResolvedValueOnce(testDef as any);
            (mockTestResult.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue(tr);
            jest.spyOn(
                service as any,
                'extractAndAddMistakes'
            ).mockResolvedValue(undefined);

            const result = await service.analyzeTestResult(mockTestResultId);
            expect(result).toBeDefined();
        });

        it('should hit fallback branches in part extraction and calculation', async () => {
            const tr = {
                _id: mockTestResultId,
                testId: 't1',
                // missing scores to hit ?? 0
                userAnswers: [{ questionNumber: 1, isCorrect: true }],
            };
            const testDef = {
                parts: [
                    {
                        partName: undefined, // undefined partName
                        questions: [
                            {
                                _id: 'q1',
                                questionNumber: 1,
                                part: undefined,
                                partName: undefined,
                                skillTags: undefined,
                            },
                        ],
                    },
                    {
                        questionGroups: [
                            {
                                questions: [
                                    { _id: 'q3', questionNumber: 3 }, // questionNumber not in answeredQuestionNumbers
                                ],
                            },
                            {
                                questions: undefined, // test Array.isArray(group.questions) fallback
                            },
                        ],
                    },
                    {
                        // empty part testing neither questions nor questionGroups
                    },
                ],
            };

            (mockTestResult.findById as any) = jest.fn().mockResolvedValue(tr);
            mockTestService.getTestById.mockResolvedValueOnce(testDef as any);
            (mockTestResult.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue({ ...tr, updated: true });

            const extractSpy = jest
                .spyOn(service as any, 'extractAndAddMistakes')
                .mockResolvedValue(undefined);

            const originalAnalyzeByPart = service.analyzeByPart;
            // Mock analyzeByPart to return partial data to hit fallback mapping branches
            jest.spyOn(service as any, 'analyzeByPart').mockResolvedValue([
                {
                    part: 'part1',
                    skillBreakdown: [
                        {
                            skillName: 'sk1',
                            skillKey: 'k1',
                            // missing properties
                        },
                    ],
                    // missing properties
                },
                {
                    part: 'part2',
                    skillBreakdown: null, // test skillBreakdown fallback
                },
            ]);

            await service.analyzeTestResult(mockTestResultId);

            extractSpy.mockRestore();
            service.analyzeByPart = originalAnalyzeByPart;
        });
    });
});
