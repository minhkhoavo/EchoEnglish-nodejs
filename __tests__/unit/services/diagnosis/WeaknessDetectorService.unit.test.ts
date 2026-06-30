/* eslint-disable @typescript-eslint/no-explicit-any */
import { WeaknessDetectorService } from '~/services/diagnosis/WeaknessDetectorService.js';
import { TestResult } from '~/models/testResultModel.js';
import { QuestionMetadata } from '~/models/questionMetadataModel.js';
import { toeicAnalysisAIService } from '~/ai/service/toeicAnalysisAIService.js';
import { SkillCategory } from '~/enum/skillCategory.js';

jest.mock('~/models/testResultModel.js');
jest.mock('~/models/questionMetadataModel.js');
jest.mock('~/ai/service/toeicAnalysisAIService.js');
jest.mock('~/ai/provider/googleGenAIClient.js');

const mockTestResult = TestResult as jest.Mocked<typeof TestResult>;
const mockToeicAnalysisAIService = toeicAnalysisAIService as jest.Mocked<
    typeof toeicAnalysisAIService
>;

describe('WeaknessDetectorService', () => {
    let service: WeaknessDetectorService;
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new WeaknessDetectorService();
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

    describe('determineUserLevel', () => {
        it('should return advanced for >= 85%', () => {
            expect((service as any).determineUserLevel(85, 100)).toBe(
                'advanced'
            );
            expect((service as any).determineUserLevel(90, 100)).toBe(
                'advanced'
            );
        });

        it('should return intermediate for >= 70%', () => {
            expect((service as any).determineUserLevel(70, 100)).toBe(
                'intermediate'
            );
            expect((service as any).determineUserLevel(84, 100)).toBe(
                'intermediate'
            );
        });

        it('should return beginner for < 70%', () => {
            expect((service as any).determineUserLevel(69, 100)).toBe(
                'beginner'
            );
            expect((service as any).determineUserLevel(0, 100)).toBe(
                'beginner'
            );
        });
    });

    describe('getBenchmarkAccuracy', () => {
        it('should return benchmark from data if exists', () => {
            expect(
                (service as any).getBenchmarkAccuracy(
                    SkillCategory.GIST,
                    'beginner'
                )
            ).toBe(55);
            expect(
                (service as any).getBenchmarkAccuracy('mainTopic', 'advanced')
            ).toBe(88);
        });

        it('should return 60 as fallback if skillKey or level not found', () => {
            expect(
                (service as any).getBenchmarkAccuracy(
                    'unknownSkill',
                    'beginner'
                )
            ).toBe(60);
            expect(
                (service as any).getBenchmarkAccuracy(
                    SkillCategory.GIST,
                    'unknownLevel'
                )
            ).toBe(60);
        });
    });

    describe('formatCategoryName', () => {
        it('should return General if category is falsy', () => {
            expect((service as any).formatCategoryName('')).toBe('General');
            expect((service as any).formatCategoryName(null)).toBe('General');
        });

        it('should format camelCase correctly', () => {
            expect((service as any).formatCategoryName('mainTopic')).toBe(
                'Main Topic'
            );
            expect(
                (service as any).formatCategoryName('identifyActionInProgress')
            ).toBe('Identify Action In Progress');
        });
    });

    describe('aggregateSkillPerformance', () => {
        it('should aggregate from partAnalyses and sort by accuracyGap', () => {
            const examAnalysis = {
                partAnalyses: [
                    {
                        partNumber: '1',
                        skillBreakdown: [
                            {
                                skillKey: SkillCategory.GIST,
                                skillName: 'Gist',
                                total: 10,
                                correct: 5,
                            }, // 50% user, 55% bench (beginner) -> gap: 5
                        ],
                    },
                    {
                        partNumber: '2',
                        skillBreakdown: [
                            {
                                skillKey: SkillCategory.DETAIL,
                                skillName: 'Detail',
                                total: 10,
                                correct: 2,
                            }, // 20% user, 50% bench (beginner) -> gap: 30
                            {
                                skillKey: SkillCategory.GIST,
                                skillName: 'Gist',
                                total: 10,
                                correct: 6,
                            }, // combined Gist: 11/20 = 55% user. bench 55% -> gap: 0
                        ],
                    },
                ],
            };

            const result = (service as any).aggregateSkillPerformance(
                examAnalysis,
                'beginner'
            );

            expect(result).toHaveLength(2);
            // Sorted by gap descending, so Detail (30) first, Gist (0) second
            expect(result[0].skillKey).toBe(SkillCategory.DETAIL);
            expect(result[0].accuracyGap).toBe(30);
            expect(result[0].affectedParts).toEqual(['2']);

            expect(result[1].skillKey).toBe(SkillCategory.GIST);
            expect(result[1].accuracyGap).toBeCloseTo(0); // 55 - 55
            expect(result[1].total).toBe(20);
            expect(result[1].correct).toBe(11);
            expect(result[1].affectedParts).toEqual(['1', '2']);
        });

        it('should handle undefined partAnalyses gracefully', () => {
            expect(
                (service as any).aggregateSkillPerformance({}, 'beginner')
            ).toEqual([]);
            expect(
                (service as any).aggregateSkillPerformance(
                    { partAnalyses: undefined },
                    'beginner'
                )
            ).toEqual([]);
        });

        it('should handle missing skillBreakdown gracefully', () => {
            const examAnalysis = {
                partAnalyses: [{ partNumber: '1', skillBreakdown: undefined }],
            };
            expect(
                (service as any).aggregateSkillPerformance(
                    examAnalysis,
                    'beginner'
                )
            ).toEqual([]);
        });
    });

    describe('aggregateDomainPerformanceFromTest', () => {
        let mockDb: any;
        let mockCollection: any;
        let mockFindOne: jest.Mock;

        beforeEach(() => {
            mockFindOne = jest.fn();
            mockCollection = { findOne: mockFindOne };
            mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
        });

        it('should return empty array if no database connection', async () => {
            Object.defineProperty(QuestionMetadata, 'db', {
                value: undefined,
                configurable: true,
            });
            const result = await (
                service as any
            ).aggregateDomainPerformanceFromTest({});
            expect(result).toEqual([]);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[aggregateDomainPerformance] No database connection'
            );
        });

        it('should return empty array if test not found or has no parts', async () => {
            Object.defineProperty(QuestionMetadata, 'db', {
                value: mockDb,
                configurable: true,
            });
            mockFindOne.mockResolvedValueOnce(null);

            const result = await (
                service as any
            ).aggregateDomainPerformanceFromTest({ testId: 't1' });
            expect(result).toEqual([]);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[aggregateDomainPerformance] Test not found or has no parts'
            );

            mockFindOne.mockResolvedValueOnce({ _id: 't1', parts: undefined });
            const result2 = await (
                service as any
            ).aggregateDomainPerformanceFromTest({ testId: 't1' });
            expect(result2).toEqual([]);
        });

        it('should aggregate domain performance correctly from questions and questionGroups', async () => {
            Object.defineProperty(QuestionMetadata, 'db', {
                value: mockDb,
                configurable: true,
            });
            const testDef = {
                parts: [
                    {
                        // Part 1 - direct questions
                        questions: [
                            { contentTags: { domain: ['domain1'] } },
                            { contentTags: { domain: ['domain2'] } },
                            { contentTags: undefined }, // Hit 276-281 false
                            { contentTags: {} }, // Hit 276-281 false
                        ],
                        questionGroups: [
                            {
                                questions: [
                                    {
                                        contentTags: {
                                            domain: ['domain1', 'domain3'],
                                        },
                                    },
                                    { contentTags: undefined }, // Hit 293 false
                                    { contentTags: {} }, // Hit 293 false
                                ],
                            },
                            {
                                questions: undefined, // Hit fallback at 293
                            },
                            {
                                questions: [], // Empty array
                            },
                        ],
                    },
                    {
                        // Part 2 - undefined questions and questionGroups to hit fallbacks at 276-277
                        questions: undefined,
                        questionGroups: undefined,
                    },
                ],
            };
            mockFindOne.mockResolvedValueOnce(testDef);

            const testResult = {
                testId: 't1',
                userAnswers: [
                    { questionNumber: 1, isCorrect: true }, // domain1: 1 correct
                    { questionNumber: 2, isCorrect: false }, // domain2: 1 incorrect
                    { questionNumber: 4, isCorrect: false }, // {} tag: 1 incorrect
                    { questionNumber: 5, isCorrect: false }, // domain1: 1 incorrect, domain3: 1 incorrect
                ],
            };

            const result = await (
                service as any
            ).aggregateDomainPerformanceFromTest(testResult);

            // Expected:
            // domain1: total 2, correct 1 (50%) -> weak
            // domain2: total 1, correct 0 (0%) -> weak
            // domain3: total 1, correct 0 (0%) -> weak
            // Sorted by accuracy ascending

            expect(result).toHaveLength(3);
            expect(result[0].domain).toBe('domain2');
            expect(result[0].accuracy).toBe(0);
            expect(result[0].isWeak).toBe(true);

            // Since domain2 and domain3 both have 0%, their relative order depends on map iteration, but both are 0%.
            expect(
                result.some(
                    (r: any) => r.domain === 'domain3' && r.accuracy === 0
                )
            ).toBe(true);
            expect(result.find((r: any) => r.domain === 'domain1')).toEqual({
                domain: 'domain1',
                totalQuestions: 2,
                correctAnswers: 1,
                accuracy: 50,
                isWeak: true,
            });
        });

        it('should catch error and return empty array', async () => {
            Object.defineProperty(QuestionMetadata, 'db', {
                value: mockDb,
                configurable: true,
            });
            mockFindOne.mockRejectedValueOnce(new Error('db error'));

            const result = await (
                service as any
            ).aggregateDomainPerformanceFromTest({ testId: 't1' });
            expect(result).toEqual([]);
            expect(consoleErrorSpy).toHaveBeenCalled();
        });
    });

    describe('detectWeaknesses', () => {
        const mockTestResultId = '123';
        const localMockTestResult = {
            _id: mockTestResultId,
            testId: 't1',
            score: 75,
            totalQuestions: 100, // 75% -> intermediate
            parts: ['part1', 'part2'],
            analysis: {
                examAnalysis: {
                    partAnalyses: undefined, // hit fallback at 142
                },
            },
        };

        it('should throw error if test result not found', async () => {
            (mockTestResult.findById as any) = jest
                .fn()
                .mockResolvedValue(null);
            await expect(
                service.detectWeaknesses(mockTestResultId)
            ).rejects.toThrow(/Test result or analysis not found/);
        });

        it('should throw error if analysis or examAnalysis not found', async () => {
            (mockTestResult.findById as any) = jest
                .fn()
                .mockResolvedValue({ analysis: {} });
            await expect(
                service.detectWeaknesses(mockTestResultId)
            ).rejects.toThrow(/Test result or analysis not found/);
        });

        it('should process correctly and call AI service', async () => {
            (mockTestResult.findById as any) = jest
                .fn()
                .mockResolvedValueOnce(localMockTestResult) // for findById initial check
                .mockResolvedValueOnce({
                    ...localMockTestResult,
                    updated: true,
                }); // for final return

            (mockTestResult.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue({});

            // Mock the private methods using spyOn
            jest.spyOn(
                service as any,
                'aggregateSkillPerformance'
            ).mockReturnValue([{ skill: 'sk' }]);
            jest.spyOn(
                service as any,
                'aggregateDomainPerformanceFromTest'
            ).mockResolvedValue([{ domain: 'dm' }]);

            const mockComprehensiveDiagnosis = {
                summary: 'summary',
                topWeaknesses: [],
                domainPerformance: [],
                weakDomains: [],
                keyInsights: [],
                generatedAt: new Date(),
            };
            mockToeicAnalysisAIService.generateComprehensiveDiagnosis.mockResolvedValueOnce(
                mockComprehensiveDiagnosis as any
            );

            const result = await service.detectWeaknesses(mockTestResultId);

            expect(
                mockToeicAnalysisAIService.generateComprehensiveDiagnosis
            ).toHaveBeenCalledWith({
                totalScore: 75,
                totalQuestions: 100,
                overallAccuracy: 75,
                userLevel: 'intermediate',
                partsList: 'part1, part2',
                skillPerformanceData: [{ skill: 'sk' }],
                domainPerformanceData: [{ domain: 'dm' }],
                partAnalyses: [],
            });

            expect(mockTestResult.findByIdAndUpdate).toHaveBeenCalledWith(
                mockTestResultId,
                {
                    'analysis.examAnalysis.summary':
                        mockComprehensiveDiagnosis.summary,
                    'analysis.examAnalysis.topWeaknesses':
                        mockComprehensiveDiagnosis.topWeaknesses,
                    'analysis.examAnalysis.domainPerformance':
                        mockComprehensiveDiagnosis.domainPerformance,
                    'analysis.examAnalysis.weakDomains':
                        mockComprehensiveDiagnosis.weakDomains,
                    'analysis.examAnalysis.keyInsights':
                        mockComprehensiveDiagnosis.keyInsights,
                    'analysis.examAnalysis.generatedAt':
                        mockComprehensiveDiagnosis.generatedAt,
                }
            );

            expect(result).toHaveProperty('updated', true);
        });
    });
});
