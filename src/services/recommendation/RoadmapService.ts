import { Schema, Types } from 'mongoose';
import {
    DailyFocusType,
    Roadmap,
    RoadmapType,
} from '../../models/roadmapModel.js';
import { TestResult } from '../../models/testResultModel.js';
import { learningPlanAIService } from '~/ai/service/learningPlanAIService.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { User } from '~/models/userModel.js';

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
            targetScore: number;
            studyTimePerDay: number;
            studyDaysPerWeek: number;
            testResultId?: Schema.Types.ObjectId;
            weaknesses?: WeaknessData[];
        }
    ): Promise<RoadmapType> {
        console.log('Generating roadmap using LLM for user:', userId);

        // Fetch user preferences
        const user = await User.findById(userId).select('preferences').lean();
        const userPreferences =
            user && !Array.isArray(user) && user.preferences
                ? {
                      primaryGoal: user.preferences.primaryGoal,
                      currentLevel: user.preferences.currentLevel,
                      preferredStudyTime: user.preferences.preferredStudyTime,
                      contentInterests: user.preferences.contentInterests,
                  }
                : undefined;

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
            targetScore: input.targetScore,
            studyTimePerDay: input.studyTimePerDay,
            studyDaysPerWeek: input.studyDaysPerWeek,
            userPreferences,
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
        return Roadmap.findOne({ userId, status: 'active' }).lean().exec();
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

    async updateRoadmapScheduleFromUserPreferences(
        userId: Types.ObjectId
    ): Promise<void> {
        const user = await User.findById(userId).select(
            'preferences.studyDaysOfWeek'
        );
        if (!user?.preferences?.studyDaysOfWeek) {
            throw new Error('User study days preferences not found');
        }

        const activeRoadmaps = await Roadmap.find({
            userId,
            status: { $in: ['active', 'draft'] },
        });

        for (const roadmap of activeRoadmaps) {
            roadmap.updateDayOfWeekFromUserPreferences(
                user.preferences.studyDaysOfWeek
            );
            await roadmap.save();
        }
    }

    async checkRoadmapBlocked(roadmapId: string): Promise<{
        isBlocked: boolean;
        blockedDailyFocus?: DailyFocusType;
        currentWeek?: number;
    }> {
        const roadmap = await Roadmap.findOne({ roadmapId });
        if (!roadmap) {
            throw new ApiError(ErrorMessage.ROADMAP_NOT_FOUND);
        }

        const isBlocked = roadmap.isBlocked;
        const blockedDailyFocus = roadmap.blockedDailyFocus;

        return {
            isBlocked,
            blockedDailyFocus,
            currentWeek: roadmap.currentWeek,
        };
    }

    async completeDailySession(
        roadmapId: string,
        weekNumber: number,
        dayNumber: number
    ): Promise<{
        success: boolean;
        canProceed: boolean;
        message: string;
    }> {
        const roadmap = await Roadmap.findOne({ roadmapId });
        if (!roadmap) {
            throw new ApiError(ErrorMessage.ROADMAP_NOT_FOUND);
        }

        roadmap.completeDailySession(weekNumber, dayNumber);
        roadmap.sessionsCompleted += 1;
        const stillBlocked = roadmap.isBlocked;

        await roadmap.save();

        return {
            success: true,
            canProceed: !stillBlocked,
            message: stillBlocked
                ? 'Daily session completed but roadmap is still blocked by other critical sessions'
                : 'Daily session completed. Roadmap is now unblocked',
        };
    }

    async updateDailyFocusStatus(
        roadmapId: string,
        weekNumber: number,
        dayNumber: number,
        status: 'pending' | 'upcoming' | 'in-progress' | 'completed' | 'skipped'
    ): Promise<void> {
        const roadmap = await Roadmap.findOneAndUpdate(
            {
                roadmapId,
                'weeklyFocuses.weekNumber': weekNumber,
                'weeklyFocuses.dailyFocuses.dayNumber': dayNumber,
            },
            {
                $set: {
                    'weeklyFocuses.$[week].dailyFocuses.$[day].status': status,
                },
            },
            {
                arrayFilters: [
                    { 'week.weekNumber': weekNumber },
                    { 'day.dayNumber': dayNumber },
                ],
            }
        );

        if (!roadmap) {
            throw new ApiError(ErrorMessage.ROADMAP_NOT_FOUND);
        }
    }
}

export const roadmapService = new RoadmapService();
