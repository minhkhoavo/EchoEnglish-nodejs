import { Schema } from 'mongoose';
import { User } from '../../models/userModel.js';
import { StudyPlan, StudyPlanType } from '../../models/studyPlanModel.js';
import { roadmapService } from './RoadmapService.js';
import { dailyPlanAIService } from '../../ai/service/dailyPlanAIService.js';
import { studyPlanGeneratorService } from './StudyPlanGeneratorService.js';
import { Resource } from '../../models/resource.js';

interface WeeklyFocus {
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
    mistakes?: Array<{
        questionId: Schema.Types.ObjectId;
        questionText: string;
        contentTags?: string[];
        skillTag?: string;
        partNumber?: number;
        difficulty?: string;
        mistakeCount: number;
        addedDate: Date;
    }>;
    sessionsCompleted: number;
    totalSessions: number;
    dailyFocuses?: Array<{ dayOfWeek: number }>;
}
interface Roadmap {
    _id: unknown;
    __v: number;
    roadmapId?: string;
    startDate?: string;
    totalWeeks?: number;
    weeklyFocuses?: WeeklyFocus[];
    currentLevel?: string;
    userId?: string;
    testResultId?: string;
}
interface DailyFocus {
    dayOfWeek: number;
    focus: string;
    targetSkills: string[];
    suggestedDomains: string[];
    estimatedMinutes: number;
}

export class DailySessionService {
    async getTodaySession(userId: Schema.Types.ObjectId | string) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        today.setDate(today.getDate());
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Check if session already exists for today
        let session = (await StudyPlan.findOne({
            userId,
            scheduledDate: { $gte: today, $lt: tomorrow },
        }).lean()) as Partial<StudyPlanType> | null;

        if (session) {
            console.log('Found existing session for today');
            return session;
        }

        // Get active roadmap
        let roadmap = await roadmapService.getActiveRoadmap(userId);

        // Ensure singleRoadmap is initialized and accessible
        let singleRoadmap: Roadmap | undefined;
        if (Array.isArray(roadmap)) {
            singleRoadmap = roadmap[0] as Roadmap;
        } else {
            singleRoadmap = roadmap as Roadmap;
        }

        if (!roadmap || !singleRoadmap?.roadmapId) {
            console.log('No active roadmap found');
            return null;
        }

        // Check if roadmap is blocked by critical daily focus
        const roadmapStatus = await roadmapService.checkRoadmapBlocked(
            singleRoadmap.roadmapId
        );

        let targetDayNumber: number;
        let targetWeekNumber: number;
        let targetDailyFocus: DailyFocus | undefined;

        if (roadmapStatus.isBlocked && roadmapStatus.blockedDailyFocus) {
            // If blocked, generate session for the blocked daily focus
            console.log(
                'Roadmap is blocked, generating session for blocked daily focus'
            );

            // Find the week containing the blocked daily focus
            const blockedWeek = singleRoadmap.weeklyFocuses?.find((w) =>
                w.dailyFocuses?.some(
                    (d) =>
                        (d as DailyFocus).dayOfWeek ===
                            roadmapStatus.blockedDailyFocus?.dayOfWeek &&
                        w.weekNumber === roadmapStatus.currentWeek
                )
            );

            if (!blockedWeek) {
                console.log('Could not find blocked week');
                return null;
            }

            targetWeekNumber = blockedWeek.weekNumber;
            targetDailyFocus = blockedWeek.dailyFocuses?.find(
                (d) =>
                    (d as DailyFocus).dayOfWeek ===
                    roadmapStatus.blockedDailyFocus?.dayOfWeek
            ) as DailyFocus | undefined;

            if (!targetDailyFocus) {
                console.log('Could not find blocked daily focus');
                return null;
            }

            // find the day number within the roadmap
            targetDayNumber =
                (targetWeekNumber - 1) * 7 + targetDailyFocus.dayOfWeek;
        } else {
            console.log('Roadmap is not blocked, generating session for today');
            const startDate =
                singleRoadmap.startDate &&
                typeof singleRoadmap.startDate === 'string'
                    ? new Date(singleRoadmap.startDate)
                    : new Date();

            const daysSinceStart = Math.floor(
                (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
            );

            targetDayNumber =
                daysSinceStart >= 0 &&
                daysSinceStart < (singleRoadmap.totalWeeks || 0) * 7
                    ? daysSinceStart + 1
                    : 1;
            targetWeekNumber = Math.ceil(targetDayNumber / 7);

            // Get week and day focus
            const weekFocus = singleRoadmap.weeklyFocuses?.find(
                (w) => w.weekNumber === targetWeekNumber
            );

            if (!weekFocus) {
                console.log('No weekly focus found for week', targetWeekNumber);
                return null;
            }

            const dayInWeek = ((targetDayNumber - 1) % 7) + 1;
            targetDailyFocus = weekFocus?.dailyFocuses?.find((d) => {
                return (d as DailyFocus).dayOfWeek === dayInWeek;
            }) as DailyFocus | undefined;

            if (!targetDailyFocus) {
                console.log('No daily focus found for day', dayInWeek);
                return null;
            }
        }

        // Get weekly focus for context
        const weekFocus = singleRoadmap.weeklyFocuses?.find(
            (w) => w.weekNumber === targetWeekNumber
        );

        if (!weekFocus) {
            console.log(
                'No weekly focus found for target week',
                targetWeekNumber
            );
            return null;
        }
        console.log(
            `Generating session for day ${targetDayNumber}, week ${targetWeekNumber}${roadmapStatus.isBlocked ? ' (BLOCKED)' : ''}`
        );

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
            targetDailyFocus.suggestedDomains || [],
            targetDailyFocus.targetSkills || []
        );

