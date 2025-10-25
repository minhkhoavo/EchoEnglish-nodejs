import { Schema } from 'mongoose';
import { Roadmap, RoadmapType } from '~/models/roadmapModel.js';
import { User } from '~/models/userModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

interface MissedSession {
    weekNumber: number;
    dayNumber: number;
    focus: string;
    targetSkills: string[];
    suggestedDomains: string[];
}

export class RoadmapCalibrationService {
    async checkMissedSessions(userId: Schema.Types.ObjectId | string): Promise<{
        hasMissedSessions: boolean;
        missedCount: number;
        message: string;
        action: 'mark_skipped' | 'regenerate_week' | 'none';
        missedSessions: Array<{
            weekNumber: number;
            dayNumber: number;
            focus: string;
        }>;
    }> {
        const roadmap = await Roadmap.findOne({
            userId,
            status: 'active',
        });

        if (!roadmap) {
            throw new ApiError(ErrorMessage.ROADMAP_NOT_FOUND);
        }

        const user = await User.findById(userId).select('preferences').lean();

        if (
            !user ||
            Array.isArray(user) ||
            !user.preferences?.studyDaysOfWeek
        ) {
            return {
                hasMissedSessions: false,
                missedCount: 0,
                message: 'Roadmap is up to date',
                action: 'none',
                missedSessions: [],
            };
        }

        const studyDaysOfWeek = user.preferences.studyDaysOfWeek;
        const missedSessions = await this.identifyMissedSessions(
            roadmap,
            studyDaysOfWeek
        );

        if (missedSessions.length === 0) {
            return {
                hasMissedSessions: false,
                missedCount: 0,
                message: 'Roadmap is up to date',
                action: 'none',
                missedSessions: [],
            };
        }

        // If missed sessions <= 2: mark as skipped and allow catch-up
        if (missedSessions.length <= 2) {
            await this.markMissedSessions(roadmap, missedSessions);

            return {
                hasMissedSessions: true,
                missedCount: missedSessions.length,
                message: `You missed ${missedSessions.length} session(s). They will be reviewed in your next study session.`,
                action: 'mark_skipped',
                missedSessions: missedSessions.map((s) => ({
                    weekNumber: s.weekNumber,
                    dayNumber: s.dayNumber,
                    focus: s.focus,
                })),
            };
        }

        // If missed sessions > 2: regenerate content for the entire week
        // TODO: Implement regenerateWeekContent() - call LLM to recreate dailyFocuses
        await this.regenerateWeekContent(roadmap, roadmap.activeWeekNumber);

        return {
            hasMissedSessions: true,
            missedCount: missedSessions.length,
            message: `You missed ${missedSessions.length} sessions. Your week plan has been regenerated to fit your current schedule.`,
            action: 'regenerate_week',
            missedSessions: missedSessions.map((s) => ({
                weekNumber: s.weekNumber,
                dayNumber: s.dayNumber,
                focus: s.focus,
            })),
        };
    }

    // Identify missed study sessions based on studyDaysOfWeek
    private async identifyMissedSessions(
        roadmap: RoadmapType,
        studyDaysOfWeek: number[]
    ): Promise<MissedSession[]> {
        const missedSessions: MissedSession[] = [];
        const activeWeek = roadmap.weeklyFocuses.find(
            (w) => w.weekNumber === roadmap.activeWeekNumber
        );

        if (!activeWeek || !activeWeek.dailyFocuses) {
            return missedSessions;
        }

        const today = new Date();
        const currentDayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ...

        // Find dailyFocuses that have dayOfWeek in studyDaysOfWeek and are not completed
        for (const daily of activeWeek.dailyFocuses) {
            // Skip if completed or skipped
            if (daily.status === 'completed' || daily.status === 'skipped') {
                continue;
            }
            // Check if it's a study day
            if (!studyDaysOfWeek.includes(daily.dayOfWeek)) {
                continue;
            }

            // Check if this study day has passed (compared to today)
            // If dayOfWeek < currentDayOfWeek → missed in this week
            if (daily.dayOfWeek < currentDayOfWeek && daily.dayOfWeek > 0) {
                missedSessions.push({
                    weekNumber: activeWeek.weekNumber,
                    dayNumber: daily.dayNumber,
                    focus: daily.focus,
                    targetSkills: daily.targetSkills || [],
                    suggestedDomains: daily.suggestedDomains || [],
                });
            }
        }
        console.log('Missed Sessions Identified:', missedSessions);
        return missedSessions;
    }

