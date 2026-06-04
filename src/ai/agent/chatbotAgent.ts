// ChatbotAgent.ts
import { createAgent } from 'langchain';
import { MemorySaver } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { flashcardTools } from '~/ai/tools/flashcardTools.js';
import { categoryTools } from '~/ai/tools/categoryTools.js';
import { paymentTools } from '~/ai/tools/paymentTools.js';
import { learningResourceTools } from '~/ai/tools/learningResourceTools.js';
import { knowledgeBaseTools } from '~/ai/tools/knowledgeBaseTools.js';
import { learnerProgressTools } from '~/ai/tools/learnerProgressTools.js';
import { navigationTools } from '~/ai/tools/navigationTools.js';
// import { retrieveMyFilesTool } from '~/ai/tools/ragRetrieveTool.js'; // Temporarily disabled
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import { z } from 'zod';

// Citation schema for knowledge base references
const CitationSchema = z.object({
    id: z.number().describe('Citation number [1], [2], etc.'),
    resourceId: z.string().describe('Resource ID in database'),
    title: z.string().describe('Article/resource title'),
    url: z.string().describe('Frontend URL to the resource'),
});

export const ChatbotResponseSchema = z
    .object({
        intent: z
            .string()
            .regex(/^[A-Z0-9_]+$/, 'intent phải là UPPER_SNAKE_CASE'),
        layout: z.enum(['notice', 'list', 'detail', 'result', 'html_embed']),
        message: z.string().min(1).max(2000),

        actions: z.array(z.record(z.unknown())).max(3).optional(),
        payload: z.record(z.unknown()).optional(),
        citations: z
            .array(CitationSchema)
            .optional()
            .describe(
                'Sources referenced in the message using [1], [2] markers'
            ),
    })
    .strict();

// Tools share a single flat list. The agent forwards the invocation
// `configurable` (incl. userId) down to each tool's RunnableConfig.
const agentTools = [
    ...flashcardTools,
    ...categoryTools,
    ...paymentTools,
    ...learningResourceTools,
    ...knowledgeBaseTools,
    ...learnerProgressTools,
    ...navigationTools,
    // retrieveMyFilesTool, // Temporarily disabled
];

export class ChatbotAgent {
    private agent?: ReturnType<typeof createAgent>;
    private client = new GoogleGenAIClient({
        // Chatbot agent requires Gemini models for function calling support
        model:
            process.env.GEMINI_CHATBOT_CONSERVATION_MODEL ??
            'gemini-2.5-flash-lite',
    });
    private systemPrompt?: string;

    // LangGraph checkpointer persists conversation per thread_id (= userId).
    // Swap for a Redis/Postgres saver to share history across instances.
    private checkpointer = new MemorySaver();

    private async init(): Promise<void> {
        if (this.agent) return;
        this.systemPrompt =
            await promptManagerService.getSystemPrompt('ai-agent');
        const model = this.client.getModel();

        this.agent = createAgent({
            model,
            tools: agentTools,
            systemPrompt: this.systemPrompt || '',
            checkpointer: this.checkpointer,
        });
    }

    public async run(
        input: string,
        userId: string,
        image?: string
    ): Promise<Record<string, unknown>> {
        if (!this.agent) await this.init();

        // Create human message - multimodal if image provided, text-only otherwise
        let humanMessage: HumanMessage;
        if (image) {
            humanMessage = new HumanMessage({
                content: [
                    {
                        type: 'text',
                        text: input,
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: image,
                        },
                    },
                ],
            });
        } else {
            humanMessage = new HumanMessage({
                content: input,
            });
        }

        // thread_id scopes the checkpointed history; userId is forwarded to
        // tools via their RunnableConfig (config.configurable.userId).
        const result = (await this.agent!.invoke(
            {
                messages: [humanMessage],
            },
            {
                configurable: {
                    thread_id: userId,
                    userId,
                    sessionId: userId,
                },
            }
        )) as { messages?: Array<{ content?: unknown }> };

        const messages = result.messages ?? [];
        const last = messages[messages.length - 1];
        const text = this.extractText(last?.content);

        return this.parseAgentResponse(text);
    }

    // The final AI message content may be a plain string or an array of
    // content blocks (LangChain v1 standard content). Flatten to text.
    private extractText(content: unknown): string {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .map((part) => {
                    if (typeof part === 'string') return part;
                    if (part && typeof part === 'object' && 'text' in part) {
                        return String((part as { text: unknown }).text ?? '');
                    }
                    return '';
                })
                .join('');
        }
        return content == null ? '' : String(content);
    }

    private parseAgentResponse(text: string): Record<string, unknown> {
        const clean = text
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
        try {
            const parsed = JSON.parse(clean);
            const validResponse = ChatbotResponseSchema.safeParse(parsed);
            if (validResponse.success) {
                return validResponse.data;
            }
        } catch (error) {
            console.error('Failed to parse agent response:', error);
        }

        return {
            intent: 'ERROR',
            layout: 'notice',
            message: 'Model cannot response this question right now.',
            payload: {
                status: 'error',
                title: 'Error',
                subtitle: 'We are unable to process your request at this time.',
            },
        };
    }
}

export const flashcardAgent = new ChatbotAgent();
