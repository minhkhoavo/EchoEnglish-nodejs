import { Schema } from 'mongoose';
import { User } from '../../models/userModel.js';
import { StudyPlan, StudyPlanType } from '../../models/studyPlanModel.js';
import { roadmapService } from './RoadmapService.js';
import { dailyPlanAIService } from '../../ai/service/dailyPlanAIService.js';
import { studyPlanGeneratorService } from './StudyPlanGeneratorService.js';
import { Resource } from '../../models/resource.js';

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
            return session;
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

        // Get user competency profile for context
        const user = (await User.findById(userId)
            .select('competencyProfile')
            .lean()) as {
            competencyProfile?: {
                currentCEFRLevel?: string;
                skillMatrix?: Array<{
                    skill: string;
                    currentAccuracy: number;
                    proficiency: string;
                }>;
            };
        } | null;

        // Prepare context for LLM
        const lowestSkills = user?.competencyProfile?.skillMatrix
            ?.filter((s) => s.currentAccuracy < 60)
            .sort((a, b) => a.currentAccuracy - b.currentAccuracy)
            .slice(0, 3);

        // Find available DB resources matching domains and skills
        const availableResources = await this.findAvailableResources(
            dailyFocus.suggestedDomains || [],
            dailyFocus.targetSkills || []
        );

        // Generate activities using AI with smart resource allocation
        console.log('Generating daily plan with AI decision-making...');
        const aiPlan = await dailyPlanAIService.generateDailyPlan({
            dailyFocus: {
                focus: dailyFocus.focus,
                targetSkills: dailyFocus.targetSkills || [],
                suggestedDomains: dailyFocus.suggestedDomains || [],
                estimatedMinutes: dailyFocus.estimatedMinutes,
            },
            weekFocus: {
                weekNumber: weekFocus.weekNumber,
                title: weekFocus.title,
                summary: weekFocus.summary,
                focusSkills: weekFocus.focusSkills,
                targetWeaknesses: weekFocus.targetWeaknesses,
                recommendedDomains: weekFocus.recommendedDomains,
            },
            competencyProfile: {
                currentLevel:
                    user?.competencyProfile?.currentCEFRLevel ||
                    roadmap.currentLevel ||
                    'B1',
                lowestSkills: lowestSkills?.map((s) => ({
                    skill: s.skill,
                    currentAccuracy: s.currentAccuracy,
                    proficiency: s.proficiency,
                })),
            },
            availableResources: availableResources.map((r) => ({
                type: r.type,
                title: r.title,
                description: r.description || '',
                url: r.url,
                domain: r.labels?.domain,
                topics: r.labels?.topic,
            })),
        });

        console.log('AI Plan reasoning:', aiPlan.reasoning);

        // Build plan items from AI decisions
        const planItems = [];
        for (const activity of aiPlan.activities) {
            const resources = [];

            // Validate activityType
            const validActivityTypes = ['learn', 'practice', 'review', 'drill'];
            const activityType = validActivityTypes.includes(
                activity.activityType
            )
                ? activity.activityType
                : 'learn'; // Default fallback

            if (activity.activityType !== activityType) {
                console.warn(
                    `Invalid activityType "${activity.activityType}" changed to "${activityType}"`
                );
            }

            // Process AI resource decisions
            if (
                activity.useDBResource &&
                activity.dbResourceIndex !== undefined
            ) {
                const dbResource = availableResources[activity.dbResourceIndex];
                if (dbResource) {
                    console.log(`Using DB resource: ${dbResource.title}`);
                    resources.push({
                        type: dbResource.type === 'video' ? 'video' : 'article',
                        title: dbResource.title,
                        description:
                            dbResource.description || activity.description,
                        estimatedTime: activity.estimatedTime,
                        resourceId: dbResource._id,
                        url: dbResource.url,
                        completed: false,
                    });
                }
            }

            // Generate vocabulary set if AI decided
            if (activity.generateVocabularySet) {
                console.log('Generating vocabulary set as per AI decision...');
                const vocabSet =
                    await studyPlanGeneratorService.generateVocabularySet(
                        {
                            category: activity.targetWeakness.skillName,
                            skillKey: activity.targetWeakness.skillKey,
                            skillName: activity.targetWeakness.skillName,
                            affectedParts: [],
                        },
                        dailyFocus.suggestedDomains || []
                    );
                if (vocabSet) {
                    resources.push(vocabSet);
                }
            }

            // Generate personalized guide if AI decided
            if (activity.generatePersonalizedGuide) {
                console.log(
                    'Generating personalized guide as per AI decision...'
                );
                const guide =
                    await studyPlanGeneratorService.generatePersonalizedGuide(
                        {
                            category: activity.targetWeakness.skillName,
                            skillKey: activity.targetWeakness.skillKey,
                            skillName: activity.targetWeakness.skillName,
                            affectedParts: [],
                            severity: activity.targetWeakness.severity,
                        },
                        100 // Default accuracy for daily learning
                    );
                if (guide) {
                    resources.push(guide);
                }
            }

            planItems.push({
                priority: activity.priority,
                title: activity.title,
                description: activity.description,
                targetWeakness: activity.targetWeakness,
                skillsToImprove: activity.skillsToImprove,
                resources,
                practiceDrills: [],
                progress: 0,
                estimatedWeeks: 0,
                activityType: activityType, // Use validated activityType
                resourceType: activity.useDBResource
                    ? 'db_resource'
                    : 'generated',
                order: activity.priority,
                status: 'pending' as const,
            });
        }

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
        return newSession;
    }

    /**
     * Find available DB resources matching domains and skills
     */
    private async findAvailableResources(
        domains: string[],
        skills: string[]
    ): Promise<
        Array<{
            _id: Schema.Types.ObjectId;
            type: string;
            title: string;
            description?: string;
            url?: string;
            labels?: { domain?: string; topic?: string[] };
        }>
    > {
        const searchCriteria: Record<string, unknown> = {
            suitableForLearners: true,
        };

        // Add domain filter if provided
        if (domains.length > 0) {
            searchCriteria['labels.domain'] = {
                $in: domains.map((d) => d.toUpperCase()),
            };
        }

        // Try to match skills to topics using the StudyPlanGenerator's logic
        const topicKeywords: string[] = [];
        for (const skill of skills) {
            const keywords = studyPlanGeneratorService.getTopicKeywords(
                skill,
                skill
            );
            topicKeywords.push(...keywords);
        }

        if (topicKeywords.length > 0) {
            searchCriteria['labels.topic'] = { $in: topicKeywords };
        }

        // Find up to 5 matching resources for LLM to choose from
        const resources = await Resource.find(searchCriteria).limit(5).lean();

        console.log(
            `Found ${resources.length} available resources for LLM to choose from`
        );

        return resources.map((r) => ({
            _id: r._id as Schema.Types.ObjectId,
            type: r.type as string,
            title: r.title as string,
            description: r.description as string | undefined,
            url: r.url as string | undefined,
            labels: r.labels as
                | { domain?: string; topic?: string[] }
                | undefined,
        }));
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
        return session;
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
