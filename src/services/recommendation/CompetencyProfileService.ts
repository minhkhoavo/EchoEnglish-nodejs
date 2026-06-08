import { Schema } from 'mongoose';
import { User } from '../../models/userModel.js';
import { TestResult } from '../../models/testResultModel.js';
interface AIInsight {
    title: string;
    description: string;
    actionText?: string;
    priority: 'high' | 'medium' | 'low';
}

interface ScorePrediction {
    overallScore: number;
    targetScore?: number;
    cefrLevel: string;
    listeningScore: number;
    readingScore: number;
    summary: string;
}

interface SkillMapItem {
    skillName: string;
    percentage: number;
}

export class CompetencyProfileService {
    async updateFromTestResult(
        userId: Schema.Types.ObjectId | string,
        testResultId: Schema.Types.ObjectId | string
    ): Promise<void> {
        const user = await User.findById(userId);
        const testResult = await TestResult.findById(testResultId);

        if (!user || !testResult) {
            throw new Error('User or test result not found');
        }

        // Initialize competencyProfile if not exists
        if (!user.competencyProfile) {
            user.competencyProfile = {
                skillMatrix: [],
                domainProficiency: [],
                scoreHistory: [],
            };
        }

        // Update score history
        user.competencyProfile.scoreHistory.push({
            testResultId: testResult._id,
            date: testResult.completedAt,
            totalScore: testResult.totalScore,
            listeningScore: testResult.listeningScore,
            readingScore: testResult.readingScore,
        });

        // Update CEFR level based on score
        user.competencyProfile.currentCEFRLevel = this.determineCEFRLevel(
            testResult.totalScore
        );

        // Update skill matrix from test analysis
        if (testResult.analysis?.examAnalysis?.partAnalyses) {
            for (const partAnalysis of testResult.analysis.examAnalysis
                .partAnalyses) {
                if (partAnalysis.skillBreakdown) {
                    for (const skill of partAnalysis.skillBreakdown) {
                        await this.updateSkillMatrix(
                            user,
                            skill.skillKey,
                            skill.accuracy,
                            skill.total,
                            skill.correct,
                            testResult._id
                        );
                    }
                }
            }
        }

        // Update domain proficiency from test
        if (testResult.analysis?.examAnalysis?.domainPerformance) {
            for (const domainPerf of testResult.analysis.examAnalysis
                .domainPerformance) {
                await this.updateDomainProficiency(
                    user,
                    domainPerf.domain,
                    domainPerf.accuracy,
                    domainPerf.totalQuestions,
                    domainPerf.correctAnswers
                );
            }
        }

        user.competencyProfile.lastUpdated = new Date();
        await user.save();
        console.log('Updated competency profile from test result');
    }

    async generateDailyInsights(
        userId: Schema.Types.ObjectId | string
    ): Promise<void> {
        const user = await User.findById(userId);
        if (!user) {
            throw new Error(`User not found: ${userId}`);
        }

        const aiInsights = await this.generateAIInsights(
            user.competencyProfile
        );
        const scorePrediction = await this.generateScorePrediction(userId);
        const skillsMap = await this.generateSkillsMap(user.competencyProfile);
        await this.updateUserCompetencyProfile(userId, {
            aiInsights,
            scorePrediction,
            skillsMap,
        });

        console.log('Daily AI insights updated successfully');
    }

    private async generateAIInsights(competencyProfile: {
        skillMatrix: Array<{
            skill: string;
            currentAccuracy: number;
        }>;
        domainProficiency: Array<{
            domain: string;
            accuracy: number;
        }>;
    }): Promise<AIInsight[]> {
        const insights: AIInsight[] = [];

        if (!competencyProfile) return insights;

        // 1. Priority Weakness Analysis
        const weakestSkills =
            competencyProfile.skillMatrix
                ?.filter((s) => s.currentAccuracy < 70)
                .sort((a, b) => a.currentAccuracy - b.currentAccuracy)
                .slice(0, 3) || [];

        if (weakestSkills.length > 0) {
            const weakestSkill = weakestSkills[0];
            insights.push({
                title: `Priority Weakness: ${weakestSkill.skill}`,
                description: `Your accuracy in ${weakestSkill.skill} is ${weakestSkill.currentAccuracy}%. This skill is crucial for achieving high scores.`,
                actionText: `Start ${weakestSkill.skill} Training`,
                priority: 'high',
            });
        }

        // 2. Grammar Gap Analysis
        const weakGrammar = competencyProfile.skillMatrix
            ?.filter(
                (s) =>
                    s.skill.includes('grammar') || s.skill.includes('word_form')
            )
            .find((s) => s.currentAccuracy < 70);

        if (weakGrammar) {
            insights.push({
                title: `Grammar Gap: ${weakGrammar.skill}`,
                description: `You frequently struggle with ${weakGrammar.skill}. Focus on strengthening this fundamental grammar point.`,
                actionText: 'Practice Grammar',
                priority: 'medium',
            });
        }

        // 3. Domain Analysis
        const weakestDomain = competencyProfile.domainProficiency
            ?.filter((d) => d.accuracy < 70)
            .sort((a, b) => a.accuracy - b.accuracy)[0];

        if (weakestDomain) {
            insights.push({
                title: `Content Area: ${weakestDomain.domain} Vocabulary`,
                description: `Your error rate on ${weakestDomain.domain} topics is significantly higher than other domains.`,
                actionText: 'Build Vocabulary',
                priority: 'medium',
            });
        }

        return insights.slice(0, 4); // Return max 4 insights
    }

