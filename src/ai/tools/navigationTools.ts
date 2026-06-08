// navigationTools.ts - Tools for navigating within the app and starting activities
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import testService from '~/services/testService.js';

// Route mappings for navigation
const ROUTE_MAP: Record<
    string,
    { route: string; title: string; description: string }
> = {
    dashboard: {
        route: '/dashboard',
        title: 'Dashboard',
        description: 'View your learning dashboard with progress overview',
    },
    tests: {
        route: '/tests',
        title: 'Available Tests',
        description: 'Browse and take TOEIC practice tests',
    },
    test_history: {
        route: '/me/tests',
        title: 'My Test History',
        description: 'View your past test results and analyses',
    },
    flashcards: {
        route: '/flashcards',
        title: 'Flashcards',
        description: 'Study and manage your vocabulary flashcards',
    },
    learning_plan: {
        route: '/learning-plan',
        title: 'Learning Plan',
        description: 'View your personalized learning roadmap',
    },
    resources: {
        route: '/resources',
        title: 'Learning Resources',
        description: 'Browse articles, videos, and study materials',
    },
    payment: {
        route: '/payment',
        title: 'Credits & Payment',
        description: 'Purchase credits for premium features',
    },
    practice_drill: {
        route: '/practice-drill',
        title: 'Practice Drill',
        description: 'Practice TOEIC questions',
    },
    vocabulary: {
        route: '/vocabulary',
        title: 'Vocabulary Browser',
        description: 'Browse and learn new vocabulary',
    },
    recordings: {
        route: '/recordings',
        title: 'Speech Analyzer',
        description: 'Analyze your pronunciation and speaking',
    },
    conversation_practice: {
        route: '/conversation-practice',
        title: 'AI Conversation',
        description: 'Practice speaking with AI tutor',
    },
    profile: {
        route: '/profile',
        title: 'Profile Settings',
        description: 'Manage your account and preferences',
    },
};

// Available TOEIC skills for practice
const AVAILABLE_SKILLS = {
    listening: {
        part1: [
            'identifyActionInProgress',
            'identifyStateCondition',
            'identifySpatialRelationship',
        ],
        part2: [
            'whQuestion',
            'yesNo',
            'tagQuestion',
            'statement',
            'alternative',
            'informationSeeking',
            'request',
            'suggestion',
        ],
        part34: [
            'mainTopic',
            'purpose',
            'problem',
            'specificDetail',
            'reasonCause',
            'inferSpeakerRole',
            'inferLocation',
            'inferImplication',
            'futureAction',
            'speakerIntent',
        ],
    },
    reading: {
        part5: [
            'wordForm',
            'verbTenseMood',
            'subjectVerbAgreement',
            'pronoun',
            'preposition',
            'conjunction',
            'relativeClause',
            'wordChoice',
            'collocation',
            'phrasalVerb',
        ],
        part6: [
            'grammar',
            'vocabulary',
            'sentenceInsertion',
            'discourseConnector',
        ],
        part7: [
            'mainTopicPurpose',
            'scanning',
            'paraphrasing',
            'inferImplication',
            'inferAuthorPurpose',
            'vocabularyInContext',
            'crossReference',
        ],
    },
};

/**
 * Tool to navigate user to app pages
 */
const navigateUserTool = tool(
    async ({ destination, params }) => {
        const routeInfo = ROUTE_MAP[destination];

        if (!routeInfo) {
            return JSON.stringify({
                success: false,
                message: `Unknown destination: ${destination}. Available: ${Object.keys(ROUTE_MAP).join(', ')}`,
            });
        }

        return JSON.stringify({
            success: true,
            route: routeInfo.route,
            args: params || {},
            title: routeInfo.title,
            description: routeInfo.description,
            message: `Taking you to ${routeInfo.title}...`,
        });
    },
    {
        name: 'navigate_user',
        description: `Navigate user to a specific page in the app.

Available destinations:
- dashboard: Main dashboard with progress overview
- tests: Browse available TOEIC tests
- test_history: View past test results
- flashcards: Vocabulary flashcard collection
- learning_plan: Personalized learning roadmap
- resources: Articles, videos, study materials
- payment: Purchase credits
- practice_drill: Practice TOEIC questions
- vocabulary: Browse vocabulary
- recordings: Speech analyzer
- conversation_practice: AI conversation practice
- profile: Account settings

Use this when user wants to go to a specific page or asks to be navigated somewhere.
The response includes the route for a NAVIGATE action.`,
        schema: z.object({
            destination: z
                .enum([
                    'dashboard',
                    'tests',
                    'test_history',
                    'flashcards',
                    'learning_plan',
                    'resources',
                    'payment',
                    'practice_drill',
                    'vocabulary',
                    'recordings',
                    'conversation_practice',
                    'profile',
                ])
                .describe('The page to navigate to'),
            params: z
                .record(z.unknown())
                .optional()
                .describe('Optional parameters to pass to the route'),
        }),
    }
);

