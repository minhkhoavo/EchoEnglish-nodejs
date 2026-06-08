import { Schema } from 'mongoose';
import {
    TestResult,
    ITestResult,
    IPartAnalysis,
} from '../../models/testResultModel.js';
import { QuestionMetadata } from '../../models/questionMetadataModel.js';
import { toeicAnalysisAIService } from '../../ai/service/toeicAnalysisAIService.js';
import { SkillCategory } from '../../enum/skillCategory.js';

// Benchmark accuracy data for different proficiency levels
const BENCHMARK_DATA: Record<string, Record<string, number>> = {
    // Part 3, 4, 7 skill categories
    [SkillCategory.GIST]: { beginner: 55, intermediate: 70, advanced: 85 },
    [SkillCategory.DETAIL]: { beginner: 50, intermediate: 65, advanced: 80 },
    [SkillCategory.INFERENCE]: { beginner: 40, intermediate: 60, advanced: 75 },
    [SkillCategory.SPECIFIC_ACTION]: {
        beginner: 45,
        intermediate: 65,
        advanced: 80,
    },
    [SkillCategory.GRAMMAR]: { beginner: 60, intermediate: 75, advanced: 90 },
    [SkillCategory.VOCABULARY]: {
        beginner: 55,
        intermediate: 70,
        advanced: 85,
    },
    [SkillCategory.COHESION]: { beginner: 50, intermediate: 68, advanced: 83 },
    [SkillCategory.OTHERS]: { beginner: 50, intermediate: 65, advanced: 80 },

    // Part 3, 4 skill details (camelCase)
    mainTopic: { beginner: 60, intermediate: 75, advanced: 88 },
    purpose: { beginner: 55, intermediate: 70, advanced: 85 },
    problem: { beginner: 52, intermediate: 68, advanced: 83 },
    specificDetail: { beginner: 52, intermediate: 67, advanced: 82 },
    reasonCause: { beginner: 50, intermediate: 65, advanced: 80 },
    amountQuantity: { beginner: 55, intermediate: 70, advanced: 85 },
    inferSpeakerRole: { beginner: 42, intermediate: 60, advanced: 75 },
    inferLocation: { beginner: 45, intermediate: 62, advanced: 77 },
    inferImplication: { beginner: 38, intermediate: 58, advanced: 73 },
    inferFeelingAttitude: { beginner: 40, intermediate: 60, advanced: 75 },
    futureAction: { beginner: 48, intermediate: 65, advanced: 80 },
    recommendedAction: { beginner: 46, intermediate: 64, advanced: 79 },
    requestedAction: { beginner: 47, intermediate: 65, advanced: 80 },
    speakerIntent: { beginner: 40, intermediate: 58, advanced: 73 },
    connectToGraphic: { beginner: 35, intermediate: 55, advanced: 70 },

    // Part 7 skill details (camelCase)
    mainTopicPurpose: { beginner: 58, intermediate: 73, advanced: 86 },
    scanning: { beginner: 55, intermediate: 70, advanced: 85 },
    paraphrasing: { beginner: 48, intermediate: 63, advanced: 78 },
    inferAuthorPurpose: { beginner: 40, intermediate: 58, advanced: 73 },
    vocabularyInContext: { beginner: 52, intermediate: 68, advanced: 83 },
    sentenceInsertion: { beginner: 45, intermediate: 60, advanced: 75 },
    crossReference: { beginner: 35, intermediate: 50, advanced: 68 },

    // Part 1 skills (camelCase)
    identifyActionInProgress: { beginner: 58, intermediate: 73, advanced: 88 },
    identifyStateCondition: { beginner: 52, intermediate: 68, advanced: 83 },
    identifySpatialRelationship: {
        beginner: 50,
        intermediate: 66,
        advanced: 81,
    },

    // Part 2 question forms (camelCase)
    whQuestion: { beginner: 52, intermediate: 68, advanced: 83 },
    yesNo: { beginner: 58, intermediate: 73, advanced: 88 },
    tagQuestion: { beginner: 48, intermediate: 63, advanced: 78 },
    statement: { beginner: 45, intermediate: 60, advanced: 75 },
    alternative: { beginner: 50, intermediate: 65, advanced: 80 },
    negativeQuestion: { beginner: 42, intermediate: 58, advanced: 73 },

    // Part 2 question functions (camelCase)
    informationSeeking: { beginner: 52, intermediate: 68, advanced: 83 },
    request: { beginner: 48, intermediate: 64, advanced: 79 },
    suggestion: { beginner: 46, intermediate: 62, advanced: 77 },
    offer: { beginner: 50, intermediate: 66, advanced: 81 },
    opinion: { beginner: 48, intermediate: 64, advanced: 79 },

    // Part 5 grammar points (camelCase)
    wordForm: { beginner: 62, intermediate: 77, advanced: 92 },
    verbTenseMood: { beginner: 58, intermediate: 73, advanced: 88 },
    subjectVerbAgreement: { beginner: 60, intermediate: 75, advanced: 90 },
    pronoun: { beginner: 58, intermediate: 73, advanced: 88 },
    preposition: { beginner: 55, intermediate: 70, advanced: 85 },
    conjunction: { beginner: 57, intermediate: 72, advanced: 87 },
    relativeClause: { beginner: 52, intermediate: 67, advanced: 82 },
    comparativeSuperlative: { beginner: 60, intermediate: 75, advanced: 90 },
    participle: { beginner: 54, intermediate: 69, advanced: 84 },

    // Part 5 & 6 vocab points (camelCase)
    wordChoice: { beginner: 56, intermediate: 71, advanced: 86 },
    collocation: { beginner: 52, intermediate: 67, advanced: 82 },
    phrasalVerb: { beginner: 50, intermediate: 65, advanced: 80 },

    // Part 6 tag types (camelCase)
    discourseConnector: { beginner: 50, intermediate: 68, advanced: 83 },
};