    private async generateScorePrediction(
        userId: Schema.Types.ObjectId | string
    ): Promise<ScorePrediction> {
        const recentTests = await TestResult.find({ userId })
            .sort({ completedAt: -1 })
            .limit(5)
            .select('totalScore listeningScore readingScore');

        const averageScore =
            recentTests.length > 0
                ? recentTests.reduce(
                      (sum, test) => sum + (test.totalScore || 0),
                      0
                  ) / recentTests.length
                : 400;

        const averageListeningScore =
            recentTests.length > 0
                ? recentTests.reduce(
                      (sum, test) => sum + (test.listeningScore || 0),
                      0
                  ) / recentTests.length
                : Math.round(averageScore * 0.5);

        const averageReadingScore =
            recentTests.length > 0
                ? recentTests.reduce(
                      (sum, test) => sum + (test.readingScore || 0),
                      0
                  ) / recentTests.length
                : Math.round(averageScore * 0.5);

        const cefrLevel = this.scoreToCEFR(averageScore);
        const targetScore = 800;

        const summary =
            averageScore >= 800
                ? "Excellent! You're already at an advanced level. Let's maintain and polish your skills."
                : averageScore >= 600
                  ? `You have a solid foundation. Let's work together to reach ${targetScore}+!`
                  : averageScore >= 400
                    ? 'Good start! With focused practice, you can significantly improve your score.'
                    : "Let's build a strong foundation together. Every step counts toward your goal!";

        return {
            overallScore: averageScore,
            targetScore,
            cefrLevel,
            listeningScore: Math.round(averageListeningScore),
            readingScore: Math.round(averageReadingScore),
            summary,
        };
    }

    private async generateSkillsMap(competencyProfile: {
        skillMatrix: Array<{ skill: string; currentAccuracy: number }>;
    }): Promise<SkillMapItem[]> {
        const coreGroups: Record<string, string[]> = {
            Inference: ['INFERENCE'],
            'Detail Finding': ['DETAIL', 'SPECIFIC_ACTION'],
            'Main Idea': ['GIST'],
            Grammar: [
                'GRAMMAR',
                'PRONOUN',
                'CONJUNCTION',
                'COMPARATIVESUPERLATIVE',
                'PREPOSITION',
                'WORDFORM',
                'VERBTENSEMOOD',
                'SENTENCEINSERTION',
            ],
            Vocabulary: ['VOCABULARY', 'COLLOCATION', 'WORDCHOICE'],
            'Cross-Reference': ['COHESION', 'SENTENCEINSERTION', 'OTHERS'],
        };

        const skillIndex = new Map<string, number>();
        for (const item of competencyProfile.skillMatrix || []) {
            skillIndex.set(
                item.skill.trim().toUpperCase(),
                Number(item.currentAccuracy) || 0
            );
        }

        return Object.entries(coreGroups).map(([skillName, memberKeys]) => {
            let sumAccuracy = 0,
                count = 0;
            for (const key of memberKeys) {
                const acc = skillIndex.get(key.toUpperCase());
                if (typeof acc === 'number') {
                    sumAccuracy += acc;
                    count += 1;
                }
            }
            const avg = count === 0 ? 0 : sumAccuracy / count;
            return { skillName, percentage: Math.round(avg * 10) / 10 };
        });
    }

    private scoreToCEFR(score: number): string {
        if (score >= 945) return 'C2';
        if (score >= 785) return 'C1';
        if (score >= 550) return 'B2';
        if (score >= 225) return 'B1';
        if (score >= 120) return 'A2';
        return 'A1';
    }

