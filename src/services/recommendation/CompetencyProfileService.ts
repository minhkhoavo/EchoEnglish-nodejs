import { Schema } from 'mongoose';
import { User } from '../../models/userModel.js';
import { TestResult } from '../../models/testResultModel.js';
import { StudyPlan } from '../../models/studyPlanModel.js';

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
}

export const competencyProfileService = new CompetencyProfileService();
