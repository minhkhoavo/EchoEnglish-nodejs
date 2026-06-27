/* eslint-disable @typescript-eslint/no-explicit-any */

import { studyPlanGeneratorService } from '~/services/recommendation/StudyPlanGeneratorService.js';
import { StudyPlan } from '~/models/studyPlanModel.js';
import { Resource } from '~/models/resource.js';
import { QuestionMetadata } from '~/models/questionMetadataModel.js';
import { TestResult } from '~/models/testResultModel.js';
import { toeicAnalysisAIService } from '~/ai/service/toeicAnalysisAIService.js';
import { knowledgeBaseService } from '~/services/knowledgeBase/knowledgeBaseService.js';
import { SeverityLevel } from '~/enum/severityLevel.js';

jest.mock('~/models/studyPlanModel.js', () => ({
    StudyPlan: {
        create: jest.fn(),
        findById: jest.fn(),
        findOne: jest.fn(),
    },
}));

jest.mock('~/models/resource.js', () => ({
    Resource: {
        find: jest.fn(),
    },
}));

jest.mock('~/models/questionMetadataModel.js', () => ({
    QuestionMetadata: {
        countDocuments: jest.fn(),
    },
}));

jest.mock('~/models/testResultModel.js', () => ({
    TestResult: {
        findById: jest.fn(),
    },
}));

jest.mock('~/ai/service/toeicAnalysisAIService.js', () => ({
    toeicAnalysisAIService: {
        generateStrategicPlan: jest.fn(),
        generateStudyPlanItem: jest.fn(),
        generateVocabularySet: jest.fn(),
        generatePersonalizedGuide: jest.fn(),
    },
}));

jest.mock('~/services/knowledgeBase/knowledgeBaseService.js', () => ({
    knowledgeBaseService: {
        getKnowledgeContext: jest.fn(),
    },
}));

const mockedStudyPlan = StudyPlan as jest.Mocked<typeof StudyPlan>;
const mockedResource = Resource as jest.Mocked<typeof Resource>;
const mockedQuestionMetadata = QuestionMetadata as jest.Mocked<
    typeof QuestionMetadata
>;
const mockedTestResult = TestResult as jest.Mocked<typeof TestResult>;
const mockedToeicAnalysisAIService = toeicAnalysisAIService as jest.Mocked<
    typeof toeicAnalysisAIService
>;
const mockedKnowledgeBaseService = knowledgeBaseService as jest.Mocked<
    typeof knowledgeBaseService
>;

