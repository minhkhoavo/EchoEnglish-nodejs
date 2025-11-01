import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { Resource } from '~/models/resource.js';
import testService from '~/services/testService.js';
import { AVAILABLE_DOMAINS } from '~/enum/domain.js';
// Available skills/tags in the system
const AVAILABLE_SKILLS = {
    // Part 1: Photographs
    part1: [
        'identifyActionInProgress',
        'identifyStateCondition',
        'identifySpatialRelationship',
    ],
    // Part 2: Question-Response
    part2: [
        'whQuestion',
        'yesNo',
        'tagQuestion',
        'statement',
        'alternative',
        'negativeQuestion',
        'informationSeeking',
        'request',
        'suggestion',
        'offer',
        'opinion',
        'direct',
        'indirect',
    ],
    // Parts 3 & 4: Conversations & Talks
    part34: [
        'mainTopic',
        'purpose',
        'problem',
        'specificDetail',
        'reasonCause',
        'amountQuantity',
        'inferSpeakerRole',
        'inferLocation',
        'inferImplication',
        'inferFeelingAttitude',
        'futureAction',
        'recommendedAction',
        'requestedAction',
        'speakerIntent',
        'connectToGraphic',
    ],
    // Part 5: Incomplete Sentences
    part5: [
        'wordForm',
        'verbTenseMood',
        'subjectVerbAgreement',
        'pronoun',
        'preposition',
        'conjunction',
        'relativeClause',
        'comparativeSuperlative',
        'participle',
        'wordChoice',
        'collocation',
        'phrasalVerb',
    ],
    // Part 6: Text Completion
    part6: ['grammar', 'vocabulary', 'sentenceInsertion', 'discourseConnector'],
    // Part 7: Reading Comprehension
    part7: [
        'mainTopicPurpose',
        'scanning',
        'paraphrasing',
        'inferImplication',
        'inferAuthorPurpose',
        'vocabularyInContext',
        'sentenceInsertion',
        'crossReference',
    ],
    // General skills
    general: [
        'reading comprehension',
        'listening',
        'vocabulary',
        'grammar',
        'pronunciation',
    ],
} as const;

console.log('AVAILABLE_DOMAINS::::::::', AVAILABLE_DOMAINS);

/**
 * Tool to find learning resources based on domains
 * Maps to the findAvailableResources function from DailySessionService
 */
const findLearningResourcesTool = tool(
    async ({ domains, limit }) => {
        const searchCriteria: Record<string, unknown> = {
            suitableForLearners: true,
        };

        // Add domain filter - search in both labels.domain and labels.topic
        if (domains && domains.length > 0) {
            const domainFilters = domains.map((d) => d.toLowerCase());
            searchCriteria['$or'] = [
                { 'labels.domain': { $in: domainFilters } },
                { 'labels.topic': { $in: domainFilters } },
            ];
        }

        // Find matching resources
        const resources = await Resource.find(searchCriteria)
            .limit(limit || 5)
            .lean();

        // Format results for AI agent
        const formatted = resources.map((r) => ({
            id: r._id?.toString(),
            type: r.type,
            title: r.title,
            description: r.summary || r.content?.substring(0, 200),
            url: `/resources/${r._id?.toString()}`, // Frontend route format
            originalUrl: r.url,
            domain: r.labels?.domain,
            topics: r.labels?.topic || [],
            cefr: r.labels?.cefr,
            style: r.labels?.style,
            genre: r.labels?.genre,
            setting: r.labels?.setting,
        }));

        return JSON.stringify({
            total: formatted.length,
            resources: formatted,
            message:
                formatted.length > 0
                    ? `Found ${formatted.length} suitable learning resources`
                    : 'No resources found matching the criteria',
        });
    },
    {
        name: 'find_learning_resources',
        description: `Find learning resources (articles, videos, podcasts) suitable for TOEIC learners based on content domains.

AVAILABLE DOMAINS (use lowercase):
${AVAILABLE_DOMAINS.join(', ')}

This tool searches for resources matching the provided domains in BOTH the domain field AND the topic field of resources. For example, searching for "business" will find resources with domain="business" OR topic containing "business".

Returns up to the specified limit of resources with title, URL, description, and metadata.`,
        schema: z.object({
            domains: z
                .array(z.string())
                .describe(
                    `Array of domain names (MUST be lowercase). Examples: ["business", "technology", "news", "politics", "healthcare", "media"]. These are searched in both the domain and topic fields.`
                ),
            limit: z
                .number()
                .optional()
                .default(5)
                .describe('Maximum number of resources to return (default: 5)'),
        }),
    }
);

/**
 * Tool to find practice test questions based on skills or domains
 * Maps to the findRandomQuestionIds function from TestService
 */
