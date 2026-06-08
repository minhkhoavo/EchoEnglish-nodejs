// learnerProgressTools.ts - Tools for accessing user learning progress and data
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { testResultService } from '~/services/testResultService.js';
import { competencyProfileService } from '~/services/recommendation/CompetencyProfileService.js';
import { dailySessionService } from '~/services/recommendation/DailySessionService.js';
import { User } from '~/models/userModel.js';

// Map skill keys to human-readable names
const SKILL_NAME_MAP: Record<string, string> = {
    // Part 1
    identifyActionInProgress: 'Identify Action (Part 1)',
    identifyStateCondition: 'Identify State/Condition (Part 1)',
    identifySpatialRelationship: 'Spatial Relationship (Part 1)',
    // Part 2
    whQuestion: 'WH Questions (Part 2)',
    yesNo: 'Yes/No Questions (Part 2)',
    tagQuestion: 'Tag Questions (Part 2)',
    informationSeeking: 'Information Seeking (Part 2)',
    request: 'Requests (Part 2)',
    suggestion: 'Suggestions (Part 2)',
    // Part 3/4
    mainTopic: 'Main Topic (Part 3/4)',
    purpose: 'Purpose (Part 3/4)',
    problem: 'Problem Identification (Part 3/4)',
    specificDetail: 'Specific Details (Part 3/4)',
    reasonCause: 'Reason/Cause (Part 3/4)',
    inferSpeakerRole: 'Infer Speaker Role (Part 3/4)',
    inferLocation: 'Infer Location (Part 3/4)',
    inferImplication: 'Inference (Part 3/4/7)',
    futureAction: 'Future Action (Part 3/4)',
    speakerIntent: 'Speaker Intent (Part 3/4)',
    // Part 5
    wordForm: 'Word Form (Part 5)',
    verbTenseMood: 'Verb Tense/Mood (Part 5)',
    subjectVerbAgreement: 'Subject-Verb Agreement (Part 5)',
    pronoun: 'Pronouns (Part 5)',
    preposition: 'Prepositions (Part 5)',
    conjunction: 'Conjunctions (Part 5)',
    relativeClause: 'Relative Clauses (Part 5)',
    wordChoice: 'Word Choice (Part 5/6)',
    collocation: 'Collocations (Part 5)',
    phrasalVerb: 'Phrasal Verbs (Part 5)',
    // Part 6
    grammar: 'Grammar (Part 6)',
    vocabulary: 'Vocabulary (Part 6)',
    sentenceInsertion: 'Sentence Insertion (Part 6/7)',
    discourseConnector: 'Discourse Connectors (Part 6)',
    // Part 7
    mainTopicPurpose: 'Main Topic/Purpose (Part 7)',
    scanning: 'Scanning (Part 7)',
    paraphrasing: 'Paraphrasing (Part 7)',
    inferAuthorPurpose: 'Author Purpose (Part 7)',
    vocabularyInContext: 'Vocabulary in Context (Part 7)',
    crossReference: 'Cross Reference (Part 7)',
};

/**
 * Tool to get comprehensive learning progress and stats
 */
