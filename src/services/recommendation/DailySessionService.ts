import { Schema } from 'mongoose';
import { User } from '../../models/userModel.js';
import { StudyPlan, StudyPlanType } from '../../models/studyPlanModel.js';
import { roadmapService } from './RoadmapService.js';
import { learningPlanAIService } from '../../ai/service/learningPlanAIService.js';

export class DailySessionService {
    async getTodaySession(userId: Schema.Types.ObjectId | string) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Check if session already exists
        let session = (await StudyPlan.findOne({
            userId,
            scheduledDate: { $gte: today, $lt: tomorrow },
        }).lean()) as Partial<StudyPlanType> | null;

        if (session) {
            console.log('Found existing session for today');
            return this.enrichSessionWithMetrics(session, userId);
        }

        // Get active roadmap
        const roadmap = await roadmapService.getActiveRoadmap(userId);
        if (!roadmap) {
            console.log('No active roadmap found');
            return null;
        }

        // Calculate current day
        const daysSinceStart = Math.floor(
            (today.getTime() - new Date(roadmap.startDate).getTime()) /
                (1000 * 60 * 60 * 24)
        );

        // For demo: use day 1 if outside range
        const dayNumber =
            daysSinceStart >= 0 &&
            daysSinceStart < (roadmap.totalWeeks || 0) * 7
                ? daysSinceStart + 1
                : 1;
        const weekNumber = Math.ceil(dayNumber / 7);

        // Get week and day focus
        type WeeklyFocus = {
            weekNumber: number;
            title: string;
            summary: string;
            focusSkills: string[];
            targetWeaknesses: Array<{
                skillKey: string;
                skillName: string;
                severity: string;
                category: string;
                userAccuracy?: number;
            }>;
            recommendedDomains: string[];
            sessionsCompleted: number;
            totalSessions: number;
            dailyFocuses?: Array<{ dayOfWeek: number }>;
        };
        const weekFocus = roadmap.weeklyFocuses?.find(
            (w: WeeklyFocus) => w.weekNumber === weekNumber
        );
        if (!weekFocus) {
            console.log('No weekly focus found for week', weekNumber);
            return null;
        }

        const dayInWeek = ((dayNumber - 1) % 7) + 1;
        type DailyFocus = {
            dayOfWeek: number;
            focus: string;
            targetSkills: string[];
            suggestedDomains: string[];
            estimatedMinutes: number;
        };
        const dailyFocus = weekFocus.dailyFocuses?.find(
            (d: DailyFocus) => d.dayOfWeek === dayInWeek
        );
        if (!dailyFocus) {
            console.log('No daily focus found for day', dayInWeek);
            return null;
        }

        // Generate activities using AI
        console.log('Generating activities using LLM...');
        const llmResponse = await learningPlanAIService.generateDailyActivities(
            {
                userId: 'temp',
                currentLevel: roadmap.currentLevel || 'intermediate',
                dailyFocusTitle: dailyFocus.focus,
                skillsToImprove: dailyFocus.targetSkills || [],
                studyTimeAvailable: dailyFocus.estimatedMinutes,
                weekContext: {
                    weekNumber: weekFocus.weekNumber,
                    weeklyFocus: weekFocus.title,
                },
            }
        );

        const planItems = llmResponse.activities.map((activity, index) => {
            // Determine resource type and content
            const resourceType =
                activity.resourceType === 'video'
                    ? 'video'
                    : activity.resourceType === 'reading'
                      ? 'article'
                      : 'personalized_guide';

            return {
                priority: index + 1,
                title: activity.title,
                description: activity.description || '',

                // Required weakness info
                targetWeakness: {
                    skillKey: dailyFocus.targetSkills?.[0] || 'general',
                    skillName: dailyFocus.targetSkills?.[0] || 'General Skills',
                    severity: 'medium',
                },

                skillsToImprove: dailyFocus.targetSkills || ['general'],

                // Learning resources (AI-generated content)
                resources: [
                    {
                        type: resourceType,
                        title: activity.title,
                        description: activity.description || '',
                        estimatedTime: activity.estimatedTime,
                        completed: false,
                        // AI will generate content based on the description
                        generatedContent: {
                            activityType: activity.type,
                            difficulty: activity.difficulty,
                            targetSkills: dailyFocus.targetSkills,
                        },
                    },
                ],

                // No drills for now - keep it simple
                practiceDrills: [],

                progress: 0,
                estimatedWeeks: 0, // Daily activity

                // Activity tracking
                activityType: activity.type as
                    | 'learn'
                    | 'practice'
                    | 'review'
                    | 'drill',
                resourceType: activity.resourceType,
                order: index + 1,
                status: 'pending' as const,
            };
        });

        // Create new study plan
        const newSession = await StudyPlan.create({
            userId: roadmap.userId,
            roadmapRef: roadmap._id,
            testResultId: roadmap.testResultId,
            dayNumber,
            weekNumber,
            scheduledDate: today,
            title: `Ngày ${dayNumber}: ${dailyFocus.focus}`,
            description: weekFocus.summary,
            targetSkills: dailyFocus.targetSkills,
            targetDomains: dailyFocus.suggestedDomains,
            targetWeaknesses: weekFocus.targetWeaknesses,
            planItems,
            totalEstimatedTime: dailyFocus.estimatedMinutes,
            status: 'upcoming',
        });