describe('StudyPlanGeneratorService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('generateStudyPlan', () => {
        it('should throw error if testResult not found', async () => {
            (mockedTestResult.findById as any).mockResolvedValue(null);
            await expect(
                studyPlanGeneratorService.generateStudyPlan('tr1', 'u1')
            ).rejects.toThrow('TestResult or analysis not found');
        });

        it('should throw error if comprehensive diagnosis not found', async () => {
            (mockedTestResult.findById as any).mockResolvedValue({
                analysis: { examAnalysis: {} },
            });
            await expect(
                studyPlanGeneratorService.generateStudyPlan('tr1', 'u1')
            ).rejects.toThrow('No comprehensive diagnosis found');
        });

        it('should throw error if strategic plan generation fails', async () => {
            (mockedTestResult.findById as any).mockResolvedValue({
                analysis: { examAnalysis: { summary: 'S', topWeaknesses: [] } },
            });
            mockedToeicAnalysisAIService.generateStrategicPlan.mockResolvedValue(
                []
            );
            await expect(
                studyPlanGeneratorService.generateStudyPlan('tr1', 'u1')
            ).rejects.toThrow('Failed to generate strategic plan');
        });

        it('should skip strategic item if targetWeakness not found', async () => {
            (mockedTestResult.findById as any).mockResolvedValue({
                _id: 'tr1',
                analysis: {
                    examAnalysis: {
                        summary: 'S',
                        topWeaknesses: [{ id: 'w1', skillKey: 'k1' }],
                    },
                },
            });
            mockedToeicAnalysisAIService.generateStrategicPlan.mockResolvedValue(
                [
                    {
                        title: 'T1',
                        targetWeaknesses: ['w2'],
                        estimatedWeeks: 1,
                        priority: 1,
                        focusParts: [],
                        skillFocus: 's',
                    } as any,
                ]
            );
            (mockedStudyPlan.create as any).mockResolvedValue({ _id: 'sp1' });

            const result = await studyPlanGeneratorService.generateStudyPlan(
                'tr1',
                'u1'
            );
            expect(result).toBeDefined();
            expect(mockedStudyPlan.create).toHaveBeenCalledWith(
                expect.objectContaining({ planItems: [] })
            );
        });

        it('should generate plan items successfully', async () => {
            (mockedTestResult.findById as any).mockResolvedValue({
                _id: 'tr1',
                analysis: {
                    examAnalysis: {
                        summary: 'S',
                        topWeaknesses: [
                            {
                                id: 'w1',
                                skillKey: 'main_topic',
                                skillName: 'Main Topic',
                                category: 'GIST',
                                severity: 'CRITICAL',
                                impactScore: 10,
                                totalCount: 10,
                                incorrectCount: 5,
                            },
                            {
                                id: 'w2',
                                skillKey: 'matched_by_key',
                                skillName: 'Skill 2',
                                category: 'DETAIL',
                                severity: 'HIGH',
                                totalCount: 10,
                                incorrectCount: 0,
                            }, // hit incorrectCount || 0
                            {
                                id: 'w3',
                                skillKey: 'skill_3',
                                skillName: 'Matched By Name',
                                category: 'GRAMMAR',
                                severity: 'LOW',
                            },
                        ],
                        weakDomains: ['BUSINESS'],
                    },
                },
            });
            mockedToeicAnalysisAIService.generateStrategicPlan.mockResolvedValue(
                [
                    {
                        title: 'Strategic 1',
                        targetWeaknesses: ['w1'],
                        estimatedWeeks: 2,
                        priority: 1,
                        focusParts: ['Part 1'],
                        skillFocus: 'Main Topic',
                    },
                    {
                        title: 'Strategic 2',
                        targetWeaknesses: ['matched_by_key'],
                        estimatedWeeks: 1,
                        priority: 2,
                        focusParts: ['Part 2'],
                        skillFocus: 'Skill 2', // hits line 92 includes(w.skillKey)
                    },
                    {
                        title: 'Strategic 3',
                        targetWeaknesses: ['Matched By Name'],
                        estimatedWeeks: 1,
                        priority: 3,
                        focusParts: [],
                        skillFocus: 'Matched By Name', // hits line 92 includes(w.skillName)
                    },
                ] as any
            );

            mockedToeicAnalysisAIService.generateStudyPlanItem.mockResolvedValue(
                {
                    title: 'AI Title',
                    description: 'AI Desc',
                    estimatedWeeks: 2,
                } as any
            );

            (mockedResource.find as any).mockReturnValue({
                limit: jest
                    .fn()
                    .mockResolvedValue([
                        {
                            title: 'R1',
                            type: 'video',
                            description: 'D1',
                            _id: 'r1',
                            url: 'u1',
                        },
                    ]),
            });

            mockedToeicAnalysisAIService.generatePersonalizedGuide.mockResolvedValue(
                {
                    title: 'Guide',
                    sections: ['s1'],
                    quickTips: [],
                } as any
            );

            (mockedQuestionMetadata.countDocuments as any).mockResolvedValue(
                10
            );

            (mockedStudyPlan.create as any).mockResolvedValue({ _id: 'sp1' });

            const result = await studyPlanGeneratorService.generateStudyPlan(
                'tr1',
                'u1'
            );

            expect(result).toBeDefined();
            const createArgs = (mockedStudyPlan.create as jest.Mock).mock
                .calls[0][0];
            expect(createArgs.planItems).toHaveLength(3);
            expect(createArgs.planItems[0].title).toBe('Strategic 1'); // override
            expect(createArgs.planItems[0].resources).toBeDefined();
        });
    });

    describe('shouldGenerateVocabularySet', () => {
        it.each([
            [{ category: 'VOCABULARY', skillKey: '', skillName: '' }, true],
            [
                { category: 'OTHER', skillKey: 'word_choice', skillName: '' },
                true,
            ],
            [{ category: 'OTHER', skillKey: '', skillName: 'business' }, true],
            [{ category: 'INFERENCE', skillKey: '', skillName: '' }, true],
            [
                { category: 'GRAMMAR', skillKey: 'verb_tense', skillName: '' },
                false,
            ],
            [{ category: 'GRAMMAR', skillKey: 'other', skillName: '' }, false],
            [
                { category: 'OTHER', skillKey: 'other', skillName: 'other' },
                false,
            ],
        ])('should evaluate %# correctly', (input, expected) => {
            expect(
                studyPlanGeneratorService.shouldGenerateVocabularySet(input)
            ).toBe(expected);
        });
    });

    describe('shouldGeneratePersonalizedGuide', () => {
        it.each([
            [{ category: 'GIST', skillKey: '' }, true],
            [{ category: 'COHESION', skillKey: '' }, true],
            [{ category: 'VOCABULARY', skillKey: 'usage' }, true],
            [{ category: 'VOCABULARY', skillKey: 'other' }, false],
            [{ category: 'OTHER', skillKey: '' }, true],
        ])('should evaluate %# correctly', (input, expected) => {
            expect(
                studyPlanGeneratorService.shouldGeneratePersonalizedGuide(input)
            ).toBe(expected);
        });
    });

    describe('findDatabaseResources', () => {
        it('should fallback to general resources if none found for skill-based', async () => {
            // First find returns empty
            const limit1 = jest.fn().mockResolvedValue([]);
            const limit2 = jest.fn().mockResolvedValue([{ type: 'article' }]); // no title and no description to hit fallbacks at lines 489, 491

            (mockedResource.find as any)
                .mockReturnValueOnce({ limit: limit1 }) // specific
                .mockReturnValueOnce({ limit: limit2 }); // fallback

            const resources =
                await studyPlanGeneratorService.findDatabaseResources(
                    {
                        category: 'INFERENCE',
                        skillKey: 'infer_location',
                        affectedParts: [],
                    },
                    ['FINANCE']
                );

            expect(resources).toHaveLength(1);
            expect(resources[0].title).toBe('Untitled Resource'); // line 489
            expect(resources[0].description).toBe('Learn more about INFERENCE'); // line 491
        });

        it('should not fallback for grammar', async () => {
            (mockedResource.find as any).mockReturnValueOnce({
                limit: jest.fn().mockResolvedValue([]),
            });
            const resources =
                await studyPlanGeneratorService.findDatabaseResources(
                    {
                        category: 'GRAMMAR',
                        skillKey: 'verb_tense',
                        affectedParts: [],
                    },
                    []
                );
            expect(resources).toHaveLength(0);
        });
    });

    describe('generateVocabularySet', () => {
        it('should return null if generation fails or empty', async () => {
            mockedToeicAnalysisAIService.generateVocabularySet.mockResolvedValue(
                null as any
            );
            const result =
                await studyPlanGeneratorService.generateVocabularySet(
                    {
                        category: '',
                        skillKey: '',
                        skillName: '',
                        affectedParts: [],
                    },
                    []
                );
            expect(result).toBeNull();
        });

        it('should return set on error', async () => {
            mockedToeicAnalysisAIService.generateVocabularySet.mockRejectedValue(
                new Error('err')
            );
            const result =
                await studyPlanGeneratorService.generateVocabularySet(
                    {
                        category: '',
                        skillKey: '',
                        skillName: '',
                        affectedParts: [],
                    },
                    []
                );
            expect(result).toBeNull();
        });
    });

    describe('generatePersonalizedGuide', () => {
        it('should fetch knowledge context for grammar', async () => {
            mockedKnowledgeBaseService.getKnowledgeContext.mockResolvedValue(
                'CTX'
            );
            mockedToeicAnalysisAIService.generatePersonalizedGuide.mockResolvedValue(
                { title: 'T', sections: ['s'] } as any
            );

            await studyPlanGeneratorService.generatePersonalizedGuide(
                {
                    category: 'GRAMMAR',
                    skillKey: '',
                    skillName: 'N',
                    affectedParts: [],
                },
                50
            );
            expect(
                mockedKnowledgeBaseService.getKnowledgeContext
            ).toHaveBeenCalledWith('N');
        });

        it('should not throw if knowledge context is falsy for grammar', async () => {
            mockedKnowledgeBaseService.getKnowledgeContext.mockResolvedValue(
                null
            );
            mockedToeicAnalysisAIService.generatePersonalizedGuide.mockResolvedValue(
                { title: 'T', sections: ['s'] } as any
            );

            const result =
                await studyPlanGeneratorService.generatePersonalizedGuide(
                    {
                        category: 'GRAMMAR',
                        skillKey: '',
                        skillName: 'N',
                        affectedParts: [],
                    },
                    50
                );
            expect(result).toBeDefined(); // covers line 576 false branch
        });

        it('should return null if generation empty', async () => {
            mockedToeicAnalysisAIService.generatePersonalizedGuide.mockResolvedValue(
                {} as any
            );
            const result =
                await studyPlanGeneratorService.generatePersonalizedGuide(
                    {
                        category: 'OTHER',
                        skillKey: '',
                        skillName: '',
                        affectedParts: [],
                    },
                    50
                );
            expect(result).toBeNull();
        });

        it('should return null on error', async () => {
            mockedToeicAnalysisAIService.generatePersonalizedGuide.mockRejectedValue(
                new Error('err')
            );
            const result =
                await studyPlanGeneratorService.generatePersonalizedGuide(
                    {
                        category: '',
                        skillKey: '',
                        skillName: '',
                        affectedParts: [],
                    },
                    50
                );
            expect(result).toBeNull();
        });
    });

    describe('getTopicKeywords', () => {
        it('should return empty if missing args', () => {
            expect(studyPlanGeneratorService.getTopicKeywords('', '')).toEqual(
                []
            );
        });

        it('should return keywords based on grammar', () => {
            expect(
                studyPlanGeneratorService.getTopicKeywords(
                    'verb_tense',
                    'GRAMMAR'
                )
            ).toContain('verb tenses');
            expect(
                studyPlanGeneratorService.getTopicKeywords(
                    'word_form',
                    'GRAMMAR'
                )
            ).toContain('word forms');
            expect(
                studyPlanGeneratorService.getTopicKeywords(
                    'preposition',
                    'GRAMMAR'
                )
            ).toContain('prepositions');
            expect(
                studyPlanGeneratorService.getTopicKeywords('article', 'GRAMMAR')
            ).toContain('articles');
            expect(
                studyPlanGeneratorService.getTopicKeywords('other', 'GRAMMAR')
            ).toContain('grammar');
        });

        it('should return keywords based on vocabulary', () => {
            expect(
                studyPlanGeneratorService.getTopicKeywords(
                    'word_choice',
                    'VOCABULARY'
                )
            ).toContain('word choice');
            expect(
                studyPlanGeneratorService.getTopicKeywords(
                    'collocation',
                    'VOCABULARY'
                )
            ).toContain('collocations');
            expect(
                studyPlanGeneratorService.getTopicKeywords(
                    'synonym',
                    'VOCABULARY'
                )
            ).toContain('synonyms');
            expect(
                studyPlanGeneratorService.getTopicKeywords(
                    'other',
                    'VOCABULARY'
                )
            ).toContain('vocabulary');
        });

        it('should return keywords based on reading', () => {
            expect(
                studyPlanGeneratorService.getTopicKeywords('scanning', 'OTHER')
            ).toContain('scanning techniques');
            expect(
                studyPlanGeneratorService.getTopicKeywords(
                    'text_organization',
                    'COHESION'
                )
            ).toContain('cohesion');
        });

        it('should return keywords for specific action', () => {
            expect(
                studyPlanGeneratorService.getTopicKeywords(
                    'action',
                    'SPECIFIC_ACTION'
                )
            ).toContain('next steps');
        });
    });

    describe('getStudyPlan / getActiveStudyPlan', () => {
        it('should get study plan', async () => {
            (mockedStudyPlan.findById as any).mockReturnValue({
                populate: jest.fn().mockResolvedValue({ _id: 'sp1' }),
            });
            const result = await studyPlanGeneratorService.getStudyPlan('sp1');
            expect(result).toBeDefined();
        });

        it('should get active study plan', async () => {
            (mockedStudyPlan.findOne as any).mockReturnValue({
                sort: jest
                    .fn()
                    .mockReturnValue({
                        populate: jest.fn().mockResolvedValue({ _id: 'sp1' }),
                    }),
            });
            const result =
                await studyPlanGeneratorService.getActiveStudyPlan('u1');
            expect(result).toBeDefined();
        });
    });

    describe('updateItemProgress', () => {
        it('should return null if plan not found', async () => {
            (mockedStudyPlan.findById as any).mockResolvedValue(null);
            const result = await studyPlanGeneratorService.updateItemProgress(
                'sp1',
                1,
                50
            );
            expect(result).toBeNull();
        });

        it('should update progress and calculate overall', async () => {
            const plan = {
                planItems: [
                    { priority: 1, progress: 0, status: 'pending' },
                    { priority: 2, progress: 100, status: 'completed' },
                ],
                overallProgress: 0,
                status: 'active',
                save: jest.fn(),
            };
            (mockedStudyPlan.findById as any).mockResolvedValue(plan);

            await studyPlanGeneratorService.updateItemProgress('sp1', 1, 100);

            expect(plan.planItems[0].progress).toBe(100);
            expect(plan.planItems[0].status).toBe('completed');
            expect(plan.overallProgress).toBe(100); // (100+100)/2
            expect(plan.status).toBe('completed');
            expect(plan.save).toHaveBeenCalled();
        });

        it('should update status to pending if progress is 0', async () => {
            const plan = {
                planItems: [
                    { priority: 1, progress: 50, status: 'in_progress' },
                ],
                overallProgress: 0,
                status: 'active',
                save: jest.fn(),
            };
            (mockedStudyPlan.findById as any).mockResolvedValue(plan);

            await studyPlanGeneratorService.updateItemProgress('sp1', 1, 0);
            expect(plan.planItems[0].status).toBe('pending'); // covers line 1085 false branch
        });

        it('should update status to in_progress if progress > 0 and < 100', async () => {
            const plan = {
                planItems: [{ priority: 1, progress: 0, status: 'pending' }],
                overallProgress: 0,
                status: 'active',
                save: jest.fn(),
            };
            (mockedStudyPlan.findById as any).mockResolvedValue(plan);

            await studyPlanGeneratorService.updateItemProgress('sp1', 1, 50);
            expect(plan.planItems[0].status).toBe('in_progress'); // covers line 1085
        });

        it('should return studyPlan if item is not found, without modifications', async () => {
            const plan = {
                planItems: [],
                overallProgress: 0,
                status: 'active',
                save: jest.fn(),
            };
            (mockedStudyPlan.findById as any).mockResolvedValue(plan);

            const result = await studyPlanGeneratorService.updateItemProgress(
                'sp1',
                999,
                50
            );
            expect(result).toBeDefined();
            expect(plan.save).toHaveBeenCalled();
        });
    });

    describe('Private Methods Coverage (via generateStudyPlan)', () => {
        it('should test private methods via exhaustive dummy item', async () => {
            // Covering private methods through a fully populated weaknesses object
            (mockedTestResult.findById as any).mockResolvedValue({
                _id: 'tr1',
                analysis: {
                    examAnalysis: {
                        summary: 'S',
                        topWeaknesses: [
                            {
                                id: 'w1',
                                skillKey: 'specific_detail',
                                category: 'DETAIL',
                                severity: 'CRITICAL',
                                affectedParts: ['Part 1', 3],
                            },
                            {
                                id: 'w2',
                                skillKey: 'infer_feeling',
                                category: 'INFERENCE',
                                severity: 'HIGH',
                            },
                            {
                                id: 'w3',
                                skillKey: 'verb_tense',
                                category: 'GRAMMAR',
                                severity: 'MEDIUM',
                            },
                            {
                                id: 'w4',
                                skillKey: 'word_choice',
                                category: 'VOCABULARY',
                                severity: 'LOW',
                            },
                            {
                                id: 'w5',
                                skillKey: 'text_organization',
                                category: 'COHESION',
                                severity: 'UNKNOWN',
                            },
                            {
                                id: 'w6',
                                skillKey: 'next_action',
                                category: 'SPECIFIC_ACTION',
                            },
                            { id: 'w7', skillKey: '', category: 'OTHERS' },
                        ],
                        weakDomains: [],
                    },
                },
            });

            mockedToeicAnalysisAIService.generateStrategicPlan.mockResolvedValue(
                [
                    {
                        title: 'T1',
                        targetWeaknesses: ['w1'],
                        focusParts: ['Part 1', 3],
                        priority: 1,
                    },
                    { title: 'T2', targetWeaknesses: ['w2'], priority: 2 },
                    { title: 'T3', targetWeaknesses: ['w3'], priority: 3 },
                    { title: 'T4', targetWeaknesses: ['w4'], priority: 4 },
                    { title: 'T5', targetWeaknesses: ['w5'], priority: 5 },
                    { title: 'T6', targetWeaknesses: ['w6'], priority: 6 },
                    { title: 'T7', targetWeaknesses: ['w7'], priority: 7 },
                ] as any
            );

            mockedToeicAnalysisAIService.generateStudyPlanItem.mockResolvedValue(
                {} as any
            );
            (mockedResource.find as any).mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
            });
            (mockedQuestionMetadata.countDocuments as any).mockResolvedValue(0); // tests generic drill fallback
            (mockedStudyPlan.create as any).mockResolvedValue({ _id: 'sp1' });

            await studyPlanGeneratorService.generateStudyPlan('tr1', 'u1');
            expect(mockedStudyPlan.create).toHaveBeenCalled();
        });

        it('should test generatePracticeDrills directly', async () => {
            (mockedQuestionMetadata.countDocuments as any).mockResolvedValue(
                10
            );

            // mock mapCategoryToSkillCategory to return GRAMMAR to hit line 657 true branch
            const mapSpy = jest
                .spyOn(
                    studyPlanGeneratorService as any,
                    'mapCategoryToSkillCategory'
                )
                .mockReturnValue('GRAMMAR');

            const drills1 = await (
                studyPlanGeneratorService as any
            ).generatePracticeDrills({
                category: 'GIST',
                skillKey: 'main_topic',
                skillName: 'Main Topic',
                affectedParts: ['Part 1', 3, null, {}],
                severity: SeverityLevel.CRITICAL,
            });
            expect(drills1).toHaveLength(1);
            expect(drills1[0].totalQuestions).toBe(10);
            expect(drills1[0].difficulty).toBe('beginner');
            expect(drills1[0].skillTags.skillCategory).toBe('GRAMMAR'); // hits line 657

            mapSpy.mockRestore();

            // mock mapCategoryToSkillCategory to return empty string to test `skillCategory || 'OTHERS'` fallback when countDocuments > 0
            const mapSpy1b = jest
                .spyOn(
                    studyPlanGeneratorService as any,
                    'mapCategoryToSkillCategory'
                )
                .mockReturnValue('');

            const drills1b = await (
                studyPlanGeneratorService as any
            ).generatePracticeDrills({
                category: 'OTHER',
                skillKey: 'unknown',
                skillName: '',
                affectedParts: [],
                severity: SeverityLevel.MEDIUM,
            });
            expect(drills1b).toHaveLength(1);
            expect(drills1b[0].skillTags.skillCategory).toBe('OTHERS'); // hits line 701 `skillCategory || 'OTHERS'`
            mapSpy1b.mockRestore();

            (mockedQuestionMetadata.countDocuments as any).mockResolvedValue(0);

            // mock mapCategoryToSkillCategory to return empty string to test `skillCategory || 'OTHERS'` fallback
            const mapSpy2 = jest
                .spyOn(
                    studyPlanGeneratorService as any,
                    'mapCategoryToSkillCategory'
                )
                .mockReturnValue('');

            const drills2 = await (
                studyPlanGeneratorService as any
            ).generatePracticeDrills({
                category: 'OTHER',
                skillKey: 'unknown',
                skillName: '',
                affectedParts: undefined,
                severity: SeverityLevel.MEDIUM, // affectedParts undefined to cover fallback
            });
            expect(drills2).toHaveLength(1);
            expect(drills2[0].totalQuestions).toBe(20); // generic drill count
            expect(drills2[0].difficulty).toBe('intermediate');
            expect(drills2[0].skillTags.skillCategory).toBe('OTHERS'); // hits line 725 `skillCategory || 'OTHERS'`
            mapSpy2.mockRestore();
        });

        it('should test mapCategoryToSkillCategory directly', () => {
            const map = (
                studyPlanGeneratorService as any
            ).mapCategoryToSkillCategory.bind(studyPlanGeneratorService);
            expect(map('GIST')).toBe('GIST');
            expect(map('DETAIL')).toBe('DETAIL');
            expect(map('INFERENCE')).toBe('INFERENCE');
            expect(map('SPECIFIC_ACTION')).toBe('SPECIFIC_ACTION');
            expect(map('GRAMMAR')).toBe('GRAMMAR');
            expect(map('VOCABULARY')).toBe('VOCABULARY');
            expect(map('COHESION')).toBe('COHESION');
            expect(map('UNKNOWN')).toBe('OTHERS');
        });

        it('should test mapSkillKeyToSpecificSkills directly', () => {
            const map = (
                studyPlanGeneratorService as any
            ).mapSkillKeyToSpecificSkills.bind(studyPlanGeneratorService);
            expect(map('')).toEqual([]);
            expect(map('infer_speaker_role')).toContain('infer_speaker_role');
            expect(map('infer_location')).toContain('infer_location');
            expect(map('infer_implication')).toContain('infer_implication');
            expect(map('infer_feeling')).toContain('infer_feeling_attitude');
            expect(map('main_topic')).toContain('main_topic');
            expect(map('purpose')).toContain('purpose');
            expect(map('problem')).toContain('problem');
            expect(map('specific_detail')).toContain('specific_detail');
            expect(map('reason_cause')).toContain('reason_cause');
            expect(map('amount_quantity')).toContain('amount_quantity');
            expect(map('visual_information')).toContain('visual_information');
            expect(map('next_action')).toContain('next_action');
            expect(map('request_offer')).toContain('request_offer');
        });

        it('should test mapSeverityToDifficulty directly', () => {
            const map = (
                studyPlanGeneratorService as any
            ).mapSeverityToDifficulty.bind(studyPlanGeneratorService);
            expect(map(SeverityLevel.CRITICAL)).toBe('beginner');
            expect(map(SeverityLevel.HIGH)).toBe('beginner');
            expect(map(SeverityLevel.MEDIUM)).toBe('intermediate');
            expect(map(SeverityLevel.LOW)).toBe('advanced');
        });

        it('should test getRecommendedQuestionCount directly', () => {
            const map = (
                studyPlanGeneratorService as any
            ).getRecommendedQuestionCount.bind(studyPlanGeneratorService);
            expect(map(SeverityLevel.CRITICAL)).toBe(30);
            expect(map(SeverityLevel.HIGH)).toBe(20);
            expect(map(SeverityLevel.MEDIUM)).toBe(15);
            expect(map(SeverityLevel.LOW)).toBe(10);
        });

        it('should cover extractSkillsToImprove fallback for empty skills', () => {
            const map = (
                studyPlanGeneratorService as any
            ).extractSkillsToImprove.bind(studyPlanGeneratorService);
            const skills = map({
                skillName: '',
                skillKey: '',
                category: 'UNKNOWN_CATEGORY',
            });
            expect(skills).toContain('General Skill Improvement');

            const emptySkills = map({
                skillName: '',
                skillKey: '',
                category: '',
            });
            expect(emptySkills).toContain('General Skill Improvement');
        });

        it('should return default if uniqueSkills is empty in extractSkillsToImprove', () => {
            const map = (
                studyPlanGeneratorService as any
            ).extractSkillsToImprove.bind(studyPlanGeneratorService);
            const spy = jest
                .spyOn(Array.prototype, 'filter')
                .mockReturnValue([]); // return empty array
            const skills = map({ skillName: '', skillKey: '', category: '' });
            expect(skills).toContain('General improvement needed');
            spy.mockRestore();
        });

        it('should filter out invalid skills in generatePlanItemForWeakness (lines 216-218)', async () => {
            const spy = jest
                .spyOn(
                    studyPlanGeneratorService as any,
                    'extractSkillsToImprove'
                )
                .mockReturnValueOnce(['valid', null, 123, ' ']);

            mockedToeicAnalysisAIService.generateStudyPlanItem.mockResolvedValue(
                {} as any
            );
            (mockedResource.find as any).mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
            });

            const planItem = await (
                studyPlanGeneratorService as any
            ).generatePlanItemForWeakness(
                {
                    skillName: '',
                    skillKey: '',
                    category: '',
                    affectedParts: [],
                    severity: 'LOW',
                },
                1,
                []
            );
            expect(planItem.skillsToImprove).toContain('valid');
            expect(planItem.skillsToImprove).not.toContain(null);
            spy.mockRestore();
        });

        it('should use default skill if validatedSkillsToImprove is empty in generatePlanItemForWeakness', async () => {
            const spy = jest
                .spyOn(
                    studyPlanGeneratorService as any,
                    'extractSkillsToImprove'
                )
                .mockReturnValueOnce([' ']); // array with whitespace string to hit line 225 true branch

            mockedToeicAnalysisAIService.generateStudyPlanItem.mockResolvedValue(
                {} as any
            );
            (mockedResource.find as any).mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
            });

            const planItem = await (
                studyPlanGeneratorService as any
            ).generatePlanItemForWeakness(
                {
                    skillName: '',
                    skillKey: '',
                    category: '',
                    affectedParts: [],
                    severity: 'LOW',
                },
                1,
                []
            );
            expect(planItem.skillsToImprove).toContain(
                'General improvement needed'
            );
            spy.mockRestore();
        });

        it('should use default skill if skillsToImprove is empty in generatePlanItemForWeakness', async () => {
            const spy = jest
                .spyOn(
                    studyPlanGeneratorService as any,
                    'extractSkillsToImprove'
                )
                .mockReturnValueOnce([]); // empty array to trigger line 216 false branch

            mockedToeicAnalysisAIService.generateStudyPlanItem.mockResolvedValue(
                {} as any
            );
            (mockedResource.find as any).mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
            });

            const planItem = await (
                studyPlanGeneratorService as any
            ).generatePlanItemForWeakness(
                {
                    skillName: '',
                    skillKey: '',
                    category: '',
                    affectedParts: [],
                    severity: 'LOW',
                },
                1,
                []
            );
            expect(planItem.skillsToImprove).toContain(
                'General improvement needed'
            );
            spy.mockRestore();
        });

        it('should cover generateVocabularySet when vocabSet has no words', async () => {
            mockedToeicAnalysisAIService.generateVocabularySet.mockResolvedValue(
                { words: [] } as any
            );
            const result =
                await studyPlanGeneratorService.generateVocabularySet(
                    {
                        category: '',
                        skillKey: '',
                        skillName: '',
                        affectedParts: [],
                    },
                    []
                );
            expect(result).toBeNull();
        });

        it('should cover generateVocabularySet when vocabSet has words successfully', async () => {
            mockedToeicAnalysisAIService.generateVocabularySet.mockResolvedValue(
                {
                    title: 'T',
                    description: 'D',
                    words: [{ word: 'test', definition: 'd' }],
                } as any
            );
            const result =
                await studyPlanGeneratorService.generateVocabularySet(
                    {
                        category: 'VOCABULARY',
                        skillKey: 'usage',
                        skillName: 'Usage',
                        affectedParts: [],
                    },
                    []
                );
            expect(result).toBeDefined();
            expect(result?.type).toBe('vocabulary_set');
            expect(result?.generatedContent?.words).toHaveLength(1);
        });

        it('should cover vocabSet push to resources in generateStudyPlan', async () => {
            (mockedTestResult.findById as any).mockResolvedValue({
                _id: 'tr1',
                analysis: {
                    examAnalysis: {
                        summary: 'S',
                        topWeaknesses: [
                            {
                                id: 'w_vocab',
                                skillKey: 'word_choice',
                                skillName: 'Vocab',
                                category: 'VOCABULARY',
                                severity: 'CRITICAL',
                                affectedParts: ['Part 5'],
                            },
                        ],
                        weakDomains: ['BUSINESS'],
                    },
                },
            });

            mockedToeicAnalysisAIService.generateStrategicPlan.mockResolvedValue(
                [
                    {
                        title: 'Vocab Plan',
                        targetWeaknesses: ['w_vocab'],
                        estimatedWeeks: 1,
                        priority: 1,
                        focusParts: ['Part 5'],
                        skillFocus: 'Vocab',
                    } as any,
                ]
            );

            mockedToeicAnalysisAIService.generateStudyPlanItem.mockResolvedValue(
                { title: 'AI Title', description: 'AI Desc' } as any
            );
            (mockedResource.find as any).mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
            });
            (mockedQuestionMetadata.countDocuments as any).mockResolvedValue(0);

            mockedToeicAnalysisAIService.generateVocabularySet.mockResolvedValue(
                {
                    title: 'Vocab Set',
                    description: 'D',
                    words: [{ word: 'test', definition: 'd' }],
                } as any
            );

            (mockedStudyPlan.create as any).mockResolvedValue({ _id: 'sp1' });

            await studyPlanGeneratorService.generateStudyPlan('tr1', 'u1');

            const createArgs = (mockedStudyPlan.create as jest.Mock).mock
                .calls[0][0];
            const resources = createArgs.planItems[0].resources;

            expect(resources).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ type: 'vocabulary_set' }),
                ])
            );
        });

        it('should cover formatSkillName fallback', () => {
            const map = (studyPlanGeneratorService as any).formatSkillName.bind(
                studyPlanGeneratorService
            );
            expect(map('')).toBe('Unknown Skill');
            expect(map(null)).toBe('Unknown Skill');
        });
    });
});