export class WeaknessDetectorService {
    /**
     * NEW: Detect weaknesses using comprehensive analysis (single LLM call)
     */
    async detectWeaknesses(
        testResultId: Schema.Types.ObjectId | string
    ): Promise<ITestResult | null> {
        const testResult = await TestResult.findById(testResultId);
        if (!testResult || !testResult.analysis?.examAnalysis) {
            throw new Error(
                `Test result or analysis not found: ${testResultId}`
            );
        }

        const examAnalysis = testResult.analysis.examAnalysis;
        const userLevel = this.determineUserLevel(
            testResult.score,
            testResult.totalQuestions
        );

        // Step 1: Aggregate all skill performance data
        const skillPerformanceData = this.aggregateSkillPerformance(
            examAnalysis,
            userLevel
        );

        // Step 2: Aggregate domain performance from test questions
        const domainPerformanceData =
            await this.aggregateDomainPerformanceFromTest(testResult);

        // Step 4: Call LLM once with all aggregated data
        const comprehensiveDiagnosis =
            await toeicAnalysisAIService.generateComprehensiveDiagnosis({
                totalScore: testResult.score,
                totalQuestions: testResult.totalQuestions,
                overallAccuracy:
                    (testResult.score / testResult.totalQuestions) * 100,
                userLevel,
                partsList: testResult.parts.join(', '),
                skillPerformanceData,
                domainPerformanceData,
                partAnalyses: examAnalysis.partAnalyses || [],
            });

        // Step 5: Save comprehensive diagnosis (flattened structure)
        await TestResult.findByIdAndUpdate(testResultId, {
            'analysis.examAnalysis.summary': comprehensiveDiagnosis.summary,
            'analysis.examAnalysis.topWeaknesses':
                comprehensiveDiagnosis.topWeaknesses,
            'analysis.examAnalysis.domainPerformance':
                comprehensiveDiagnosis.domainPerformance,
            'analysis.examAnalysis.weakDomains':
                comprehensiveDiagnosis.weakDomains,
            'analysis.examAnalysis.keyInsights':
                comprehensiveDiagnosis.keyInsights,
            'analysis.examAnalysis.generatedAt':
                comprehensiveDiagnosis.generatedAt,
        });

        return await TestResult.findById(testResultId);
    }