        // Get mistakes that need practice from current week (top N from stack)
        const mistakesToPractice = weekFocus.mistakes?.slice(0, 40) || [];

        // Generate activities using AI with smart resource allocation
        console.log('Generating daily plan with AI decision-making...');
        const aiPlan = await dailyPlanAIService.generateDailyPlan({
            dailyFocus: {
                focus: targetDailyFocus.focus,
                targetSkills: targetDailyFocus.targetSkills || [],
                suggestedDomains: targetDailyFocus.suggestedDomains || [],
                estimatedMinutes: targetDailyFocus.estimatedMinutes,
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
                    singleRoadmap.currentLevel ||
                    'B1',
                lowestSkills: lowestSkills?.map((s) => ({
                    skill: s.skill,
                    currentAccuracy: s.currentAccuracy,
                    proficiency: s.proficiency,
                })),
            },
            mistakesToReview: mistakesToPractice.map((mistake) => ({
                questionId: mistake.questionId.toString(),
                questionText: mistake.questionText,
                contentTags: mistake.contentTags || [],
                skillTag: mistake.skillTag,
                partNumber: mistake.partNumber,
                difficulty: mistake.difficulty,
                mistakeCount: mistake.mistakeCount,
            })),
            availableResources: availableResources.map((r) => ({
                type: r.type,
                title: r.title,
                description: r.description || '',
                url: r.url,
                domain: r.labels?.domain,
                topics: r.labels?.topic,
            })),
        });

        // console.log('AI Plan reasoning:', aiPlan.reasoning);

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
                const weakness = {
                    category: '',
                    skillKey: '',
                    skillName: '',
                    affectedParts: [] as string[],
                };

                const weakDomains = targetDailyFocus?.suggestedDomains ?? [];

                const vocabSet =
                    await studyPlanGeneratorService.generateVocabularySet(
                        weakness,
                        weakDomains
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

            // Generate practice drill if AI decided
            let aiPracticeDrill = [];
            if (
                activity.generatePracticeDrill &&
                activity.practiceQuestionIds
            ) {
                aiPracticeDrill.push({
                    title: activity.title || 'Mistake Review Drill',
                    practiceQuestionIds: activity.practiceQuestionIds,
                    minCorrectAnswers:
                        activity.minCorrectAnswers ||
                        Math.floor(activity.practiceQuestionIds.length / 2),
                    description:
                        activity.drillInstructions ||
                        `Practice drill focusing on ${activity.skillsToImprove?.[0] || 'general skills'}`,
                    totalQuestions: activity.practiceQuestionIds?.length || 5,
                    estimatedTime: Math.min(activity.estimatedTime || 15, 20),
                    skillTags: {
                        skillCategory:
                            activity.skillsToImprove?.[0] || 'OTHERS',
                        specificSkills: activity.skillsToImprove || [],
                    },
                    partNumbers: [],
                    difficulty: 'intermediate',
                    completed: false,
                    score: 0,
                    attempts: 0,
                });
            }

            planItems.push({
                priority: activity.priority,
                title: activity.title,
                description: activity.description,
                targetWeakness: activity.targetWeakness,
                skillsToImprove: activity.skillsToImprove,
                resources,
                practiceDrills: activity.generatePracticeDrill
                    ? aiPracticeDrill
                    : [],
                progress: 0,
                estimatedWeeks: 0,
                activityType: activityType,
                resourceType: activity.useDBResource
                    ? 'db_resource'
                    : activity.generatePracticeDrill
                      ? 'practice_drill'
                      : 'generated',
                order: activity.priority,
                status: 'pending' as const,
            });
        }

