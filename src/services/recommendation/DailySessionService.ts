import { Schema } from 'mongoose';
import { User } from '../../models/userModel.js';
import { StudyPlan, StudyPlanType } from '../../models/studyPlanModel.js';
import { roadmapService } from './RoadmapService.js';
import { dailyPlanAIService } from '../../ai/service/dailyPlanAIService.js';
import { studyPlanGeneratorService } from './StudyPlanGeneratorService.js';
import { Resource } from '../../models/resource.js';
import { progressTrackingService } from './ProgressTrackingService.js';
import { roadmapCalibrationService } from './RoadmapCalibrationService.js';
import testService from '../../services/testService.js';

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
    activeWeekNumber?: number;
    studyTimePerDay?: number;
}
interface DailyFocus {
    dayOfWeek: number;
    focus: string;
    targetSkills: string[];
    suggestedDomains: string[];
    estimatedMinutes: number;
    status?: string;
}

export class DailySessionService {
    async getTodaySession(userId: Schema.Types.ObjectId | string) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // today.setDate(today.getDate() + 15);
        // today.setDate(new Date("2025-11-07").getDate());
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Check if session already exists for today
        let session = (await StudyPlan.findOne({
            userId,
            scheduledDate: { $gte: today, $lt: tomorrow },
        }).lean()) as Partial<StudyPlanType> | null;