        console.log('Created new session for day', dayNumber);
        return this.enrichSessionWithMetrics(newSession.toObject(), userId);
    }

    private async enrichSessionWithMetrics(
        session: Partial<StudyPlanType>,
        userId: Schema.Types.ObjectId | string
    ) {
        // Get roadmap for week/day context
        const roadmap = await roadmapService.getActiveRoadmap(userId);

        // Get user for competency profile
        const user = (await User.findById(userId)
            .select('competencyProfile')
            .lean()) as {
            competencyProfile?: {
                currentCEFRLevel?: string;
                skillMatrix?: Array<{
                    skill: string;
                    currentAccuracy: number;
                    proficiency: string;
                    totalQuestions: number;
                }>;
                scoreHistory?: Array<{
                    totalScore: number;
                }>;
            };
        } | null;

        // Build week focus metrics
        const weekFocus = roadmap?.weeklyFocuses?.find(
            (w: { weekNumber: number }) => w.weekNumber === session.weekNumber
        );
        const dayFocus = weekFocus?.dailyFocuses?.find(
            (d: { dayOfWeek: number }) => {
                const dayInWeek = session.dayNumber
                    ? ((session.dayNumber - 1) % 7) + 1
                    : 1;
                return d.dayOfWeek === dayInWeek;
            }
        );

        // Build competency metrics
        const profile = user?.competencyProfile || {};
        const skillMatrix = profile.skillMatrix || [];
        const scoreHistory = profile.scoreHistory || [];

        const topWeaknesses = [...skillMatrix]
            .filter((s: { currentAccuracy: number }) => s.currentAccuracy < 70)
            .sort(
                (
                    a: { currentAccuracy: number },
                    b: { currentAccuracy: number }
                ) => a.currentAccuracy - b.currentAccuracy
            )
            .slice(0, 5)
            .map(
                (s: {
                    skill: string;
                    currentAccuracy: number;
                    proficiency: string;
                    totalQuestions: number;
                }) => ({
                    skill: s.skill,
                    currentAccuracy: s.currentAccuracy,
                    proficiency: s.proficiency,
                    totalQuestions: s.totalQuestions,
                })
            );

        const recentScores = scoreHistory.slice(-2);
        const scoreImprovement =
            recentScores.length === 2
                ? recentScores[1].totalScore - recentScores[0].totalScore
                : 0;
        const skillsImproved = skillMatrix.filter(
            (s: { currentAccuracy: number }) => s.currentAccuracy > 60
        ).length;

        return {
            ...session,
            _metrics: {
                weekFocus: weekFocus
                    ? {
                          weekNumber: weekFocus.weekNumber,
                          title: weekFocus.title,
                          summary: weekFocus.summary,
                          focusSkills: weekFocus.focusSkills,
                          targetWeaknesses: weekFocus.targetWeaknesses,
                          recommendedDomains: weekFocus.recommendedDomains,
                          progress: {
                              sessionsCompleted:
                                  weekFocus.sessionsCompleted || 0,
                              totalSessions: weekFocus.totalSessions || 7,
                              percentage: Math.round(
                                  ((weekFocus.sessionsCompleted || 0) /
                                      (weekFocus.totalSessions || 7)) *
                                      100
                              ),
                          },
                      }
                    : null,
                dayFocus: dayFocus
                    ? {
                          dayOfWeek: dayFocus.dayOfWeek,
                          focus: dayFocus.focus,
                          targetSkills: dayFocus.targetSkills,
                          suggestedDomains: dayFocus.suggestedDomains,
                          estimatedMinutes: dayFocus.estimatedMinutes,
                      }
                    : null,
                competencyProfile: {
                    currentLevel: profile.currentCEFRLevel || 'B1',
                    currentScore: roadmap?.currentScore,
                    targetScore: roadmap?.targetScore,
                    overallProgress: roadmap?.overallProgress || 0,
                    topWeaknesses,
                    recentProgress: {
                        scoreImprovement,
                        skillsImproved,
                    },
                },
            },
        };
    }

    async completeActivity(
        sessionId: Schema.Types.ObjectId,
        activityId: string,
        result?: unknown
    ) {
        const session = await StudyPlan.findById(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        // Find by _id (activityId is the planItem _id)
        const planItem = session.planItems?.find(
            (item: { _id: { toString: () => string } }) =>
                item._id.toString() === activityId
        );
        if (!planItem) {
            throw new Error('Activity not found');
        }

        planItem.status = 'completed';
        planItem.completedAt = new Date();
        if (result) {
            planItem.result = result;
        }
        planItem.progress = 100;

        // Update session progress
        const completedCount =
            session.planItems?.filter(
                (item: { status: string }) => item.status === 'completed'
            ).length || 0;
        const totalCount = session.planItems?.length || 1;
        session.progress = Math.round((completedCount / totalCount) * 100);

        if (completedCount >= totalCount) {
            session.status = 'completed';
            session.completedAt = new Date();

            // Update roadmap progress
            if (session.roadmapRef) {
                const roadmap = await roadmapService.getActiveRoadmap(
                    session.userId
                );
                if (roadmap) {
                    await roadmapService.updateProgress(
                        roadmap.roadmapId,
                        true
                    );
                }
            }
        }

        await session.save();
        return this.enrichSessionWithMetrics(
            session.toObject(),
            session.userId
        );
    }

    /**
     * Regenerate today's session
     */
    async regenerateTodaySession(userId: Schema.Types.ObjectId | string) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        await StudyPlan.deleteOne({
            userId,
            scheduledDate: { $gte: today, $lt: tomorrow },
        });

        return await this.getTodaySession(userId);
    }
}

export const dailySessionService = new DailySessionService();
