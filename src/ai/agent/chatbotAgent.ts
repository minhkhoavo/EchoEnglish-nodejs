// FlashcardAgent.ts — tối giản, an toàn cho langchain@0.3.34
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { ToolInterface } from '@langchain/core/tools';
import { RunnableConfig } from '@langchain/core/runnables';

import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { flashcardTools } from '~/ai/tools/flashcardTools.js';
import { categoryTools } from '~/ai/tools/categoryTools.js';
import { paymentTools } from '~/ai/tools/paymentTools.js';
import { retrieveMyFilesTool } from '~/ai/tools/ragRetrieveTool.js';

export class ChatbotAgent {
    private executor?: AgentExecutor;
    private client = new GoogleGenAIClient();
    private tools: ToolInterface[] = [
        ...(flashcardTools as unknown as ToolInterface[]),
        ...(categoryTools as unknown as ToolInterface[]),
        ...(paymentTools as unknown as ToolInterface[]),
        retrieveMyFilesTool as unknown as ToolInterface,
    ];

    private async init(): Promise<void> {
        if (this.executor) return;

        const llm = this.client.getModel();

        const prompt = ChatPromptTemplate.fromMessages([
            [
                'system',
                `You are an assistant for managing flashcards, payments, user files content.
            Rules (MUST FOLLOW):
            - Never claim an action is done unless a tool call returned a concrete result (e.g., ids).
            - For multi-step tasks, call tools step by step until all steps are completed.
            - Always use the categoryId returned by tools; do not guess.
            - If a step fails, call the appropriate tool again or report the error, do NOT make up results.
            - Only use the RAG tool ("retrieve_my_files") when:
                (a) the user asks about their uploaded files/docs,
                (b) they request citations/sources,
                (c) factual precision is required and you are uncertain,
                (d) the query explicitly references file names/topics known to be in their uploads.
            - If the user asks a general conceptual question, try to answer without RAG.
            - When you do use RAG, summarize concisely and include a compact citations list derived from tool output.`,
            ],
            ['placeholder', '{chat_history}'],
            ['human', '{input}'],
            ['placeholder', '{agent_scratchpad}'],
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
            verbose: true,
        });
    }

    public async run(input: string, userId: string): Promise<string> {
        if (!this.executor) await this.init();
        const result = await this.executor!.invoke({ input }, {
            configurable: { userId },
        } as RunnableConfig);
        const output = (result as Record<string, unknown>)?.output ?? result;
        return typeof output === 'string' ? output : JSON.stringify(output);
    }
}

export const flashcardAgent = new ChatbotAgent();
