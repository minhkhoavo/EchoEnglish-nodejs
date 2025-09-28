// FlashcardAgent.ts
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import {
    ChatPromptTemplate,
    MessagesPlaceholder,
} from '@langchain/core/prompts';
import type { ToolInterface } from '@langchain/core/tools';
import { RunnableConfig } from '@langchain/core/runnables';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { flashcardTools } from '~/ai/tools/flashcardTools.js';
import { categoryTools } from '~/ai/tools/categoryTools.js';
import { paymentTools } from '~/ai/tools/paymentTools.js';
import { retrieveMyFilesTool } from '~/ai/tools/ragRetrieveTool.js';
import { SystemMessage } from '@langchain/core/messages';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';

import { RunnableWithMessageHistory } from '@langchain/core/runnables';
import {
    InMemoryChatMessageHistory,
    BaseChatMessageHistory,
} from '@langchain/core/chat_history';
import { z } from 'zod';

export const ChatbotResponseSchema = z
    .object({
        intent: z
            .string()
            .regex(/^[A-Z0-9_]+$/, 'intent phải là UPPER_SNAKE_CASE'),
        layout: z.enum(['notice', 'list', 'detail', 'result', 'html_embed']),
        message: z.string().min(1).max(300),

        actions: z.array(z.record(z.unknown())).max(3).optional(),
        payload: z.record(z.unknown()).optional(),
    })
    .strict();

export class ChatbotAgent {
    private executor?: AgentExecutor;
    private withHistory?: RunnableWithMessageHistory<
        Record<string, unknown>,
        Record<string, unknown>
    >;
    private client = new GoogleGenAIClient({
        model: 'models/gemini-flash-lite-latest',
    });
    private systemPrompt?: string;

    private histories = new Map<string, BaseChatMessageHistory>(); // sessionId -> history

    private tools: ToolInterface[] = [
        ...(flashcardTools as unknown as ToolInterface[]),
        ...(categoryTools as unknown as ToolInterface[]),
        ...(paymentTools as unknown as ToolInterface[]),
        retrieveMyFilesTool as unknown as ToolInterface,
    ];

    private getHistory(sessionId: string): BaseChatMessageHistory {
        const h = this.histories.get(sessionId);
        if (h) return h;
        const created = new InMemoryChatMessageHistory(); // Bạn có thể thay bằng Redis/Mongo (xem bên dưới)
        this.histories.set(sessionId, created);
        return created;
    }

    private async init(): Promise<void> {
        if (this.executor && this.withHistory) return;
        this.systemPrompt =
            await promptManagerService.getSystemPrompt('ai-agent');
        const llm = this.client.getModel();

        const prompt = ChatPromptTemplate.fromMessages([
            new SystemMessage(this.systemPrompt || ''),
            new MessagesPlaceholder('chat_history'),
            ['human', '{input}'],
            new MessagesPlaceholder('agent_scratchpad'),
        ]);

        const agent = createToolCallingAgent({
            llm,
            tools: this.tools,
            prompt,
        });

        this.executor = new AgentExecutor({
            agent,
            tools: this.tools,
            maxIterations: 8,
            returnIntermediateSteps: true,
            // verbose: true,
        });

        this.withHistory = new RunnableWithMessageHistory({
            runnable: this.executor,
            getMessageHistory: async (config) => {
                const sessionId = (
                    config?.configurable as Record<string, unknown>
                )?.sessionId as string;
                return this.getHistory(sessionId);
            },
            inputMessagesKey: 'input',
            historyMessagesKey: 'chat_history',
            outputMessagesKey: 'output',
        });
    }

    public async run(
        input: string,
        userId: string
    ): Promise<Record<string, unknown>> {
        if (!this.executor || !this.withHistory) await this.init();

        type ExecutorResult = { output?: unknown } & Record<string, unknown>;

        const result: ExecutorResult = await this.withHistory!.invoke(
            {
                input,
            },
            {
                configurable: {
                    userId,
                    sessionId: userId,
                },
            } as RunnableConfig
        );

        const raw = result.output ?? '';
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw);

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
