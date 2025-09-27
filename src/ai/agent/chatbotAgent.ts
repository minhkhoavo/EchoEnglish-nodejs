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
import { SystemMessage } from 'node_modules/@langchain/core/dist/messages/index.js';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';

export class ChatbotAgent {
    private executor?: AgentExecutor;
    private client = new GoogleGenAIClient({
        model: 'models/gemini-flash-lite-latest',
    });
    private systemPrompt?: string;

    private tools: ToolInterface[] = [
        ...(flashcardTools as unknown as ToolInterface[]),
        ...(categoryTools as unknown as ToolInterface[]),
        ...(paymentTools as unknown as ToolInterface[]),
        retrieveMyFilesTool as unknown as ToolInterface,
    ];

    private async init(): Promise<void> {
        if (this.executor) return;
        this.systemPrompt =
            await promptManagerService.getSystemPrompt('ai-agent');
        const llm = this.client.getModel();

        const prompt = ChatPromptTemplate.fromMessages([
            new SystemMessage(this.systemPrompt || ''),
            //   new MessagesPlaceholder('chat_history'),
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
            //   verbose: true,
            returnIntermediateSteps: true,
        });
    }

    public async run(
        input: string,
        userId: string
    ): Promise<Record<string, unknown>> {
        if (!this.executor) await this.init();

        type ExecutorResult = { output?: unknown } & Record<string, unknown>;
        const result: ExecutorResult = await this.executor!.invoke({ input }, {
            configurable: { userId },
        } as RunnableConfig);

        const raw = result.output ?? '';
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw);

        const clean = text
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();

        try {
            return JSON.parse(clean);
        } catch {
            return {
                intent: 'ERROR',
                layout: 'notice',
                message: 'Failed to produce valid JSON.',
                payload: { status: 'error', original: clean.slice(0, 400) },
            };
        }
    }
}

export const flashcardAgent = new ChatbotAgent();