const getLearningProgressTool = tool(
    async (_input, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');

        try {
            // Get user stats
            const stats = await testResultService.getUserStats(userId);

            // Get chart data for recent scores
            const chartData =
                await testResultService.getListeningReadingChartData(userId);

            // Get user profile for CEFR level
            const user = (await User.findById(userId)
                .select('competencyProfile')
                .lean()) as {
                competencyProfile?: { currentCEFRLevel?: string };
            } | null;

            const currentLevel =
                user?.competencyProfile?.currentCEFRLevel || 'Not assessed';

            // Calculate trend
            const recentScores = chartData.timeline.slice(-5);
            let trend = 'stable';
            if (recentScores.length >= 2) {
                const lastScore =
                    recentScores[recentScores.length - 1]?.totalScore || 0;
                const prevScore =
                    recentScores[recentScores.length - 2]?.totalScore || 0;
                if (lastScore > prevScore + 20) trend = 'improving';
                else if (lastScore < prevScore - 20) trend = 'declining';
            }

            return JSON.stringify({
                success: true,
                progress: {
                    testsTaken: stats.listeningReadingTests,
                    averageScore: stats.averageScore,
                    highestScore: stats.highestScore,
                    currentLevel,
                    trend,
                    recentScores: recentScores.map((s) => ({
                        date: s.date,
                        totalScore: s.totalScore,
                        listeningScore: s.listeningScore,
                        readingScore: s.readingScore,
                    })),
                    recentTests: stats.recentTests.slice(0, 3).map((t) => ({
                        title: t.testTitle,
                        date: t.completedAt,
                        percentage: t.percentage,
                    })),
                },
                message:
                    stats.listeningReadingTests > 0
                        ? `You have completed ${stats.listeningReadingTests} tests with an average score of ${stats.averageScore}.`
                        : 'You have not taken any tests yet. Start with a practice test to track your progress!',
            });
        } catch (error) {
            console.error('[getLearningProgress] Error:', error);
            return JSON.stringify({
                success: false,
                message: 'Unable to retrieve learning progress',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    },
    {
        name: 'get_learning_progress',
        description: `Get comprehensive learning progress and statistics for the user.

Returns:
- Tests taken count
- Average and highest scores
- Current CEFR level (A1-C2)
- Recent score trend (improving/stable/declining)
- Recent test results

Use this when the user asks about their progress, stats, how they're doing, or wants an overview of their learning.`,
        schema: z.object({}),
    }
);

/**
 * Tool to identify user's weakest skills
 */
const getWeakSkillsTool = tool(
    async ({ limit }, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');

        try {
            const weakSkills =
                await competencyProfileService.getWeakSkills(userId);

            const formattedSkills = weakSkills
                .slice(0, limit || 5)
                .map((skill) => ({
                    skillKey: skill.skill,
                    skillName: SKILL_NAME_MAP[skill.skill] || skill.skill,
                    accuracy: Math.round(skill.accuracy),
                    proficiency: skill.proficiency,
                    recommendedAction:
                        skill.accuracy < 50
                            ? `Focus on ${SKILL_NAME_MAP[skill.skill] || skill.skill} - needs intensive practice`
                            : `Practice ${SKILL_NAME_MAP[skill.skill] || skill.skill} to strengthen this skill`,
                }));

            // Determine focus area
            let focusArea = 'General Practice';
            if (formattedSkills.length > 0) {
                const firstSkillName = formattedSkills[0].skillName;
                if (
                    firstSkillName.includes('Part 1') ||
                    firstSkillName.includes('Part 2') ||
                    firstSkillName.includes('Part 3') ||
                    firstSkillName.includes('Part 4')
                ) {
                    focusArea = 'Listening';
                } else if (
                    firstSkillName.includes('Part 5') ||
                    firstSkillName.includes('Part 6') ||
                    firstSkillName.includes('Part 7')
                ) {
                    focusArea = 'Reading';
                }
            }

            return JSON.stringify({
                success: true,
                weakSkills: formattedSkills,
                focusArea,
                totalWeakSkills: weakSkills.length,
                message:
                    formattedSkills.length > 0
                        ? `You have ${formattedSkills.length} skills that need improvement. Focus on: ${formattedSkills[0].skillName}.`
                        : 'Great job! No weak skills identified. Keep practicing to maintain your level!',
            });
        } catch (error) {
            console.error('[getWeakSkills] Error:', error);
            return JSON.stringify({
                success: false,
                message:
                    'Unable to retrieve weak skills. You may need to take a test first.',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    },
    {
        name: 'get_weak_skills',
        description: `Identify user's weakest TOEIC skills for targeted practice.

Returns skills sorted by accuracy (lowest first) with:
- Skill name and accuracy percentage
- Proficiency level (weak/developing/proficient/mastered)
- Recommended action for improvement
- Overall focus area (Listening/Reading)

Use this when user asks what they should practice, what their weak points are, or needs study recommendations.`,
        schema: z.object({
            limit: z
                .number()
                .int()
                .min(1)
                .max(10)
                .optional()
                .describe('Number of weak skills to return (default: 5)'),
        }),
    }
);

/**
 * Tool to get today's learning plan/session
 */
const getTodayLearningPlanTool = tool(
    async (_input, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');

        try {
            const session = await dailySessionService.getTodaySession(userId);

            if (!session) {
                return JSON.stringify({
                    success: true,
                    hasActivePlan: false,
                    session: null,
                    message:
                        'No learning plan set up yet. Would you like to create a personalized learning roadmap?',
                    quickStartUrl: '/learning-plan/setup',
                });
            }

            // Format activities from planItems
            const activities = (session.planItems || []).map(
                (item: {
                    title?: string;
                    description?: string;
                    estimatedWeeks?: number;
                    status?: string;
                    activityType?: string;
                    resources?: Array<{ title?: string }>;
                }) => ({
                    title: item.title || 'Learning Activity',
                    description: item.description || '',
                    estimatedMinutes: item.estimatedWeeks || 15,
                    completed: item.status === 'completed',
                    type: item.activityType || 'learn',
                })
            );

            // Calculate progress
            const completedCount = activities.filter(
                (a: { completed: boolean }) => a.completed
            ).length;
            const progress =
                activities.length > 0
                    ? Math.round((completedCount / activities.length) * 100)
                    : 0;

            return JSON.stringify({
                success: true,
                hasActivePlan: true,
                session: {
                    title: session.title,
                    description: session.description,
                    scheduledDate: session.scheduledDate,
                    targetMinutes: session.totalEstimatedTime || 30,
                    progress,
                    status: session.status,
                    activities: activities.slice(0, 5),
                    targetSkills: session.targetSkills || [],
                },
                quickStartUrl: '/learning-plan',
                message:
                    progress === 100
                        ? "Great job! You've completed today's learning session!"
                        : `Today's focus: ${session.title}. You're ${progress}% done.`,
            });
        } catch (error) {
            console.error('[getTodayLearningPlan] Error:', error);
            return JSON.stringify({
                success: false,
                hasActivePlan: false,
                message: "Unable to retrieve today's learning plan",
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    },
    {
        name: 'get_today_learning_plan',
        description: `Get today's personalized learning session and activities.

Returns:
- Session title and description
- List of activities (reading, practice drills, vocabulary)
- Progress percentage
- Target skills for today

Use this when user asks what to study today, what their plan is, or wants to see today's learning activities.`,
        schema: z.object({}),
    }
);

/**
 * Tool to get test history
 */
const getTestHistoryTool = tool(
    async ({ limit, testType }, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');

        try {
            const history = await testResultService.getTestHistory(
                userId,
                1,
                limit || 5
            );

            const tests = history.results
                .filter(
                    (t) =>
                        testType === 'all' ||
                        !testType ||
                        t.testType === testType
                )
                .map((t) => ({
                    id: t.id,
                    testTitle: t.testTitle,
                    completedAt: t.completedAt,
                    percentage: t.percentage,
                    partsKey: t.partsKey,
                    viewUrl: `/me/tests/${t.id}`,
                }));

            // Calculate average from shown tests
            const avgPercentage =
                tests.length > 0
                    ? Math.round(
                          tests.reduce((sum, t) => sum + t.percentage, 0) /
                              tests.length
                      )
                    : 0;

            return JSON.stringify({
                success: true,
                tests,
                totalTests: history.total,
                averagePercentage: avgPercentage,
                viewAllUrl: '/me/tests',
                message:
                    tests.length > 0
                        ? `Found ${history.total} tests. Your recent average: ${avgPercentage}%.`
                        : 'No test results yet. Take a practice test to start tracking your progress!',
            });
        } catch (error) {
            console.error('[getTestHistory] Error:', error);
            return JSON.stringify({
                success: false,
                message: 'Unable to retrieve test history',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    },
    {
        name: 'get_test_history',
        description: `Get user's test history with results and scores.

Returns:
- List of recent tests with titles, dates, scores
- Total test count
- Direct links to view each result

Use this when user asks about their test results, past tests, or wants to review previous attempts.`,
        schema: z.object({
            limit: z
                .number()
                .int()
                .min(1)
                .max(20)
                .optional()
                .describe('Number of tests to return (default: 5)'),
            testType: z
                .enum(['all', 'listening-reading'])
                .optional()
                .describe('Filter by test type'),
        }),
    }
);

/**
 * Tool to check user credits
 */
const getUserCreditsTool = tool(
    async (_input, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');

        try {
            const user = (await User.findById(userId)
                .select('credits')
                .lean()) as { credits?: number } | null;
            const credits = user?.credits || 0;

            // Feature costs (example values)
            const featureCosts = {
                testAnalysis: 10,
                aiTutor: 5,
                premiumResources: 3,
            };

            return JSON.stringify({
                success: true,
                credits,
                canAfford: {
                    testAnalysis: credits >= featureCosts.testAnalysis,
                    aiTutor: credits >= featureCosts.aiTutor,
                    premiumResources: credits >= featureCosts.premiumResources,
                },
                topUpUrl: '/payment',
                message:
                    credits > 0
                        ? `You have ${credits} credits available.`
                        : 'You have no credits. Would you like to top up to unlock premium features?',
            });
        } catch (error) {
            console.error('[getUserCredits] Error:', error);
            return JSON.stringify({
                success: false,
                message: 'Unable to retrieve credit balance',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    },
    {
        name: 'get_user_credits',
        description: `Check user's credit balance for premium features.

Returns:
- Current credit balance
- What features they can afford
- Link to purchase more credits

Use this when user asks about credits, balance, or wants to know if they can use a premium feature.`,
        schema: z.object({}),
    }
);

/**
 * Tool to get AI-generated competency insights
 */
const getCompetencyInsightsTool = tool(
    async (_input, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');

        try {
            const user = (await User.findById(userId)
                .select('competencyProfile')
                .lean()) as {
                competencyProfile?: {
                    aiInsights?: Array<{
                        title: string;
                        description: string;
                        priority: string;
                        actionText?: string;
                    }>;
                    scorePrediction?: {
                        overallScore: number;
                        listeningScore: number;
                        readingScore: number;
                        cefrLevel: string;
                        summary: string;
                    };
                    skillsMap?: Array<{
                        skillName: string;
                        percentage: number;
                    }>;
                    lastUpdated?: Date;
                };
            } | null;

            const profile = user?.competencyProfile;

            if (!profile || !profile.aiInsights) {
                return JSON.stringify({
                    success: true,
                    hasInsights: false,
                    message:
                        'No AI insights available yet. Complete more tests to generate personalized insights!',
                });
            }

            return JSON.stringify({
                success: true,
                hasInsights: true,
                insights:
                    profile.aiInsights?.map((i) => ({
                        type: i.priority === 'high' ? 'weakness' : 'tip',
                        title: i.title,
                        description: i.description,
                        action: i.actionText,
                    })) || [],
                scorePrediction: profile.scorePrediction
                    ? {
                          listening: profile.scorePrediction.listeningScore,
                          reading: profile.scorePrediction.readingScore,
                          total: profile.scorePrediction.overallScore,
                          level: profile.scorePrediction.cefrLevel,
                          summary: profile.scorePrediction.summary,
                      }
                    : null,
                skillsMap: profile.skillsMap || [],
                lastUpdated: profile.lastUpdated,
                message: `Based on your performance, your predicted score is ${profile.scorePrediction?.overallScore || 'N/A'}.`,
            });
        } catch (error) {
            console.error('[getCompetencyInsights] Error:', error);
            return JSON.stringify({
                success: false,
                message: 'Unable to retrieve competency insights',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    },
    {
        name: 'get_competency_insights',
        description: `Get AI-generated insights about user's learning profile and predicted scores.

Returns:
- Personalized AI insights (strengths, weaknesses, tips)
- Score prediction (listening, reading, total)
- Skills radar map data
- CEFR level assessment

Use this when user asks for analysis, predictions, or wants to understand their overall competency.`,
        schema: z.object({}),
    }
);

export const learnerProgressTools = [
    getLearningProgressTool,
    getWeakSkillsTool,
    getTodayLearningPlanTool,
    getTestHistoryTool,
    getUserCreditsTool,
    getCompetencyInsightsTool,
];