        // Create new study plan
        const sessionTitle = roadmapStatus.isBlocked
            ? `CRITICAL: ${targetDailyFocus.focus}`
            : `Day ${targetDayNumber}: ${targetDailyFocus.focus}`;

        const newSession = await StudyPlan.create({
            userId: singleRoadmap.userId,
            roadmapRef: singleRoadmap._id,
            testResultId: singleRoadmap.testResultId,
            dayNumber: targetDayNumber,
            weekNumber: targetWeekNumber,
            scheduledDate: today,
            title: sessionTitle,
            description: roadmapStatus.isBlocked
                ? `You need to complete this critical learning day before continuing the roadmap. ${weekFocus.summary}`
                : weekFocus.summary,
            targetSkills: targetDailyFocus.targetSkills,
            targetDomains: targetDailyFocus.suggestedDomains,
            targetWeaknesses: weekFocus.targetWeaknesses,
            planItems,
            totalEstimatedTime: targetDailyFocus.estimatedMinutes,
            status: 'upcoming',
        });

        console.log(
            `Created new session for day ${targetDayNumber}${roadmapStatus.isBlocked ? ' (CRITICAL BLOCKED)' : ''}`
        );
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

    async completeDailySession(
        userId: Schema.Types.ObjectId | string,
        sessionId: string
    ): Promise<{
        success: boolean;
        unblocked: boolean;
        message: string;
        canProceed: boolean;
    }> {
        const session = await StudyPlan.findById(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        session.status = 'completed';
        session.progress = 100;
        await session.save();

        const roadmap = await roadmapService.getActiveRoadmap(userId);

        let singleRoadmap: Roadmap | undefined;
        if (Array.isArray(roadmap)) {
            singleRoadmap = roadmap[0] as Roadmap;
        } else {
            singleRoadmap = roadmap as Roadmap;
        }

        if (!singleRoadmap?.roadmapId) {
            return {
                success: true,
                unblocked: false,
                message: 'Session completed but no active roadmap found',
                canProceed: true,
            };
        }

        const result = await roadmapService.completeDailySession(
            singleRoadmap.roadmapId,
            session.weekNumber || 1,
            session.dayNumber || 1
        );

        return {
            success: true,
            unblocked: result.canProceed,
            message: result.canProceed
                ? 'Session completed and roadmap unblocked, you can proceed.'
                : 'Session completed but there are still critical days that need to be completed.',
            canProceed: result.canProceed,
        };
    }

    /**
     * Complete practice drill - remove correct answers from stack
     */
    async completePracticeDrill(
        userId: Schema.Types.ObjectId | string,
        sessionId: string,
        drillResults: Array<{
            questionId: string;
            isCorrect: boolean;
            timeSpent?: number;
        }>
    ): Promise<{
        success: boolean;
        message: string;
        mistakesRemoved: number;
    }> {
        try {
            const session = await StudyPlan.findById(sessionId);
            if (!session) {
                throw new Error('Session not found');
            }

            // Update practice drill progress
            for (const planItem of session.planItems) {
                if (
                    planItem.resourceType === 'practice_drill' &&
                    planItem.practiceDrills?.length > 0
                ) {
                    const drill = planItem.practiceDrills[0];
                    const correctAnswers = drillResults.filter(
                        (r) => r.isCorrect
                    ).length;

                    drill.correctAnswers = correctAnswers;
                    drill.completed =
                        correctAnswers >= (drill.minCorrectAnswers || 2);

                    if (drill.completed) {
                        planItem.progress = 100;
                        planItem.status = 'completed';
                    }
                }
            }

            await session.save();

            // Remove correct answers from mistake stack
            const { roadmapMistakeService } = await import(
                './RoadmapMistakeService.js'
            );

            let mistakesRemoved = 0;
            for (const result of drillResults) {
                if (result.isCorrect) {
                    const removeResult =
                        await roadmapMistakeService.removeMistake(
                            userId,
                            result.questionId,
                            session.weekNumber
                        );

                    if (removeResult.success) {
                        mistakesRemoved++;
                    }
                }
            }

            return {
                success: true,
                message: `Practice drill completed: ${drillResults.filter((r) => r.isCorrect).length}/${drillResults.length} correct, ${mistakesRemoved} mistakes removed from stack`,
                mistakesRemoved,
            };
        } catch (error) {
            console.error('Error completing practice drill:', error);
            return {
                success: false,
                message: 'Failed to complete practice drill',
                mistakesRemoved: 0,
            };
        }
    }
}

export const dailySessionService = new DailySessionService();
