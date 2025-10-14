import { Schema } from 'mongoose';
import { Roadmap, RoadmapType } from '../../models/roadmapModel.js';
import { TestResult } from '../../models/testResultModel.js';
import { learningPlanAIService } from '~/ai/service/learningPlanAIService.js';

interface WeaknessData {
    skillKey: string;
    skillName: string;
    severity: string;
    category: string;
    accuracy: number;
}

export class RoadmapService {
    async generateRoadmap(
        userId: Schema.Types.ObjectId | string,
        input: {
            userPrompt?: string;
            currentScore?: number;
            targetScore: number;
            studyTimePerDay: number;
            studyDaysPerWeek: number;
            testResultId?: Schema.Types.ObjectId;
            weaknesses?: WeaknessData[];
        }
    ): Promise<RoadmapType> {
        console.log('Generating roadmap using LLM for user:', userId);

        let testAnalysis = null;
        if (input.testResultId) {
            const testResult = await TestResult.findById(input.testResultId);
            if (testResult) {
                testAnalysis = {
                    score: testResult.totalScore,
                    weaknesses:
                        testResult.analysis?.examAnalysis?.topWeaknesses || [],
                    strengths:
                        testResult.analysis?.examAnalysis?.strengths || [],
                    domainsPerformance:
                        testResult.analysis?.examAnalysis?.domainPerformance ||
                        [],
                    summary: testResult.analysis?.examAnalysis?.summary || '',
                };
            }
        }

        const context = {
            userId: userId.toString(),
            userPrompt: input.userPrompt || 'I want to improve my TOEIC score',
            currentScore: input.currentScore || 0,
            targetScore: input.targetScore,
            studyTimePerDay: input.studyTimePerDay,
            studyDaysPerWeek: input.studyDaysPerWeek,
            testAnalysis,
            providedWeaknesses: input.weaknesses,
        };

        const llmResponse = await learningPlanAIService.generateLearningRoadmap(
            {
                ...context,
                testAnalysis: testAnalysis || undefined,
            }
        );

        const roadmapId = `RM_${userId}_${Date.now()}`;
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + llmResponse.totalWeeks * 7);

        const roadmap = await Roadmap.create({
            userId,
            roadmapId,
            userPrompt: input.userPrompt,
            currentLevel: llmResponse.currentLevel,
            currentScore: input.currentScore,
            targetScore: input.targetScore,
            startDate,
            endDate,
            totalWeeks: llmResponse.totalWeeks,
            studyTimePerDay: input.studyTimePerDay,
            studyDaysPerWeek: input.studyDaysPerWeek,
            learningStrategy: llmResponse.learningStrategy,
            phaseSummary: llmResponse.phaseSummary || [],
            weeklyFocuses: llmResponse.weeklyFocuses,
            totalSessions: llmResponse.totalWeeks * input.studyDaysPerWeek,
            status: 'active',
            testResultId: input.testResultId,
        });

        console.log('Roadmap saved');
        return roadmap;
    }

    async getActiveRoadmap(userId: Schema.Types.ObjectId | string) {
        return await Roadmap.findOne({ userId, status: 'active' });
    }

    async updateProgress(roadmapId: string, sessionCompleted: boolean) {
        const roadmap = await Roadmap.findOne({ roadmapId });
        if (!roadmap) {
            throw new Error(`Roadmap not found: ${roadmapId}`);
        }

        if (sessionCompleted) {
            roadmap.sessionsCompleted = (roadmap.sessionsCompleted || 0) + 1;
            roadmap.overallProgress = Math.round(
                (roadmap.sessionsCompleted / (roadmap.totalSessions || 1)) * 100
            );
        }

        await roadmap.save();
        return roadmap;
    }
}

export const roadmapService = new RoadmapService();