    /**
     * Mark missed study sessions (no new content added, just update status)
     */
    private async markMissedSessions(
        roadmap: RoadmapType,
        missedSessions: MissedSession[]
    ): Promise<void> {
        const activeWeek = roadmap.weeklyFocuses.find(
            (w) => w.weekNumber === roadmap.activeWeekNumber
        );

        if (!activeWeek || !activeWeek.dailyFocuses) {
            return;
        }
        console.log('Marking Missed Sessions:', missedSessions);
        // Mark missed dailyFocuses
        for (const missed of missedSessions) {
            const daily = activeWeek.dailyFocuses.find(
                (d) => d.dayNumber === missed.dayNumber
            );
            if (daily) {
                daily.status = 'skipped';
            }
        }

        // Find and update in database
        await Roadmap.findOneAndUpdate(
            { _id: roadmap._id },
            { weeklyFocuses: roadmap.weeklyFocuses }
        );
    }

    async getSkippedSessionsContent(
        userId: Schema.Types.ObjectId | string
    ): Promise<{
        hasSkippedSessions: boolean;
        skippedContent: Array<{
            focus: string;
            targetSkills: string[];
            suggestedDomains: string[];
        }>;
    }> {
        const roadmap = await Roadmap.findOne({
            userId,
            status: 'active',
        });

        if (!roadmap) {
            return {
                hasSkippedSessions: false,
                skippedContent: [],
            };
        }

        const activeWeek = roadmap.weeklyFocuses.find(
            (w) => w.weekNumber === roadmap.activeWeekNumber
        );

        if (!activeWeek || !activeWeek.dailyFocuses) {
            return {
                hasSkippedSessions: false,
                skippedContent: [],
            };
        }

        // Find all dailyFocuses with status = 'skipped'
        const skippedSessions = activeWeek.dailyFocuses.filter(
            (daily) => daily.status === 'skipped'
        );

        if (skippedSessions.length === 0) {
            return {
                hasSkippedSessions: false,
                skippedContent: [],
            };
        }

        return {
            hasSkippedSessions: true,
            skippedContent: skippedSessions.map((session) => ({
                focus: session.focus,
                targetSkills: session.targetSkills || [],
                suggestedDomains: session.suggestedDomains || [],
            })),
        };
    }

    async checkAndProgressWeek(roadmapId: string): Promise<{
        progressed: boolean;
        newWeekNumber?: number;
        message: string;
    }> {
        const roadmap = await Roadmap.findOne({ roadmapId });

        if (!roadmap) {
            throw new ApiError(ErrorMessage.ROADMAP_NOT_FOUND);
        }

        const activeWeek = roadmap.weeklyFocuses.find(
            (w) => w.weekNumber === roadmap.activeWeekNumber
        );

        if (!activeWeek || !activeWeek.dailyFocuses) {
            return {
                progressed: false,
                message: 'No active week found',
            };
        }

        // Kiểm tra xem tất cả dailyFocus đã hoàn thành chưa
        const allCompleted = activeWeek.dailyFocuses.every(
            (daily) =>
                daily.status === 'completed' || daily.status === 'skipped'
        );

        if (!allCompleted) {
            const remaining = activeWeek.dailyFocuses.filter(
                (d) => d.status !== 'completed' && d.status !== 'skipped'
            ).length;

            return {
                progressed: false,
                message: `You still have ${remaining} session(s) to complete this week`,
            };
        }

        // Update activeWeekNumber
        const progressed = roadmap.checkAndUpdateActiveWeek();

        if (progressed) {
            // Check if the next week has dailyFocuses
            const nextWeek = roadmap.weeklyFocuses.find(
                (w) => w.weekNumber === roadmap.activeWeekNumber
            );

            if (
                nextWeek &&
                (!nextWeek.dailyFocuses || nextWeek.dailyFocuses.length === 0)
            ) {
                await this.generateDailyFocusesForWeek(
                    roadmap,
                    roadmap.activeWeekNumber
                );
            }

            await roadmap.save();

            return {
                progressed: true,
                newWeekNumber: roadmap.activeWeekNumber,
                message: `Congratulations! Moving to week ${roadmap.activeWeekNumber}`,
            };
        }

        return {
            progressed: false,
            message: 'Cannot progress to next week',
        };
    }