        if (session) {
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

        let targetWeekNumber: number;
        let targetDailyFocus: DailyFocus | undefined;
        let shouldUpdateStatus = false;

        if (roadmapStatus.isBlocked && roadmapStatus.blockedDailyFocus) {
            // If blocked, generate session for the blocked daily focus (isCritical mode)
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

            shouldUpdateStatus = true; // Cập nhật status cho isCritical
        } else {
            console.log('Roadmap is not blocked, generating session for today');
            const todayDayOfWeek = today.getDay();

            // Use activeWeekNumber
            targetWeekNumber = singleRoadmap.activeWeekNumber || 1;

            // Find weekFocus for the current week
            const weekFocus = singleRoadmap.weeklyFocuses?.find(
                (w) => w.weekNumber === targetWeekNumber
            );

            if (!weekFocus) {
                console.log('No weekly focus found for week', targetWeekNumber);
                return null;
            }

            // Find dailyFocus with matching dayOfWeek for today
            targetDailyFocus = weekFocus?.dailyFocuses?.find((d) => {
                const daily = d as DailyFocus;
                return daily.dayOfWeek === todayDayOfWeek;
            }) as DailyFocus | undefined;

            if (targetDailyFocus) {
                // Find dailyFocus for today → only update status if not completed/skipped
                if (
                    targetDailyFocus.status !== 'completed' &&
                    targetDailyFocus.status !== 'skipped'
                ) {
                    shouldUpdateStatus = true;
                }
                console.log(
                    `Found daily focus for dayOfWeek ${todayDayOfWeek}`
                );
            } else {
                console.log(
                    `No daily focus scheduled for dayOfWeek ${todayDayOfWeek}, will generate random session`
                );
                shouldUpdateStatus = false;
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

        // Chỉ update status nếu shouldUpdateStatus = true
        if (shouldUpdateStatus && targetDailyFocus) {
            await roadmapService.updateDailyFocusStatus(
                singleRoadmap.roadmapId,
                targetWeekNumber,
                targetDailyFocus.dayOfWeek,
                'in-progress'
            );
            console.log(
                `Updated daily focus status to in-progress for dayOfWeek ${targetDailyFocus.dayOfWeek}, week ${targetWeekNumber}`
            );
        }
        // Get user competency profile for context
        const user = (await User.findById(userId)
            .select('competencyProfile preferences')
            .lean()) as {
            competencyProfile?: {
                currentCEFRLevel?: string;
                skillMatrix?: Array<{
                    skill: string;
                    currentAccuracy: number;
                    proficiency: string;
                }>;
            };
            preferences?: {
                preferredStudyTime?: string;
                contentInterests?: string[];
            };
        } | null;

        // Prepare context for LLM
        const lowestSkills = user?.competencyProfile?.skillMatrix
            ?.filter((s) => s.currentAccuracy < 60)
            .sort((a, b) => a.currentAccuracy - b.currentAccuracy)
            .slice(0, 3);

        // Find available DB resources matching domains and skills
        // Nếu không có targetDailyFocus, dùng thông tin từ weekFocus
        const availableResources = await this.findAvailableResources(
            targetDailyFocus?.suggestedDomains ||
                weekFocus.recommendedDomains ||
                [],
            targetDailyFocus?.targetSkills || weekFocus.focusSkills || []
        );

        // Get mistakes that need practice from current week (top N from stack)
        const mistakesToPractice = weekFocus.mistakes?.slice(0, 40) || [];
        const skippedContent =
            await roadmapCalibrationService.getSkippedSessionsContent(userId);

        // Generate activities using AI with smart resource allocation
        const dailyFocusContext = targetDailyFocus
            ? {
                  focus: targetDailyFocus.focus,
                  targetSkills: targetDailyFocus.targetSkills || [],
                  suggestedDomains: targetDailyFocus.suggestedDomains || [],
                  estimatedMinutes: targetDailyFocus.estimatedMinutes,
              }
            : {
                  focus: `General practice for ${weekFocus.title}`,
                  targetSkills: weekFocus.focusSkills || [],
                  suggestedDomains: weekFocus.recommendedDomains || [],
                  estimatedMinutes: singleRoadmap.studyTimePerDay || 30,
              };

        const aiPlan = await dailyPlanAIService.generateDailyPlan({
            dailyFocus: dailyFocusContext,
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
            userPreferences: {
                preferredStudyTime: user?.preferences?.preferredStudyTime,
                contentInterests: user?.preferences?.contentInterests,
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
            missedSessions: skippedContent.hasSkippedSessions
                ? skippedContent.skippedContent
                : undefined,
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
                // console.log('Generating vocabulary set as per AI decision...');
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
            if (activity.generatePracticeDrill) {
                let questionIds = activity.practiceQuestionIds || [];

                // If no specific question IDs provided, search by skills/domains from AI
                if (questionIds.length === 0) {
                    console.log(
                        'No specific question IDs, searching by skills/domains from AI decision...'
                    );
                    const criteria: { skills?: string[]; domains?: string[] } =
                        {};

                    // Use AI-provided targetPracticeSkills and targetPracticeDomains
                    if (
                        activity.targetPracticeSkills &&
                        activity.targetPracticeSkills.length > 0
                    ) {
                        criteria.skills = activity.targetPracticeSkills;
                        console.log('Target practice skills:', criteria.skills);
                    }

                    if (
                        activity.targetPracticeDomains &&
                        activity.targetPracticeDomains.length > 0
                    ) {
                        criteria.domains = activity.targetPracticeDomains;
                        console.log(
                            'Target practice domains:',
                            criteria.domains
                        );
                    }

                    // Ensure at least one criteria is provided
                    if (!criteria.skills?.length && !criteria.domains?.length) {
                        console.warn(
                            'No practice criteria provided by AI, skipping drill generation'
                        );
                    } else {
                        // Find random questions based on criteria
                        const limit = Math.min(
                            activity.estimatedTime
                                ? activity.estimatedTime
                                : 15,
                            30
                        );
                        questionIds = await testService.findRandomQuestionIds(
                            criteria,
                            limit
                        );
                        console.log(
                            `Found ${questionIds.length} questions for practice drill`
                        );
                    }
                }

                if (questionIds.length > 0) {
                    // Add a brief instructional resource for practice drill
                    const drillGuide = {
                        type: 'personalized_guide' as const,
                        title: `How to approach ${activity.title}`,
                        description:
                            activity.drillInstructions ||
                            `Tips and strategies for ${activity.skillsToImprove?.join(', ') || 'this practice'}`,
                        estimatedTime: 3,
                        generatedContent: {
                            sections: [
                                {
                                    title: 'Practice Instructions',
                                    content:
                                        activity.drillInstructions ||
                                        'Focus on understanding the question thoroughly before selecting your answer.',
                                },
                                {
                                    title: 'Key Focus Areas',
                                    content: activity.skillsToImprove
                                        ? `This drill focuses on: ${activity.skillsToImprove.join(', ')}`
                                        : 'Practice these questions carefully.',
                                },
                            ],
                            quickTips: [
                                'Read each question carefully',
                                'Take your time - accuracy over speed',
                                `Target: ${activity.minCorrectAnswers || Math.floor(questionIds.length * 0.6)} correct out of ${questionIds.length}`,
                            ],
                        },
                        completed: false,
                    };
                    resources.push(drillGuide);

                    aiPracticeDrill.push({
                        title: activity.title || 'Practice Drill',
                        practiceQuestionIds: questionIds,
                        minCorrectAnswers: 0,
                        description:
                            activity.drillInstructions ||
                            `Practice drill focusing on ${activity.skillsToImprove?.[0] || 'general skills'}`,
                        totalQuestions: questionIds.length,
                        estimatedTime: Math.min(
                            activity.estimatedTime || 15,
                            20
                        ),
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
        let sessionTitle: string;
        let sessionDescription: string;

        if (roadmapStatus.isBlocked && targetDailyFocus) {
            sessionTitle = `CRITICAL: ${targetDailyFocus.focus}`;
            sessionDescription = `You need to complete this critical learning day before continuing the roadmap. ${weekFocus.summary}`;
        } else if (targetDailyFocus) {
            // Have scheduled session today
            sessionTitle = skippedContent.hasSkippedSessions
                ? `${targetDailyFocus.focus} + Catch-up Review`
                : targetDailyFocus.focus;
            sessionDescription = skippedContent.hasSkippedSessions
                ? `Today's session includes catch-up content from ${skippedContent.skippedContent.length} skipped session(s). ${weekFocus.summary}`
                : weekFocus.summary;
        } else {
            // No scheduled session today
            sessionTitle = skippedContent.hasSkippedSessions
                ? `${weekFocus.title} Practice + Catch-up Review`
                : `${weekFocus.title} Practice`;
            sessionDescription = skippedContent.hasSkippedSessions
                ? `No scheduled session today. General practice session with catch-up content from ${skippedContent.skippedContent.length} skipped session(s). ${weekFocus.summary}`
                : `No scheduled session today. General practice session for this week's focus. ${weekFocus.summary}`;
        }

        const newSession = await StudyPlan.create({
            userId: singleRoadmap.userId,
            roadmapRef: singleRoadmap._id,
            testResultId: singleRoadmap.testResultId,
            dayNumber: targetDailyFocus?.dayOfWeek || 1,
            weekNumber: targetWeekNumber,
            scheduledDate: today,
            title: sessionTitle,
            description: sessionDescription,
            targetSkills: targetDailyFocus?.targetSkills || [],
            targetDomains: targetDailyFocus?.suggestedDomains || [],
            targetWeaknesses: weekFocus.targetWeaknesses,
            planItems,
            totalEstimatedTime: targetDailyFocus?.estimatedMinutes || 0,
            status: 'upcoming',
        });
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
        return progressTrackingService.completeDailySession(userId, sessionId);
    }

    async trackResourceView(
        sessionId: string,
        itemId: string,
        resourceId: string,
        timeSpent: number
    ): Promise<StudyPlanType> {
        return progressTrackingService.trackResourceView(
            sessionId,
            itemId,
            resourceId,
            timeSpent
        );
    }

    async completePracticeDrill(sessionId: string): Promise<StudyPlanType> {
        return progressTrackingService.completePracticeDrill(sessionId);
    }
}

export const dailySessionService = new DailySessionService();
