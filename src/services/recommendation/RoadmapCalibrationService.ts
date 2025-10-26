import { Schema } from 'mongoose';
import { Roadmap, RoadmapType } from '~/models/roadmapModel.js';
import { User } from '~/models/userModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';

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
                message: `You missed ${missedSessions.length} session(s) as skipped. They will be included in your next study session.`,
                action: 'mark_skipped',
                missedSessions: missedSessions.map((s) => ({
                    weekNumber: s.weekNumber,
                    dayNumber: s.dayNumber,
                    focus: s.focus,
                })),
            };
        } else {
            // If missed sessions > 2: regenerate content for the entire week
            await this.regenerateWeekContent(
                roadmap,
                roadmap.activeWeekNumber,
                userId
            );

            return {
                hasMissedSessions: true,
                missedCount: missedSessions.length,
                message: `Successfully regenerated your week plan with ${missedSessions.length} missed sessions.`,
                action: 'regenerate_week',
                missedSessions: missedSessions.map((s) => ({
                    weekNumber: s.weekNumber,
                    dayNumber: s.dayNumber,
                    focus: s.focus,
                })),
            };
        }
    }

    // Identify missed study sessions based on studyDaysOfWeek
    private async identifyMissedSessions(
        roadmap: RoadmapType,
        studyDaysOfWeek: number[]
    ): Promise<MissedSession[]> {
        const missedSessions: MissedSession[] = [];
        const activeWeek = roadmap.weeklyFocuses.find(
            (w: { weekNumber: number }) =>
                w.weekNumber === roadmap.activeWeekNumber
        );

        if (!activeWeek || !activeWeek.dailyFocuses) {
            return missedSessions;
        }

        const today = new Date();
        const currentDayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ...
        // const currentDayOfWeek = 2; // 0 = Sunday, 1 = Monday, ...

        const hasCompletedSessions = activeWeek.dailyFocuses.some(
            (daily: { status: string }) => daily.status === 'completed'
        );
        const allRemainingSessionsAreAfterToday = activeWeek.dailyFocuses
            .filter(
                (d: { status: string }) =>
                    d.status !== 'completed' && d.status !== 'skipped'
            )
            .every((daily) => daily.dayOfWeek > currentDayOfWeek);

        // Mark last week complete if today.getDayOfWeek() is earlier than every remaining weekly dailyFocus
        // and at least one dailyFocus is completed
        if (hasCompletedSessions && allRemainingSessionsAreAfterToday) {
            console.log(
                'Week appears to be completed, checking if should progress to next week'
            );
            return missedSessions;
        }

        // Find dailyFocuses that have dayOfWeek in studyDaysOfWeek and are not completed
        for (const daily of activeWeek.dailyFocuses) {
            // Skip if completed
            if (daily.status === 'completed') {
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
            (w: { weekNumber: number }) =>
                w.weekNumber === roadmap.activeWeekNumber
        );

        if (!activeWeek || !activeWeek.dailyFocuses) {
            return {
                hasSkippedSessions: false,
                skippedContent: [],
            };
        }

        // Find all dailyFocuses with status = 'skipped'
        const skippedSessions = activeWeek.dailyFocuses.filter(
            (daily: { status: string }) => daily.status === 'skipped'
        );

        if (skippedSessions.length === 0) {
            return {
                hasSkippedSessions: false,
                skippedContent: [],
            };
        }

        return {
            hasSkippedSessions: true,
            skippedContent: skippedSessions.map(
                (session: {
                    focus: string;
                    targetSkills?: string[];
                    suggestedDomains?: string[];
                }) => ({
                    focus: session.focus,
                    targetSkills: session.targetSkills || [],
                    suggestedDomains: session.suggestedDomains || [],
                })
            ),
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
            (w: { weekNumber: number }) =>
                w.weekNumber === roadmap.activeWeekNumber
        );

        if (!activeWeek || !activeWeek.dailyFocuses) {
            return {
                progressed: false,
                message: 'No active week found',
            };
        }

        // Kiểm tra xem tất cả dailyFocus đã hoàn thành chưa
        const allCompleted = activeWeek.dailyFocuses.every(
            (daily: { status: string }) =>
                daily.status === 'completed' || daily.status === 'skipped'
        );

        if (!allCompleted) {
            const remaining = activeWeek.dailyFocuses.filter(
                (d: { status: string }) =>
                    d.status !== 'completed' && d.status !== 'skipped'
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
                (w: { weekNumber: number }) =>
                    w.weekNumber === roadmap.activeWeekNumber
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

        week.dailyFocuses.push(...dailyFocuses);
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
        weekNumber: number,
        userId: Schema.Types.ObjectId | string
    ): Promise<void> {
        console.log(
            `Regenerating week ${weekNumber} content for roadmap ${roadmap.roadmapId}`
        );

        const activeWeek = roadmap.weeklyFocuses.find(
            (w) => w.weekNumber === weekNumber
        );

        if (!activeWeek) {
            throw new ApiError(ErrorMessage.ROADMAP_NOT_FOUND);
        }

        const user = await User.findById(userId)
            .select('preferences competencyProfile')
            .lean();

        if (!user || Array.isArray(user)) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        const today = new Date();
        const todayDayOfWeek = today.getDay();
        // const todayDayOfWeek = 2;
        const dayNames = [
            'Sunday',
            'Monday',
            'Tuesday',
            'Wednesday',
            'Thursday',
            'Friday',
            'Saturday',
        ];

        // Calculate remaining study days (from today onwards)
        const studyDaysOfWeek = user.preferences?.studyDaysOfWeek || [
            1, 2, 3, 4, 5,
        ];
        const remainingStudyDays = studyDaysOfWeek.filter(
            (day: number) => day >= todayDayOfWeek
        );

        const completedSessions = (
            activeWeek.dailyFocuses?.filter(
                (d: { status: string }) => d.status === 'completed'
            ) || []
        ).map((session) => ({ ...session }));

        // Build competency profile block
        const competencyProfileBlock =
            user.competencyProfile?.skillMatrix
                ?.map(
                    (s: {
                        skill: string;
                        currentAccuracy: number;
                        proficiency: string;
                    }) => `${s.skill}: ${s.currentAccuracy}% (${s.proficiency})`
                )
                .join('\n') || 'No competency data available';

        // Build completed sessions block
        const completedSessionsBlock =
            completedSessions.length > 0
                ? completedSessions
                      .map(
                          (s, idx) =>
                              `[${idx + 1}] ${dayNames[s.dayOfWeek]}: "${s.focus}"\n    Skills: ${s.targetSkills?.join(', ') || 'N/A'}\n    Status: ${s.status}`
                      )
                      .join('\n')
                : 'No sessions completed yet this week';

        // Build prompt variables
        const variables = {
            weekNumber: weekNumber.toString(),
            weekTitle: activeWeek.title,
            weekSummary: activeWeek.summary,
            weekFocusSkills: activeWeek.focusSkills.join(', '),
            targetWeaknesses: activeWeek.targetWeaknesses
                .map(
                    (w) =>
                        `${w.skillName} (${w.severity}, accuracy: ${w.userAccuracy || 'N/A'}%)`
                )
                .join('; '),
            recommendedDomains: activeWeek.recommendedDomains.join(', '),
            todayDayName: dayNames[todayDayOfWeek],
            todayDayOfWeek: todayDayOfWeek.toString(),
            daysRemainingCount: remainingStudyDays.length.toString(),
            remainingStudyDays: remainingStudyDays
                .map((d: number) => dayNames[d])
                .join(', '),
            studyTimePerDay: roadmap.studyTimePerDay?.toString() || '30',
            originalSessionsCount: (
                activeWeek.dailyFocuses?.length || 0
            ).toString(),
            completedSessionsCount: completedSessions.length.toString(),
            completedSessionsBlock,
            currentLevel:
                roadmap.currentLevel || user.preferences?.currentLevel || 'B1',
            targetScore: roadmap.targetScore?.toString() || '600',
            studyDaysOfWeek: studyDaysOfWeek.join(', '),
            preferredStudyTime: user.preferences?.preferredStudyTime || 'N/A',
            contentInterests:
                user.preferences?.contentInterests?.join(', ') || 'N/A',
            competencyProfileBlock,
        };

        const prompt = await promptManagerService.loadTemplate(
            'studyplan/regenerate_week',
            variables
        );

        const llmClient = new GoogleGenAIClient({
            model: 'models/gemini-flash-lite-latest',
        });

        interface RegenerateWeekOutput {
            dailyFocuses: Array<{
                dayOfWeek: number;
                focus: string;
                targetSkills: string[];
                suggestedDomains: string[];
                estimatedMinutes: number;
                foundationWeight: number;
            }>;
            reasoning: string;
        }

        const parser = new JsonOutputParser<RegenerateWeekOutput>();
        const chain = llmClient.getModel().pipe(parser);

        try {
            const result = await chain.invoke(prompt);
            console.log('LLM Regenerate Week Reasoning:', result.reasoning);

            const newDailyFocuses = result.dailyFocuses.map((df, idx) => ({
                dayNumber: idx + 1,
                dayOfWeek: df.dayOfWeek,
                focus: df.focus,
                targetSkills: df.targetSkills,
                suggestedDomains: df.suggestedDomains,
                foundationWeight: df.foundationWeight,
                estimatedMinutes: df.estimatedMinutes,
                status: 'pending' as const,
                isCritical: false,
                dailySessionCompleted: false,
            }));
            // Overwrite old schedule
            activeWeek.dailyFocuses = newDailyFocuses;
            roadmap.markModified('weeklyFocuses');
            activeWeek.totalSessions = activeWeek.dailyFocuses.length;
            activeWeek.status = 'in-progress';

            await roadmap.save();

            console.log(
                `Successfully regenerated week ${weekNumber}: ` +
                    `${completedSessions.length} completed + ${newDailyFocuses.length} new pending days`
            );
        } catch (error) {
            console.error('Error regenerating week content:', error);
            throw new Error('Failed to regenerate week content');
        }
    }
}

export const roadmapCalibrationService = new RoadmapCalibrationService();