/**
 * Tool to start a practice drill with specific skills
 */
const startPracticeDrillTool = tool(
    async ({ skills, domains, questionCount }, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');

        try {
            const count = questionCount || 10;
            const criteria: { skills?: string[]; domains?: string[] } = {};

            if (skills && skills.length > 0) {
                criteria.skills = skills;
            }
            if (domains && domains.length > 0) {
                criteria.domains = domains;
            }

            // If no criteria provided, do general practice
            if (!criteria.skills && !criteria.domains) {
                criteria.skills = ['wordForm', 'verbTenseMood', 'mainTopic']; // Default skills
            }

            // Find random questions matching criteria
            const questionIds = await testService.findRandomQuestionIds(
                criteria,
                count
            );

            if (questionIds.length === 0) {
                return JSON.stringify({
                    success: false,
                    message:
                        'No questions found matching your criteria. Try different skills or domains.',
                    suggestedSkills: [
                        ...AVAILABLE_SKILLS.listening.part34,
                        ...AVAILABLE_SKILLS.reading.part5,
                    ].slice(0, 5),
                });
            }

            // Build practice URL
            const practiceUrl = `/practice-drill?questionIds=${questionIds.join(',')}`;

            // Determine what type of practice this is
            let practiceType = 'Mixed Practice';
            if (skills && skills.length > 0) {
                const listeningSkills = [
                    ...AVAILABLE_SKILLS.listening.part1,
                    ...AVAILABLE_SKILLS.listening.part2,
                    ...AVAILABLE_SKILLS.listening.part34,
                ];
                const readingSkills = [
                    ...AVAILABLE_SKILLS.reading.part5,
                    ...AVAILABLE_SKILLS.reading.part6,
                    ...AVAILABLE_SKILLS.reading.part7,
                ];

                const hasListening = skills.some((s) =>
                    listeningSkills.includes(s)
                );
                const hasReading = skills.some((s) =>
                    readingSkills.includes(s)
                );

                if (hasListening && !hasReading)
                    practiceType = 'Listening Practice';
                else if (hasReading && !hasListening)
                    practiceType = 'Reading Practice';
            }

            return JSON.stringify({
                success: true,
                practiceUrl,
                questionIds,
                questionCount: questionIds.length,
                practiceType,
                estimatedMinutes: Math.ceil(questionIds.length * 1.5), // ~1.5 min per question
                targetSkills: skills || [],
                targetDomains: domains || [],
                message: `Created a practice drill with ${questionIds.length} questions. Ready to start!`,
            });
        } catch (error) {
            console.error('[startPracticeDrill] Error:', error);
            return JSON.stringify({
                success: false,
                message: 'Unable to create practice drill',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    },
    {
        name: 'start_practice_drill',
        description: `Create and start a practice drill with specific TOEIC skills or content domains.

AVAILABLE SKILLS (by part):
**Listening:**
- Part 1: identifyActionInProgress, identifyStateCondition, identifySpatialRelationship
- Part 2: whQuestion, yesNo, tagQuestion, informationSeeking, request, suggestion
- Part 3/4: mainTopic, purpose, problem, specificDetail, reasonCause, inferSpeakerRole, inferLocation, inferImplication, futureAction, speakerIntent

**Reading:**
- Part 5: wordForm, verbTenseMood, subjectVerbAgreement, pronoun, preposition, conjunction, relativeClause, wordChoice, collocation, phrasalVerb
- Part 6: grammar, vocabulary, sentenceInsertion, discourseConnector
- Part 7: mainTopicPurpose, scanning, paraphrasing, inferImplication, inferAuthorPurpose, vocabularyInContext, crossReference

AVAILABLE DOMAINS (content areas):
business, office, finance, technology, education, healthcare, travel, hospitality, manufacturing, marketing, retail, news

Use this when user wants to practice specific skills or content areas.
Returns a URL with question IDs for the NAVIGATE action.`,
        schema: z.object({
            skills: z
                .array(z.string())
                .optional()
                .describe(
                    'TOEIC skills to practice (e.g., ["wordForm", "verbTenseMood"])'
                ),
            domains: z
                .array(z.string())
                .optional()
                .describe(
                    'Content domains to focus on (e.g., ["business", "technology"])'
                ),
            questionCount: z
                .number()
                .int()
                .min(5)
                .max(50)
                .optional()
                .describe('Number of questions (default: 10, max: 50)'),
        }),
    }
);

export const navigationTools = [navigateUserTool, startPracticeDrillTool];
