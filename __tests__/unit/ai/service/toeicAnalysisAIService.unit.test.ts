/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { toeicAnalysisAIService } from '~/ai/service/toeicAnalysisAIService.js';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';

jest.mock('~/ai/provider/googleGenAIClient.js');

describe('ToeicAnalysisAIService', () => {
    let mockGenerate: jest.Mock;
    let consoleErrorSpy: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;
    let loadTemplateSpy: jest.SpyInstance;
    let getSystemPromptSpy: jest.SpyInstance;
    let dateSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        mockGenerate = jest.fn();
        jest.spyOn(
            (toeicAnalysisAIService as any).aiClient,
            'generate'
        ).mockImplementation(mockGenerate);

        loadTemplateSpy = jest
            .spyOn(promptManagerService, 'loadTemplate')
            .mockResolvedValue('mocked template');
        getSystemPromptSpy = jest
            .spyOn(promptManagerService, 'getSystemPrompt')
            .mockResolvedValue('mocked system prompt');

        jest.useFakeTimers();
        jest.setSystemTime(new Date('2023-10-10T00:00:00Z'));
    });

    afterEach(() => {
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (loadTemplateSpy) loadTemplateSpy.mockRestore();
        if (getSystemPromptSpy) getSystemPromptSpy.mockRestore();
        jest.useRealTimers();
    });

    describe('generateStudyPlanItem', () => {
        const input = {
            weaknessCategory: 'Listening',
            skillKey: 'infer_implication',
            weaknessTitle: 'Inference',
            severity: 'critical',
            userAccuracy: 40,
            affectedParts: ['Part 3', 'Part 4'],
            resources: [{ type: 'video', title: 'Vid 1', estimatedTime: 10 }],
            drills: [
                { title: 'Drill 1', totalQuestions: 5, difficulty: 'hard' },
            ],
        };

        it('should successfully generate study plan item', async () => {
            mockGenerate.mockResolvedValueOnce(
                '{"title":"Custom Title", "description":"Desc", "estimatedWeeks":3}'
            );

            const result =
                await toeicAnalysisAIService.generateStudyPlanItem(input);

            expect(result).toEqual({
                title: 'Custom Title',
                description: 'Desc',
                estimatedWeeks: 3,
            });
            expect(mockGenerate).toHaveBeenCalled();
        });

        it('should use fallbacks if LLM properties are missing', async () => {
            mockGenerate.mockResolvedValueOnce('{}'); // empty object

            const result =
                await toeicAnalysisAIService.generateStudyPlanItem(input);

            expect(result.title).toBe('Master Implication Inference');
            expect(result.estimatedWeeks).toBe(4); // critical -> 4
            expect(result.description).toContain('infer implication');
        });

        it('should estimate weeks correctly based on severity fallback', async () => {
            mockGenerate.mockResolvedValueOnce('{}');

            let res = await toeicAnalysisAIService.generateStudyPlanItem({
                ...input,
                severity: 'high',
            });
            expect(res.estimatedWeeks).toBe(3);

            res = await toeicAnalysisAIService.generateStudyPlanItem({
                ...input,
                severity: 'medium',
            });
            expect(res.estimatedWeeks).toBe(2);

            res = await toeicAnalysisAIService.generateStudyPlanItem({
                ...input,
                severity: 'low',
            });
            expect(res.estimatedWeeks).toBe(1);

            res = await toeicAnalysisAIService.generateStudyPlanItem({
                ...input,
                severity: 'unknown',
            });
            expect(res.estimatedWeeks).toBe(2);
        });

        it('should use fallbacks and log error if LLM invocation fails', async () => {
            mockGenerate.mockRejectedValueOnce(new Error('crash'));

            const result = await toeicAnalysisAIService.generateStudyPlanItem({
                ...input,
                skillKey: 'unknown_skill',
            });

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error generating study plan item:',
                expect.any(Error)
            );
            expect(result.title).toBe('Improve unknown skill');
            expect(result.estimatedWeeks).toBe(4);
        });
    });

    describe('generateVocabularySet', () => {
        const input = {
            weaknessCategory: 'Vocab',
            skillKey: 'collocation',
            weaknessTitle: 'Collocation',
            affectedParts: ['Part 5'],
            domainContext: ['work'],
            weakDomains: ['office'],
        };

        it('should successfully generate vocabulary set', async () => {
            mockGenerate.mockResolvedValueOnce(
                '{"title":"Vocab Title", "description":"Desc", "words": [{"word":"test","partOfSpeech":"n","definition":"def","example":"ex","usageNote":"note"}]}'
            );

            const result =
                await toeicAnalysisAIService.generateVocabularySet(input);

            expect(result.title).toBe('Vocab Title');
            expect(result.words.length).toBe(1);
            expect(loadTemplateSpy).toHaveBeenCalledWith(
                'analysis/vocabulary-set',
                expect.any(Object)
            );
        });

        it('should use fallbacks if LLM properties are missing', async () => {
            mockGenerate.mockResolvedValueOnce('{}');

            const result =
                await toeicAnalysisAIService.generateVocabularySet(input);

            expect(result.title).toBe('Collocation Vocabulary');
            expect(result.description).toBe(
                'Essential vocabulary for this skill area'
            );
            expect(result.words).toEqual([]);
        });

        it('should handle undefined optional arrays in input', async () => {
            mockGenerate.mockResolvedValueOnce('{}');

            await toeicAnalysisAIService.generateVocabularySet({
                ...input,
                domainContext: undefined,
                weakDomains: undefined,
            });

            const callArgs = loadTemplateSpy.mock.calls[0][1];
            expect(callArgs.domainContext).toBe('N/A');
            expect(callArgs.weakContext).toBe('N/A');
        });

        it('should use fallbacks and log error if LLM invocation fails', async () => {
            mockGenerate.mockRejectedValueOnce(new Error('crash'));

            const result =
                await toeicAnalysisAIService.generateVocabularySet(input);

            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(result.title).toBe('Collocation Vocabulary');
            expect(result.words).toEqual([]);
        });
    });

    describe('generatePersonalizedGuide', () => {
        const input = {
            weaknessCategory: 'Reading',
            skillKey: 'infer',
            weaknessTitle: 'Inference',
            severity: 'high',
            affectedParts: ['Part 7'],
            userAccuracy: 50,
            questionsAttempted: 10,
            errorPatterns: 'pattern',
            commonMistakes: 'mistake',
            knowledgeContext: 'knowledge',
        };

        it('should successfully generate guide with knowledgeContext', async () => {
            mockGenerate.mockResolvedValueOnce(
                '{"title":"Guide", "sections": [{"heading":"h1", "content":"c1"}], "quickTips": ["tip1"]}'
            );

            const result =
                await toeicAnalysisAIService.generatePersonalizedGuide(input);

            expect(result.title).toBe('Guide');
            expect(result.sections.length).toBe(1);

            // Check if knowledgeContext is appended
            const fullPrompt = mockGenerate.mock.calls[0][0];
            expect(fullPrompt).toContain(
                'REFERENCE KNOWLEDGE FROM KNOWLEDGE BASE'
            );
            expect(fullPrompt).toContain('knowledge');
        });

        it('should handle missing optional fields', async () => {
            mockGenerate.mockResolvedValueOnce('{}');

            const result =
                await toeicAnalysisAIService.generatePersonalizedGuide({
                    ...input,
                    errorPatterns: undefined,
                    commonMistakes: undefined,
                    knowledgeContext: undefined,
                });

            const callArgs = loadTemplateSpy.mock.calls[0][1];
            expect(callArgs.errorPatterns).toBe('Not enough data yet');
            expect(callArgs.commonMistakes).toBe('Not enough data yet');

            const fullPrompt = mockGenerate.mock.calls[0][0];
            expect(fullPrompt).not.toContain(
                'REFERENCE KNOWLEDGE FROM KNOWLEDGE BASE'
            );

            expect(result.title).toBe('Personal Guide: Mastering Inference');
            expect(result.sections).toEqual([]);
            expect(result.quickTips).toEqual([]);
        });

        it('should use fallbacks and log error if LLM invocation fails', async () => {
            mockGenerate.mockRejectedValueOnce(new Error('crash'));

            const result =
                await toeicAnalysisAIService.generatePersonalizedGuide(input);

            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(result.title).toBe('Personal Guide: Mastering Inference');
            expect(result.sections[0].heading).toBe(
                'Understanding the Problem'
            );
            expect(result.quickTips).toContain('Practice regularly');
        });
    });

    describe('generateComprehensiveDiagnosis', () => {
        const input = {
            totalScore: 500,
            totalQuestions: 100,
            overallAccuracy: 50,
            userLevel: 'B1',
            partsList: 'Part 1',
            skillPerformanceData: [
                {
                    skillKey: 's1',
                    skillName: 's1 name',
                    userAccuracy: 50,
                    benchmarkAccuracy: 60,
                    accuracyGap: 10,
                    correct: 5,
                    total: 10,
                    affectedParts: ['Part 1'],
                },
            ],
            domainPerformanceData: [
                {
                    domain: 'work',
                    totalQuestions: 10,
                    correctAnswers: 5,
                    accuracy: 50,
                    isWeak: true,
                },
            ],
            partAnalyses: [
                {
                    partNumber: '1',
                    totalQuestions: 10,
                    correctAnswers: 5,
                    accuracy: 50,
                    skillBreakdown: [
                        {
                            skillName: 's1',
                            skillKey: 's1',
                            total: 10,
                            correct: 5,
                            accuracy: 50,
                        },
                    ],
                },
            ],
        };

        it('should generate diagnosis and extract weakDomains from topWeaknesses descriptions', async () => {
            mockGenerate.mockResolvedValueOnce(
                JSON.stringify({
                    summary: 'Sum',
                    topWeaknesses: [
                        { description: 'Struggles with business context' },
                        {
                            description:
                                'Problems with travel and Travel topics',
                        },
                        { description: 'Normal issue' },
                    ],
                    keyInsights: ['insight1'],
                })
            );

            const result =
                await toeicAnalysisAIService.generateComprehensiveDiagnosis(
                    input
                );

            expect(result.summary).toBe('Sum');
            expect(result.weakDomains).toEqual(['business', 'travel']);
            expect(result.keyInsights).toEqual(['insight1']);
            expect(result.topWeaknesses.length).toBe(3);
            expect(result.topWeaknesses[0].id).toContain('weakness_1_');
        });

        it('should handle missing array fields and falsy values', async () => {
            mockGenerate.mockResolvedValueOnce(
                JSON.stringify({
                    // missing arrays
                    topWeaknesses: undefined,
                    keyInsights: undefined,
                })
            );

            const result =
                await toeicAnalysisAIService.generateComprehensiveDiagnosis(
                    input
                );

            expect(result.topWeaknesses).toEqual([]);
            expect(result.keyInsights).toEqual([]);
            expect(result.weakDomains).toEqual([]);
            expect(result.summary).toBe('Performance analysis complete');
        });

        it('should handle individual topWeakness with missing fields (falsy)', async () => {
            mockGenerate.mockResolvedValueOnce(
                JSON.stringify({
                    topWeaknesses: [
                        {}, // completely empty object
                    ],
                })
            );

            const result =
                await toeicAnalysisAIService.generateComprehensiveDiagnosis(
                    input
                );

            const weak = result.topWeaknesses[0];
            expect(weak.severity).toBe('MEDIUM');
            expect(weak.skillKey).toBe('');
            expect(weak.affectedParts).toEqual([]);
            expect(weak.userAccuracy).toBe(0);
        });

        it('should handle topWeakness with affectedParts being a non-array or valid array', async () => {
            mockGenerate.mockResolvedValueOnce(
                JSON.stringify({
                    topWeaknesses: [
                        { affectedParts: 'not an array' },
                        { affectedParts: ['Part 1'] },
                    ],
                })
            );

            const result =
                await toeicAnalysisAIService.generateComprehensiveDiagnosis(
                    input
                );

            expect(result.topWeaknesses[0].affectedParts).toEqual([]);
            expect(result.topWeaknesses[1].affectedParts).toEqual(['Part 1']);
        });

        it('should return fallback data and log error if LLM invocation fails', async () => {
            mockGenerate.mockRejectedValueOnce(new Error('crash'));

            const result =
                await toeicAnalysisAIService.generateComprehensiveDiagnosis(
                    input
                );

            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(result.summary).toBe('Unable to generate diagnosis');
            expect(result.topWeaknesses).toEqual([]);
            expect(result.weakDomains).toEqual([]);
        });
    });

    describe('generateStrategicPlan', () => {
        it('should handle LLM returning array directly', async () => {
            mockGenerate.mockResolvedValueOnce(
                JSON.stringify([{ title: 'T1' }])
            );

            const result = await toeicAnalysisAIService.generateStrategicPlan(
                {}
            );

            expect(result.length).toBe(1);
            expect(result[0].title).toBe('T1');
            expect(result[0].priority).toBe(1); // index + 1
        });

        it('should handle LLM returning object with strategicItems array', async () => {
            mockGenerate.mockResolvedValueOnce(
                JSON.stringify({
                    strategicItems: [
                        {
                            priority: 2,
                            targetWeaknesses: ['w1'],
                            focusParts: ['p1'],
                        },
                    ],
                })
            );

            const result = await toeicAnalysisAIService.generateStrategicPlan(
                {}
            );

            expect(result.length).toBe(1);
            expect(result[0].priority).toBe(2);
            expect(result[0].targetWeaknesses).toEqual(['w1']);
            expect(result[0].focusParts).toEqual(['p1']);
        });

        it('should handle LLM returning object with missing strategicItems or invalid format', async () => {
            mockGenerate.mockResolvedValueOnce(
                JSON.stringify({
                    strategicItems: undefined,
                })
            );

            const result = await toeicAnalysisAIService.generateStrategicPlan(
                {}
            );

            expect(result).toEqual([]);
        });

        it('should handle individual strategic item with missing fields', async () => {
            mockGenerate.mockResolvedValueOnce(
                JSON.stringify([
                    {}, // completely empty object
                ])
            );

            const result = await toeicAnalysisAIService.generateStrategicPlan(
                {}
            );

            const item = result[0];
            expect(item.priority).toBe(1);
            expect(item.title).toBe('Strategic Focus 1');
            expect(item.targetWeaknesses).toEqual([]);
            expect(item.focusParts).toEqual([]);
            expect(item.estimatedWeeks).toBe(2);
        });

        it('should return empty array and log error if LLM invocation fails', async () => {
            mockGenerate.mockRejectedValueOnce(new Error('crash'));

            const result = await toeicAnalysisAIService.generateStrategicPlan(
                {}
            );

            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(result).toEqual([]);
        });
    });
});