const findPracticeQuestionsTool = tool(
    async ({ skills, domains, limit }) => {
        if (
            (!skills || skills.length === 0) &&
            (!domains || domains.length === 0)
        ) {
            return JSON.stringify({
                total: 0,
                questionIds: [],
                message:
                    'Please provide at least one skill or domain to search for questions',
            });
        }

        try {
            const criteria: { skills?: string[]; domains?: string[] } = {};
            if (skills && skills.length > 0) {
                criteria.skills = skills;
            }
            if (domains && domains.length > 0) {
                criteria.domains = domains;
            }

            // Find random question IDs
            const questionIds = await testService.findRandomQuestionIds(
                criteria,
                limit || 10
            );

            // Return question IDs only - no need to fetch full data
            if (questionIds.length > 0) {
                // Generate practice drill URL with question IDs as query params
                const practiceUrl = `/practice-drill?questionIds=${questionIds.join(',')}`;

                return JSON.stringify({
                    total: questionIds.length,
                    questionIds: questionIds,
                    practiceUrl: practiceUrl,
                    message: `Found ${questionIds.length} practice questions matching your criteria`,
                });
            }

            return JSON.stringify({
                total: 0,
                questionIds: [],
                message: 'No questions found matching the criteria',
            });
        } catch (error) {
            console.error('Error finding practice questions:', error);
            return JSON.stringify({
                total: 0,
                questionIds: [],
                message: 'Error occurred while searching for questions',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    },
    {
        name: 'find_practice_questions',
        description: `Find practice test questions in TOEIC format based on specific skills or content domains. Use this when users want to practice specific TOEIC skills or content areas.

AVAILABLE DOMAINS (for content filtering):
${AVAILABLE_DOMAINS.join(', ')}

AVAILABLE SKILLS (searchable by part):
- Part 1 Skills: ${AVAILABLE_SKILLS.part1.join(', ')}
- Part 2 Skills: ${AVAILABLE_SKILLS.part2.join(', ')}
- Part 3&4 Skills: ${AVAILABLE_SKILLS.part34.join(', ')}
- Part 5 Skills: ${AVAILABLE_SKILLS.part5.join(', ')}
- Part 6 Skills: ${AVAILABLE_SKILLS.part6.join(', ')}
- Part 7 Skills: ${AVAILABLE_SKILLS.part7.join(', ')}
- General Skills: ${AVAILABLE_SKILLS.general.join(', ')}

Returns question IDs and complete test data with parts, questions, and contexts.`,
        schema: z.object({
            skills: z
                .array(z.string())
                .optional()
                .describe(
                    `Array of TOEIC-specific skills to search for. Use exact skill names from the available list. Examples: ["reading comprehension", "vocabulary", "wordForm", "mainTopic", "inferImplication"]`
                ),
            domains: z
                .array(z.string())
                .optional()
                .describe(
                    `Array of content domains (lowercase). Examples: ["business", "technology", "healthcare", "travel", "finance"]`
                ),
            limit: z
                .number()
                .optional()
                .default(10)
                .describe(
                    'Maximum number of questions to return (default: 10, max: 50)'
                ),
        }),
    }
);

/**
 * Tool to get detailed information about specific resources by IDs
 */
const getResourceDetailsTool = tool(
    async ({ resourceIds }) => {
        if (!resourceIds || resourceIds.length === 0) {
            return JSON.stringify({
                message: 'No resource IDs provided',
                resources: [],
            });
        }

        try {
            const resources = await Resource.find({
                _id: { $in: resourceIds },
            }).lean();

            const formatted = resources.map((r) => ({
                id: r._id?.toString(),
                type: r.type,
                title: r.title,
                url: `/resources/${r._id?.toString()}`, // Frontend route format
                originalUrl: r.url, // External URL if exists
                summary: r.summary,
                content: r.content,
                keyPoints: r.keyPoints,
                publishedAt: r.publishedAt,
                labels: r.labels,
                lang: r.lang,
            }));

            return JSON.stringify({
                total: formatted.length,
                resources: formatted,
            });
        } catch (error) {
            console.error('Error getting resource details:', error);
            return JSON.stringify({
                message: 'Error retrieving resource details',
                resources: [],
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    },
    {
        name: 'get_resource_details',
        description:
            'Get detailed information about specific learning resources by their IDs. Returns full content, key points, and metadata.',
        schema: z.object({
            resourceIds: z
                .array(z.string())
                .describe('Array of resource IDs to retrieve details for'),
        }),
    }
);

export const learningResourceTools = [
    findLearningResourcesTool,
    findPracticeQuestionsTool,
    getResourceDetailsTool,
];
