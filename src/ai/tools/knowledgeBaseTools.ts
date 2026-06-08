// knowledgeBaseTools.ts - Tools for RAG knowledge base (admin articles)
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { knowledgeBaseService } from '~/services/knowledgeBase/knowledgeBaseService.js';
import { Resource } from '~/models/resource.js';

/**
 * Citation metadata returned with each knowledge chunk
 */
interface KnowledgeCitation {
    resourceId: string;
    title: string;
    excerpt: string;
    url: string;
    score: number;
}

/**
 * Tool to search the knowledge base for relevant information
 * Returns content with citation metadata for frontend display
 */
const searchKnowledgeBaseTool = tool(
    async ({ query, topK }) => {
        try {
            const results = await knowledgeBaseService.queryKnowledge({
                query,
                topK: topK ?? 5,
            });

            if (results.length === 0) {
                return JSON.stringify({
                    found: false,
                    context: '',
                    citations: [],
                    message: 'No relevant information found in knowledge base',
                });
            }

            // Build context string and citations
            const citations: KnowledgeCitation[] = results.map((r, idx) => ({
                id: idx + 1,
                resourceId: r.resourceId,
                title: r.title,
                excerpt:
                    r.content.substring(0, 200) +
                    (r.content.length > 200 ? '...' : ''),
                url: `/resources/${r.resourceId}`,
                score: r.score,
            }));

            // Build context for LLM with citation markers
            const contextWithMarkers = results
                .map((r, idx) => `[${idx + 1}] ${r.content}`)
                .join('\n\n');

            return JSON.stringify({
                found: true,
                context: contextWithMarkers,
                citations,
                message: `Found ${results.length} relevant knowledge chunks`,
            });
        } catch (error) {
            console.error('[KnowledgeBase] Search error:', error);
            return JSON.stringify({
                found: false,
                context: '',
                citations: [],
                message: 'Error searching knowledge base',
            });
        }
    },
    {
        name: 'search_knowledge_base',
        description: `Search the EchoEnglish knowledge base for information about English learning, TOEIC preparation, grammar, vocabulary, business English, and related topics.

USE THIS TOOL WHEN:
- User asks about English grammar rules or usage
- User needs explanations about TOEIC test strategies
- User asks about vocabulary or word usage
- User needs help understanding English concepts
- User asks about business English or specific domains

The knowledge base contains curated articles and learning materials created by admins.

IMPORTANT: When using information from this tool, you MUST include the citation numbers [1], [2], etc. in your response so users can click to see the source.`,
        schema: z.object({
            query: z
                .string()
                .min(3)
                .describe('Search query - describe what information you need'),
            topK: z
                .number()
                .int()
                .min(1)
                .max(10)
                .optional()
                .describe('Number of results to return (default: 5, max: 10)'),
        }),
    }
);

/**
 * Tool to get detailed article content by ID
 * Used when user clicks on a citation or needs more detail
 */
const getKnowledgeArticleTool = tool(
    async ({ resourceId }) => {
        try {
            const resource = (await Resource.findById(
                resourceId
            ).lean()) as Record<string, unknown> | null;

            if (!resource) {
                return JSON.stringify({
                    found: false,
                    message: 'Article not found',
                });
            }

            // Convert HTML content to plain text for LLM
            const content = resource.content as string | undefined;
            const plainContent = content
                ?.replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            const labels = resource.labels as
                | Record<string, unknown>
                | undefined;

            return JSON.stringify({
                found: true,
                article: {
                    id: String(resource._id),
                    title: resource.title,
                    content: plainContent,
                    summary: resource.summary,
                    url: `/resources/${String(resource._id)}`,
                    domain: labels?.domain,
                    cefr: labels?.cefr,
                    topics: labels?.topic || [],
                    hasAttachment: !!resource.attachmentUrl,
                },
            });
        } catch (error) {
            console.error('[KnowledgeBase] Get article error:', error);
            return JSON.stringify({
                found: false,
                message: 'Error retrieving article',
            });
        }
    },
    {
        name: 'get_knowledge_article',
        description:
            'Get the full content of a specific knowledge base article by its ID. Use this when you need more detailed information from a source found in search results.',
        schema: z.object({
            resourceId: z
                .string()
                .describe('The resource ID of the article to retrieve'),
        }),
    }
);

export const knowledgeBaseTools = [
    searchKnowledgeBaseTool,
    getKnowledgeArticleTool,
];