    private async updateSkillMatrix(
        user: typeof User.prototype,
        skillKey: string,
        accuracy: number,
        totalQuestions: number,
        correctAnswers: number,
        sourceId: Schema.Types.ObjectId
    ): Promise<void> {
        let skillEntry = user.competencyProfile.skillMatrix.find(
            (s: { skill: string }) => s.skill === skillKey
        );

        if (!skillEntry) {
            // Create new entry
            skillEntry = {
                skill: skillKey,
                accuracyHistory: [],
                currentAccuracy: accuracy,
                proficiency: this.determineProficiency(accuracy),
                totalQuestions: 0,
                correctAnswers: 0,
            };
            user.competencyProfile.skillMatrix.push(skillEntry);
        }

        // Add to history
        skillEntry.accuracyHistory.push({
            value: accuracy,
            testResultId: sourceId,
            date: new Date(),
        });

        // Update aggregates
        skillEntry.totalQuestions += totalQuestions;
        skillEntry.correctAnswers += correctAnswers;
        skillEntry.currentAccuracy =
            (skillEntry.correctAnswers / skillEntry.totalQuestions) * 100;
        skillEntry.proficiency = this.determineProficiency(
            skillEntry.currentAccuracy
        );
        skillEntry.lastPracticed = new Date();
    }

    private async updateDomainProficiency(
        user: typeof User.prototype,
        domain: string,
        accuracy: number,
        totalQuestions: number,
        correctAnswers: number
    ): Promise<void> {
        let domainEntry = user.competencyProfile.domainProficiency.find(
            (d: { domain: string }) => d.domain === domain
        );

        if (!domainEntry) {
            domainEntry = {
                domain,
                accuracy,
                totalQuestions: 0,
                correctAnswers: 0,
            };
            user.competencyProfile.domainProficiency.push(domainEntry);
        }

        // Update aggregates
        domainEntry.totalQuestions += totalQuestions;
        domainEntry.correctAnswers += correctAnswers;
        domainEntry.accuracy =
            (domainEntry.correctAnswers / domainEntry.totalQuestions) * 100;
        domainEntry.lastPracticed = new Date();
    }

    async getProfile(
        userId: Schema.Types.ObjectId | string
    ): Promise<Record<string, unknown> | null> {
        const user = await User.findById(userId).select('competencyProfile');
        return user?.competencyProfile || null;
    }

    async getSkillProgress(
        userId: Schema.Types.ObjectId | string,
        skillKey: string
    ): Promise<Array<{ date: Date; accuracy: number }>> {
        const user = await User.findById(userId);
        if (!user?.competencyProfile) {
            return [];
        }

        const skillEntry = user.competencyProfile.skillMatrix.find(
            (s: { skill: string }) => s.skill === skillKey
        );

        return (
            skillEntry?.accuracyHistory.map(
                (h: { date: Date; value: number }) => ({
                    date: h.date,
                    accuracy: h.value,
                })
            ) || []
        );
    }

    async getWeakSkills(
        userId: Schema.Types.ObjectId | string
    ): Promise<
        Array<{ skill: string; accuracy: number; proficiency: string }>
    > {
        const user = await User.findById(userId);
        if (!user?.competencyProfile) {
            return [];
        }

        return user.competencyProfile.skillMatrix
            .filter(
                (s: { proficiency: string }) =>
                    s.proficiency === 'weak' || s.proficiency === 'developing'
            )
            .sort(
                (
                    a: { currentAccuracy: number },
                    b: { currentAccuracy: number }
                ) => a.currentAccuracy - b.currentAccuracy
            )
            .map(
                (s: {
                    skill: string;
                    currentAccuracy: number;
                    proficiency: string;
                }) => ({
                    skill: s.skill,
                    accuracy: s.currentAccuracy,
                    proficiency: s.proficiency,
                })
            );
    }

    private determineCEFRLevel(score: number): string {
        if (score >= 945) return 'C1';
        if (score >= 785) return 'B2';
        if (score >= 550) return 'B1';
        if (score >= 225) return 'A2';
        return 'A1';
    }

    private determineProficiency(accuracy: number): string {
        if (accuracy >= 85) return 'mastered';
        if (accuracy >= 70) return 'proficient';
        if (accuracy >= 50) return 'developing';
        return 'weak';
    }

    private async updateUserCompetencyProfile(
        userId: Schema.Types.ObjectId | string,
        data: {
            aiInsights: AIInsight[];
            scorePrediction: ScorePrediction;
            skillsMap: SkillMapItem[];
        }
    ): Promise<void> {
        const updateData = {
            'competencyProfile.aiInsights': data.aiInsights.map((insight) => ({
                ...insight,
                createdAt: new Date(),
            })),
            'competencyProfile.scorePrediction': {
                ...data.scorePrediction,
                lastUpdated: new Date(),
            },
            'competencyProfile.skillsMap': data.skillsMap.map((skill) => ({
                ...skill,
                lastUpdated: new Date(),
            })),
            'competencyProfile.lastUpdated': new Date(),
        };

        await User.findByIdAndUpdate(userId, updateData);
    }
}

export const competencyProfileService = new CompetencyProfileService();