    /**
     * Aggregate skill performance across all parts
     */
    private aggregateSkillPerformance(
        examAnalysis: {
            partAnalyses?: IPartAnalysis[];
            overallSkills?: Map<string, number>;
        },
        userLevel: string
    ): Array<{
        skillKey: string;
        skillName: string;
        userAccuracy: number;
        benchmarkAccuracy: number;
        accuracyGap: number;
        correct: number;
        total: number;
        affectedParts: string[];
    }> {
        const skillMap = new Map<
            string,
            {
                skillName: string;
                total: number;
                correct: number;
                parts: Set<string>;
            }
        >();

        // Aggregate from part analyses
        for (const partAnalysis of (examAnalysis.partAnalyses ||
            []) as IPartAnalysis[]) {
            for (const skill of partAnalysis.skillBreakdown || []) {
                const existing = skillMap.get(skill.skillKey) || {
                    skillName: skill.skillName,
                    total: 0,
                    correct: 0,
                    parts: new Set<string>(),
                };
                existing.total += skill.total;
                existing.correct += skill.correct;
                existing.parts.add(partAnalysis.partNumber);
                skillMap.set(skill.skillKey, existing);
            }
        }

        const result = [];
        for (const [skillKey, data] of skillMap.entries()) {
            const userAccuracy = (data.correct / data.total) * 100;
            const benchmarkAccuracy = this.getBenchmarkAccuracy(
                skillKey,
                userLevel
            );
            const accuracyGap = benchmarkAccuracy - userAccuracy;

            result.push({
                skillKey,
                skillName: data.skillName,
                userAccuracy,
                benchmarkAccuracy,
                accuracyGap,
                correct: data.correct,
                total: data.total,
                affectedParts: Array.from(data.parts),
            });
        }
        return result.sort((a, b) => b.accuracyGap - a.accuracyGap);
    }

    private determineUserLevel(score: number, totalQuestions: number): string {
        const accuracy = (score / totalQuestions) * 100;
        if (accuracy >= 85) return 'advanced';
        if (accuracy >= 70) return 'intermediate';
        return 'beginner';
    }

    private async aggregateDomainPerformanceFromTest(
        testResult: ITestResult
    ): Promise<
        Array<{
            domain: string;
            totalQuestions: number;
            correctAnswers: number;
            accuracy: number;
            isWeak: boolean;
        }>
    > {
        try {
            const db = QuestionMetadata.db;
            if (!db) {
                console.warn(
                    '[aggregateDomainPerformance] No database connection'
                );
                return [];
            }

            const testsCollection = db.collection('tests');
            const test = await testsCollection.findOne({
                _id: testResult.testId,
            });

            if (!test || !test.parts) {
                console.warn(
                    '[aggregateDomainPerformance] Test not found or has no parts'
                );
                return [];
            }

            // Build question map: questionNumber -> domains[]
            const questionDomainMap = new Map<number, string[]>();
            let questionCounter = 1;

            for (const part of test.parts) {
                const questions = part.questions || [];
                const questionGroups = part.questionGroups || [];

                // Process direct questions
                for (const q of questions) {
                    if (q.contentTags?.domain) {
                        questionDomainMap.set(
                            questionCounter,
                            q.contentTags.domain
                        );
                    }
                    questionCounter++;
                }

                // Process question groups
                for (const group of questionGroups) {
                    for (const q of group.questions || []) {
                        if (q.contentTags?.domain) {
                            questionDomainMap.set(
                                questionCounter,
                                q.contentTags.domain
                            );
                        }
                        questionCounter++;
                    }
                }
            }

            // Aggregate domain performance
            const domainMap = new Map<
                string,
                { total: number; correct: number }
            >();

            for (const userAnswer of testResult.userAnswers) {
                const domains = questionDomainMap.get(
                    userAnswer.questionNumber
                );
                if (domains && domains.length > 0) {
                    for (const domain of domains) {
                        const existing = domainMap.get(domain) || {
                            total: 0,
                            correct: 0,
                        };
                        existing.total += 1;
                        if (userAnswer.isCorrect) {
                            existing.correct += 1;
                        }
                        domainMap.set(domain, existing);
                    }
                }
            }

            // Convert to array and sort by accuracy
            const result = [];
            for (const [domain, data] of domainMap.entries()) {
                const accuracy = (data.correct / data.total) * 100;
                result.push({
                    domain,
                    totalQuestions: data.total,
                    correctAnswers: data.correct,
                    accuracy,
                    isWeak: accuracy < 60,
                });
            }

            return result.sort((a, b) => a.accuracy - b.accuracy);
        } catch (error) {
            console.error('[aggregateDomainPerformance] Error:', error);
            return [];
        }
    }

    private getBenchmarkAccuracy(skillKey: string, userLevel: string): number {
        return BENCHMARK_DATA[skillKey]?.[userLevel] || 60;
    }

    private formatCategoryName(category: string): string {
        if (!category) return 'General';
        return category
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (str) => str.toUpperCase())
            .trim();
    }
}

export const weaknessDetectorService = new WeaknessDetectorService();