    async generateDailyFocusesForWeek(
        roadmap: RoadmapType & { save: () => Promise<unknown> },
        weekNumber: number
    ): Promise<void> {
        const week = roadmap.weeklyFocuses.find(
            (w) => w.weekNumber === weekNumber
        );

        if (!week) {
            throw new ApiError(ErrorMessage.ROADMAP_NOT_FOUND);
        }

        const user = await User.findById(roadmap.userId)
            .select('preferences competencyProfile')
            .lean();

        if (!user || Array.isArray(user)) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }

        const userPreferences = user.preferences
            ? {
                  primaryGoal: user.preferences.primaryGoal,
                  currentLevel: user.preferences.currentLevel,
                  preferredStudyTime: user.preferences.preferredStudyTime,
                  contentInterests: user.preferences.contentInterests,
                  studyDaysOfWeek: user.preferences.studyDaysOfWeek || [],
              }
            : {
                  studyDaysOfWeek: [1, 2, 3, 4, 5], // Default Mon-Fri
              };

        // Temporarily create dailyFocuses manually, will call LLM later
        const studyDaysCount = roadmap.studyDaysPerWeek || 5;
        const dailyFocuses = [];

        for (let i = 0; i < studyDaysCount; i++) {
            dailyFocuses.push({
                dayNumber: (weekNumber - 1) * studyDaysCount + i + 1,
                dayOfWeek:
                    (userPreferences.studyDaysOfWeek as number[])[i] || 0,
                focus: `${week.title} - Day ${i + 1}`,
                targetSkills: week.focusSkills || [],
                suggestedDomains: week.recommendedDomains || [],
                foundationWeight: 50,
                estimatedMinutes: roadmap.studyTimePerDay || 60,
                status: 'pending' as const,
                isCritical: false,
                dailySessionCompleted: false,
            });
        }

        week.dailyFocuses = dailyFocuses;
        week.totalSessions = dailyFocuses.length;
        week.status = 'in-progress';

        await roadmap.save();
    }

    async updateLastActiveDate(roadmapId: string): Promise<void> {
        await Roadmap.findOneAndUpdate(
            { roadmapId },
            { lastActiveDate: new Date() }
        );
    }

    private async regenerateWeekContent(
        roadmap: RoadmapType & { save: () => Promise<unknown> },
        weekNumber: number
    ): Promise<void> {
        // TODO: Implement this method
        console.log(
            `TODO: Regenerate week ${weekNumber} content for roadmap ${roadmap.roadmapId}`
        );

        // Placeholder: Đánh dấu các session chưa complete thành skipped
        const activeWeek = roadmap.weeklyFocuses.find(
            (w) => w.weekNumber === weekNumber
        );

        if (activeWeek && activeWeek.dailyFocuses) {
            for (const daily of activeWeek.dailyFocuses) {
                if (daily.status !== 'completed') {
                    daily.status = 'skipped';
                }
            }
            await roadmap.save();
        }
    }
}

export const roadmapCalibrationService = new RoadmapCalibrationService();
