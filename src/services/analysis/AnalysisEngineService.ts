import { Schema } from 'mongoose';
import {
    TestResult,
    ITestResult,
    IPartAnalysis,
} from '../../models/testResultModel.js';
import testService from '../../services/testService.js';
import { SkillCategory } from '../../enum/skillCategory.js';

export type QuestionMeta = {
    questionNumber: number;
    part?: string;
    skillTags?: { [key: string]: unknown };
    contentTags?: { [key: string]: unknown };
    raw?: { [key: string]: unknown };
};

type SkillBreakdownLocal = {
    skillKey: string;
    skillName: string;
    accuracy: number;
    correct: number;
    total: number;
    avgTime?: number;
};

type PartAnalysisLocal = {
    part: string;
    accuracy: number;
    correct: number;
    total: number;
    skillBreakdown: SkillBreakdownLocal[];
    averageTimePerQuestion?: number;
    contextualAnalysis?: string;
};

export class AnalysisEngineService {
    async analyzeTestResult(
        testResultId: Schema.Types.ObjectId | string
    ): Promise<ITestResult | null> {
        console.log('STARTING ANALYSIS for testResultId:', testResultId);

        const testResult = await TestResult.findById(testResultId);
        if (!testResult) {
            throw new Error(`TestResult not found: ${testResultId}`);
        }

        const testDef = await testService.getTestById(
            testResult.testId.toString()
        );
        if (!testDef) {
            throw new Error(
                `Test definition not found for testId ${testResult.testId}`
            );
        }

        const answeredQuestionNumbers = new Set(
            testResult.userAnswers.map((a) => a.questionNumber)
        );
        const metadata: QuestionMeta[] = [];
        if (Array.isArray(testDef.parts)) {
            for (const part of testDef.parts) {
                const partIdentifier = (part.partName || '')
                    .replace(/\s+/g, '')
                    .toLowerCase();

                if (Array.isArray(part.questions)) {
                    for (const q of part.questions) {
                        if (answeredQuestionNumbers.has(q.questionNumber)) {
                            metadata.push({
                                questionNumber: q.questionNumber,
                                part:
                                    q.skillTags?.part ||
                                    partIdentifier ||
                                    q.part ||
                                    q.partName ||
                                    'unknown',
                                skillTags: q.skillTags || {},
                                contentTags: q.contentTags || {},
                                raw: q,
                            });
                        }
                    }
                } else if (Array.isArray(part.questionGroups)) {
                    for (const group of part.questionGroups) {
                        if (Array.isArray(group.questions)) {
                            for (const q of group.questions) {
                                if (
                                    answeredQuestionNumbers.has(
                                        q.questionNumber
                                    )
                                ) {
                                    metadata.push({
                                        questionNumber: q.questionNumber,
                                        part:
                                            q.skillTags?.part ||
                                            partIdentifier ||
                                            q.part ||
                                            q.partName ||
                                            'unknown',
                                        skillTags: q.skillTags || {},
                                        contentTags: q.contentTags || {},
                                        raw: q,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        const overallSkills = await this.calculateOverallSkills(
            testResult,
            metadata
        );
        const partAnalyses: PartAnalysisLocal[] = await this.analyzeByPart(
            testResult,
            metadata
        );

        const listeningScore = testResult.listeningScore ?? 0;
        const readingScore = testResult.readingScore ?? 0;

        const overallSkillsMap = new Map<string, number>();
        Object.values(SkillCategory).forEach((cat) => {
            overallSkillsMap.set(cat, overallSkills[cat]?.accuracy ?? 0);
        });

        const transformedParts: IPartAnalysis[] = partAnalyses.map((p) => {
            const partNumber = String(p.part)
                .replace(/part\s*/i, '')
                .trim();
            const skillBreakdown = (p.skillBreakdown || []).map((s) => ({
                skillName: s.skillName,
                skillKey: s.skillKey,
                total: s.total ?? 0,
                correct: s.correct ?? 0,
                incorrect: (s.total ?? 0) - (s.correct ?? 0),
                accuracy: s.accuracy ?? 0,
                avgTime: s.avgTime ?? undefined,
            }));

            return {
                partNumber: partNumber,
                totalQuestions: p.total ?? 0,
                correctAnswers: p.correct ?? 0,
                accuracy: p.accuracy ?? 0,
                avgTimePerQuestion: p.averageTimePerQuestion ?? undefined,
                skillBreakdown,
                contextualAnalysis: p.contextualAnalysis ?? undefined,
            };
        });

        const updatedResult = await TestResult.findByIdAndUpdate(
            testResultId,
            {
                listeningScore,
                readingScore,
                'analysis.examAnalysis': {
                    overallSkills: Object.fromEntries(overallSkillsMap),
                    partAnalyses: transformedParts,
                    weaknesses: [],
                    strengths: [],
                },
            },
            { new: true }
        );

        console.log('ANALYSIS COMPLETE for testResultId:', testResultId);
        return updatedResult;
    }

    async calculateOverallSkills(
        testResult: ITestResult,
        metadata: QuestionMeta[]
    ) {
        const skillStats = new Map<
            string,
            { correct: number; total: number }
        >();

        Object.values(SkillCategory).forEach((category) => {
            skillStats.set(category, { correct: 0, total: 0 });
        });

        for (const answer of testResult.userAnswers) {
            const meta = metadata.find(
                (m) => m.questionNumber === answer.questionNumber
            );
            if (!meta) {
                console.warn(
                    `No metadata found for answered question ${answer.questionNumber}`
                );
                continue;
            }

            const category = this.extractSkillKey(meta);
            const stats = skillStats.get(category);
            if (!stats) {
                continue;
            }

            stats.total++;
            if (answer.isCorrect) {
                stats.correct++;
            }
        }

        const dimensions: Record<
            string,
            { accuracy: number; correct: number; total: number }
        > = {};

        for (const [category, stats] of skillStats.entries()) {
            if (stats.total > 0) {
                dimensions[category] = {
                    accuracy: Math.round((stats.correct / stats.total) * 100),
                    correct: stats.correct,
                    total: stats.total,
                };
            }
        }

        return dimensions;
    }

    async analyzeByPart(testResult: ITestResult, metadata: QuestionMeta[]) {
        const partStats = new Map<
            string,
            {
                correct: number;
                total: number;
                skills: Map<string, { correct: number; total: number }>;
            }
        >();

        for (const answer of testResult.userAnswers) {
            const meta = metadata.find(
                (m) => m.questionNumber === answer.questionNumber
            );
            if (!meta) continue;

            const part = String(meta.part || meta.raw?.partName || 'unknown');
            if (!partStats.has(part)) {
                partStats.set(part, {
                    correct: 0,
                    total: 0,
                    skills: new Map(),
                });
            }

            const stats = partStats.get(part)!;
            stats.total++;
            if (answer.isCorrect) {
                stats.correct++;
            }

            const skillKey = this.extractSkillKey(meta);
            if (!stats.skills.has(skillKey)) {
                stats.skills.set(skillKey, { correct: 0, total: 0 });
            }

            const skillStats = stats.skills.get(skillKey)!;
            skillStats.total++;
            if (answer.isCorrect) {
                skillStats.correct++;
            }
        }

        const analyses = [];

        for (const [part, stats] of partStats.entries()) {
            const skillBreakdown: Array<{
                skillKey: string;
                skillName: string;
                accuracy: number;
                correct: number;
                total: number;
            }> = [];

            for (const [skillKey, skillStats] of stats.skills.entries()) {
                skillBreakdown.push({
                    skillKey,
                    skillName: this.getSkillDisplayName(skillKey),
                    accuracy: Math.round(
                        (skillStats.correct / skillStats.total) * 100
                    ),
                    correct: skillStats.correct,
                    total: skillStats.total,
                });
            }

            analyses.push({
                part,
                accuracy: Math.round((stats.correct / stats.total) * 100),
                correct: stats.correct,
                total: stats.total,
                skillBreakdown: skillBreakdown.sort(
                    (a, b) => a.accuracy - b.accuracy
                ),
            });
        }

        return analyses;
    }

    async getAnalysisResult(
        testResultId: Schema.Types.ObjectId | string
    ): Promise<ITestResult | null> {
        return await TestResult.findById(testResultId);
    }

    async getAnalysisById(
        testResultId: Schema.Types.ObjectId | string
    ): Promise<ITestResult | null> {
        return await TestResult.findById(testResultId);
    }

    private extractSkillKey(meta: QuestionMeta): string {
        const tags = meta.skillTags || {};
        const part = String(meta.part || tags.part || '')
            .toLowerCase()
            .replace(/\s+/g, '');

        // Part 3, 4, 7: Use skillCategory if available, otherwise skillDetail
        const skillCategory = (tags as Record<string, unknown>)
            .skillCategory as string | undefined;
        if (skillCategory) {
            return skillCategory;
        }

        const skillDetail = (tags as Record<string, unknown>).skillDetail as
            | string
            | undefined;
        if (skillDetail) {
            return this.normalizeSkillKey(skillDetail);
        }

        // Part 1: Check skills array for specific skills (camelCase)
        if (part.includes('1') || part === 'part1') {
            const skills = (tags as Record<string, unknown>).skills as
                | string[]
                | undefined;
            if (skills && skills.length > 0) {
                // Normalize to camelCase (handle both old snake_case and new camelCase)
                return this.normalizeSkillKey(skills[0]);
            }
            return SkillCategory.OTHERS;
        }

        // Part 2: Use questionFunction first (for aggregation), then questionForm
        if (part.includes('2') || part === 'part2') {
            const questionFunction = (tags as Record<string, unknown>)
                .questionFunction as string | undefined;
            const questionForm = (tags as Record<string, unknown>)
                .questionForm as string | undefined;

            if (questionFunction) {
                const normalized = this.normalizeSkillKey(questionFunction);
                // Map question functions to skill categories for aggregation
                if (normalized === 'informationSeeking')
                    return SkillCategory.DETAIL;
                if (normalized === 'request' || normalized === 'suggestion')
                    return SkillCategory.SPECIFIC_ACTION;
                return normalized;
            }

            if (questionForm) {
                return this.normalizeSkillKey(questionForm);
            }

            return SkillCategory.OTHERS;
        }

        // Part 5: Check grammarPoint and vocabPoint
        if (part.includes('5') || part === 'part5') {
            const grammarPoint = (tags as Record<string, unknown>)
                .grammarPoint as string | undefined;
            if (grammarPoint) {
                return this.normalizeSkillKey(grammarPoint);
            }
            const vocabPoint = (tags as Record<string, unknown>).vocabPoint as
                | string
                | undefined;
            if (vocabPoint) {
                return this.normalizeSkillKey(vocabPoint);
            }
            return SkillCategory.OTHERS;
        }

        // Part 6: Check tagType, grammarPoint, or vocabPoint
        if (part.includes('6') || part === 'part6') {
            const tagType = (tags as Record<string, unknown>).tagType as
                | string
                | undefined;
            if (tagType) {
                if (tagType === 'grammar') {
                    const grammarPoint = (tags as Record<string, unknown>)
                        .grammarPoint as string | undefined;
                    return grammarPoint
                        ? this.normalizeSkillKey(grammarPoint)
                        : SkillCategory.GRAMMAR;
                }
                if (tagType === 'vocabulary') {
                    const vocabPoint = (tags as Record<string, unknown>)
                        .vocabPoint as string | undefined;
                    return vocabPoint
                        ? this.normalizeSkillKey(vocabPoint)
                        : SkillCategory.VOCABULARY;
                }
                if (
                    tagType === 'sentenceInsertion' ||
                    tagType === 'sentence_insertion'
                )
                    return 'sentenceInsertion';
                if (
                    tagType === 'discourseConnector' ||
                    tagType === 'discourse_connector'
                )
                    return SkillCategory.COHESION;
            }
            return SkillCategory.OTHERS;
        }

        return SkillCategory.OTHERS;
    }

    private getSkillDisplayName(skillKey: string): string {
        // Handle all-uppercase keys (like GIST, DETAIL, INFERENCE)
        if (skillKey === skillKey.toUpperCase()) {
            return (
                skillKey.charAt(0).toUpperCase() +
                skillKey.slice(1).toLowerCase()
            );
        }

        // Convert camelCase to Title Case with spaces
        return skillKey
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (str) => str.toUpperCase())
            .trim();
    }

    private normalizeSkillKey(key: string): string {
        // If already in camelCase, return as is
        if (!key.includes('_')) {
            return key;
        }

        // Convert snake_case to camelCase
        return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    }

    async deleteAnalysis(
        analysisId: Schema.Types.ObjectId | string
    ): Promise<boolean> {
        const result = await TestResult.findByIdAndUpdate(
            analysisId,
            { $unset: { analysis: 1 } },
            { new: true }
        );
        return !!result;
    }
}

export const analysisEngineService = new AnalysisEngineService();
