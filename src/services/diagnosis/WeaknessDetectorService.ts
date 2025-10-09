import { Schema } from 'mongoose';
import {
    TestResult,
    ITestResult,
    IDiagnosisInsight,
} from '../../models/testResultModel.js';
import { toeicAnalysisAIService } from '../../ai/service/toeicAnalysisAIService.js';
import { SeverityLevel } from '../../enum/severityLevel.js';
import { PartNumber } from '../../enum/partNumber.js';
import { SkillCategory } from '../../enum/skillCategory.js';
import { PartAnalysis, SkillPerformance } from '../../types/analysisTypes.js';

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

        const weaknesses: IDiagnosisInsight[] = [];
        const skillTotals = this.calculateSkillTotalsFromParts(
            (examAnalysis.partAnalyses || []) as PartAnalysis[]
        );

        if (examAnalysis.overallSkills) {
            const overallSkillsMap =
                examAnalysis.overallSkills instanceof Map
                    ? examAnalysis.overallSkills
                    : new Map(Object.entries(examAnalysis.overallSkills));

            for (const [category, accuracy] of overallSkillsMap.entries()) {
                const userAccuracy =
                    typeof accuracy === 'number' ? accuracy : 0;
                const benchmarkAccuracy = this.getBenchmarkAccuracy(
                    category,
                    userLevel
                );
                const accuracyGap = benchmarkAccuracy - userAccuracy;
                const skillTotal = skillTotals.get(category) || {
                    total: 0,
                    correct: 0,
                };
                const questionCount = skillTotal.total;

                if (userAccuracy < 60) {
                    const severity = this.calculateSeverity(
                        userAccuracy,
                        benchmarkAccuracy,
                        questionCount
                    );
                    const affectedParts = this.getAffectedParts(
                        (examAnalysis.partAnalyses || []) as PartAnalysis[],
                        category
                    );

                    const insight =
                        await toeicAnalysisAIService.generateWeaknessInsight({
                            skillName: this.formatCategoryName(category),
                            skillKey: category,
                            userAccuracy,
                            benchmarkAccuracy,
                            accuracyGap,
                            affectedParts: affectedParts as PartNumber[],
                            totalQuestions: questionCount,
                            incorrectCount: questionCount - skillTotal.correct,
                        });

                    const impactScore = this.calculateImpactScore(
                        severity,
                        questionCount,
                        accuracyGap
                    );

                    weaknesses.push({
                        id: `weakness_${category}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        severity,
                        skillKey: category,
                        skillName: this.formatCategoryName(category),
                        category,
                        title: insight.title,
                        description: insight.description,
                        affectedParts: affectedParts as string[],
                        userAccuracy,
                        benchmarkAccuracy,
                        impactScore,
                        incorrectCount: questionCount - skillTotal.correct,
                        totalCount: questionCount,
                    });
                }
            }
        }

        for (const partAnalysis of examAnalysis.partAnalyses || []) {
            for (const skill of partAnalysis.skillBreakdown) {
                const userAccuracy = skill.accuracy;
                const benchmarkAccuracy = this.getBenchmarkAccuracy(
                    skill.skillKey,
                    userLevel
                );
                const accuracyGap = benchmarkAccuracy - userAccuracy;

                if (
                    userAccuracy < 60 &&
                    !weaknesses.some((w) => w.category === skill.skillKey)
                ) {
                    const severity = this.calculateSeverity(
                        userAccuracy,
                        benchmarkAccuracy,
                        skill.total
                    );

                    const insight =
                        await toeicAnalysisAIService.generateWeaknessInsight({
                            skillName: skill.skillName,
                            skillKey: skill.skillKey,
                            userAccuracy,
                            benchmarkAccuracy,
                            accuracyGap,
                            affectedParts: [
                                partAnalysis.partNumber as PartNumber,
                            ],
                            totalQuestions: skill.total,
                            incorrectCount: skill.total - skill.correct,
                        });

                    const impactScore = this.calculateImpactScore(
                        severity,
                        skill.total,
                        accuracyGap
                    );

                    weaknesses.push({
                        id: `weakness_${skill.skillKey}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        severity,
                        skillKey: skill.skillKey,
                        skillName: skill.skillName,
                        category: skill.skillKey,
                        title: insight.title,
                        description: insight.description,
                        affectedParts: [partAnalysis.partNumber] as string[],
                        userAccuracy,
                        benchmarkAccuracy,
                        impactScore,
                        incorrectCount: skill.total - skill.correct,
                        totalCount: skill.total,
                    });
                }
            }
        }

        weaknesses.sort((a, b) => b.impactScore - a.impactScore);

        await TestResult.findByIdAndUpdate(testResultId, {
            'analysis.examAnalysis.weaknesses': weaknesses,
        });

        return await TestResult.findById(testResultId);
    }

    private calculateSkillTotalsFromParts(partAnalyses: PartAnalysis[]) {
        const skillTotals = new Map<
            string,
            { total: number; correct: number }
        >();

        for (const part of partAnalyses) {
            for (const skill of part.skillBreakdown || []) {
                const existing = skillTotals.get(skill.skillKey) || {
                    total: 0,
                    correct: 0,
                };
                skillTotals.set(skill.skillKey, {
                    total: existing.total + skill.total,
                    correct: existing.correct + skill.correct,
                });
            }
        }

        return skillTotals;
    }

    private determineUserLevel(score: number, totalQuestions: number): string {
        const percentage = (score / totalQuestions) * 100;
        if (percentage >= 75) return 'advanced';
        if (percentage >= 50) return 'intermediate';
        return 'beginner';
    }

    private getBenchmarkAccuracy(skillKey: string, userLevel: string): number {
        return BENCHMARK_DATA[skillKey]?.[userLevel] || 60;
    }

    private calculateSeverity(
        userAccuracy: number,
        benchmarkAccuracy: number,
        questionCount: number
    ): SeverityLevel {
        const gap = benchmarkAccuracy - userAccuracy;
        if (gap > 30 || userAccuracy < 40) return SeverityLevel.CRITICAL;
        if (gap > 20 || userAccuracy < 50) return SeverityLevel.HIGH;
        if (gap > 10 || userAccuracy < 60) return SeverityLevel.MEDIUM;
        return SeverityLevel.LOW;
    }

    private calculateImpactScore(
        severity: SeverityLevel,
        questionCount: number,
        accuracyGap: number
    ): number {
        const severityWeight = {
            [SeverityLevel.CRITICAL]: 100,
            [SeverityLevel.HIGH]: 75,
            [SeverityLevel.MEDIUM]: 50,
            [SeverityLevel.LOW]: 25,
        };
        const weight = severityWeight[severity] || 50;
        const volumeScore = Math.min(questionCount / 20, 1) * 30;
        const gapScore = Math.min(accuracyGap / 50, 1) * 20;
        return Math.round(weight + volumeScore + gapScore);
    }

    private getAffectedParts(
        partAnalyses: PartAnalysis[],
        skillKey: string
    ): string[] {
        const parts: string[] = [];
        for (const part of partAnalyses) {
            if (
                part.skillBreakdown?.some(
                    (s: SkillPerformance) => s.skillKey === skillKey
                )
            ) {
                parts.push(part.partNumber);
            }
        }
        return parts;
    }

    private formatCategoryName(category: string): string {
        return category
            .split('_')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    }
}

export const weaknessDetectorService = new WeaknessDetectorService();
