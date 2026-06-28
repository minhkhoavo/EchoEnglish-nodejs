/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import {
    ChatbotAgent,
    ChatbotResponseSchema,
} from '~/ai/agent/chatbotAgent.js';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { RunnableWithMessageHistory } from '@langchain/core/runnables';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';

// Setup Mocks
let mockInvoke = jest.fn();
let mockGetMessageHistory: any;

jest.mock('@langchain/core/runnables', () => {
    const actual = jest.requireActual('@langchain/core/runnables');
    return {
        ...actual,
        RunnableWithMessageHistory: jest.fn().mockImplementation(function (
            this: any,
            args: any
        ) {
            mockGetMessageHistory = args.getMessageHistory;
            this.invoke = mockInvoke;
            return this;
        }),
    };
});

jest.mock('langchain/agents', () => ({
    createToolCallingAgent: jest.fn().mockReturnValue({}),
    AgentExecutor: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('~/ai/tools/flashcardTools.js', () => ({ flashcardTools: [] }));
jest.mock('~/ai/tools/categoryTools.js', () => ({ categoryTools: [] }));
jest.mock('~/ai/tools/paymentTools.js', () => ({ paymentTools: [] }));
jest.mock('~/ai/tools/learningResourceTools.js', () => ({
    learningResourceTools: [],
}));
jest.mock('~/ai/tools/knowledgeBaseTools.js', () => ({
    knowledgeBaseTools: [],
}));
jest.mock('~/ai/tools/learnerProgressTools.js', () => ({
    learnerProgressTools: [],
}));
jest.mock('~/ai/tools/navigationTools.js', () => ({ navigationTools: [] }));

jest.mock('~/ai/provider/googleGenAIClient.js');

describe('ChatbotAgent', () => {
    let agent: ChatbotAgent;
    let getSystemPromptSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        mockInvoke.mockReset();
        mockGetMessageHistory = null;

        getSystemPromptSpy = jest
            .spyOn(promptManagerService, 'getSystemPrompt')
            .mockResolvedValue('System prompt content');

        // Mock getModel on GoogleGenAIClient instance
        const mockGetModel = jest.fn().mockReturnValue({
            bindTools: jest.fn(),
            withConfig: jest.fn(),
        });
        (GoogleGenAIClient as jest.Mock).mockImplementation(() => ({
            getModel: mockGetModel,
        }));

        agent = new ChatbotAgent();
    });

    afterEach(() => {
        getSystemPromptSpy.mockRestore();
    });

    describe('run() - Agent Execution', () => {
        const userId = 'user-123';
        const validResponse = {
            intent: 'EXPLAIN',
            layout: 'notice',
            message: 'This is a test message',
        };

        it('should initialize and execute run with text only input', async () => {
            mockInvoke.mockResolvedValue({
                output: JSON.stringify(validResponse),
            });

            const result = await agent.run('Hello', userId);

            expect(getSystemPromptSpy).toHaveBeenCalledWith('ai-agent');
            expect(mockInvoke).toHaveBeenCalledTimes(1);
            expect(result).toMatchObject(validResponse);

            // Verify getMessageHistory functionality
            expect(mockGetMessageHistory).toBeDefined();
            const history = await mockGetMessageHistory({
                configurable: { sessionId: userId },
            });
            expect(history).toBeDefined();

            // Verify the same history is returned on subsequent calls
            const history2 = await mockGetMessageHistory({
                configurable: { sessionId: userId },
            });
            expect(history2).toBe(history);

            // Verify getMessageHistory safely handles empty config
            const historyEmpty = await mockGetMessageHistory();
            expect(historyEmpty).toBeDefined();
        });

        it('should execute run with image input', async () => {
            mockInvoke.mockResolvedValue({
                output: JSON.stringify(validResponse),
            });

            const result = await agent.run(
                'Explain image',
                userId,
                'http://image.url'
            );

            expect(mockInvoke).toHaveBeenCalledTimes(1);
            expect(result).toMatchObject(validResponse);
        });

        it('should skip initialization on subsequent runs', async () => {
            mockInvoke.mockResolvedValue({
                output: JSON.stringify(validResponse),
            });

            await agent.run('First call', userId);
            expect(getSystemPromptSpy).toHaveBeenCalledTimes(1);

            await agent.run('Second call', userId);
            // getSystemPromptSpy should not be called again
            expect(getSystemPromptSpy).toHaveBeenCalledTimes(1);
            expect(mockInvoke).toHaveBeenCalledTimes(2);
        });

        it('should handle undefined system prompt safely', async () => {
            getSystemPromptSpy.mockResolvedValue(undefined);
            mockInvoke.mockResolvedValue({
                output: JSON.stringify(validResponse),
            });

            await agent.run('Test', userId);

            expect(mockInvoke).toHaveBeenCalledTimes(1);
        });

        it('should re-initialize if withHistory is missing but executor exists', async () => {
            (agent as any).executor = {};
            (agent as any).withHistory = undefined;
            mockInvoke.mockResolvedValue({
                output: JSON.stringify(validResponse),
            });

            await agent.run('Test', userId);

            expect(getSystemPromptSpy).toHaveBeenCalledTimes(1);
        });

        it('should re-initialize if executor is missing but withHistory exists', async () => {
            (agent as any).executor = undefined;
            (agent as any).withHistory = {};
            mockInvoke.mockResolvedValue({
                output: JSON.stringify(validResponse),
            });

            await agent.run('Test', userId);

            expect(getSystemPromptSpy).toHaveBeenCalledTimes(1);
        });

        it('should return immediately if init is called but both executor and withHistory exist', async () => {
            (agent as any).executor = {};
            (agent as any).withHistory = {};

            await (agent as any).init();

            expect(getSystemPromptSpy).not.toHaveBeenCalled();
        });

        it('should initialize with specific gemini model if provided in env variables', async () => {
            const originalEnv = process.env.GEMINI_CHATBOT_CONSERVATION_MODEL;
            process.env.GEMINI_CHATBOT_CONSERVATION_MODEL = 'gemini-1.5-pro';

            const localAgent = new ChatbotAgent();
            mockInvoke.mockResolvedValue({
                output: JSON.stringify(validResponse),
            });
            await localAgent.run('Test', userId);

            process.env.GEMINI_CHATBOT_CONSERVATION_MODEL = originalEnv;
        });
    });

    describe('parseAgentResponse - Error Handling & Fallbacks', () => {
        const userId = 'user-123';

        it('should fallback when output is not string but object', async () => {
            const validObj = {
                intent: 'TEST',
                layout: 'notice',
                message: 'Hello obj',
            };
            mockInvoke.mockResolvedValue({
                output: validObj,
            });

            const result = await agent.run('Test', userId);
            expect(result).toMatchObject(validObj);
        });

        it('should clean markdown formatting from response', async () => {
            const markdownResponse = `\`\`\`json\n{"intent": "MD", "layout": "notice", "message": "hello"}\n\`\`\``;
            mockInvoke.mockResolvedValue({ output: markdownResponse });

            const result = await agent.run('Test', userId);
            expect(result.intent).toBe('MD');
            expect(result.message).toBe('hello');
        });

        it('should fallback when JSON is invalid (parse error)', async () => {
            mockInvoke.mockResolvedValue({ output: '{ bad json' });

            const consoleSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            const result = await agent.run('Test', userId);

            expect(consoleSpy).toHaveBeenCalled();
            expect(result.intent).toBe('ERROR');
            expect(result.message).toBe(
                'Model cannot response this question right now.'
            );

            consoleSpy.mockRestore();
        });

        it('should fallback when response schema validation fails', async () => {
            const invalidSchemaObj = {
                intent: 'lower_case_invalid', // Should be UPPER_SNAKE_CASE
                layout: 'invalid_layout',
                message: 'hi',
            };
            mockInvoke.mockResolvedValue({
                output: JSON.stringify(invalidSchemaObj),
            });

            const result = await agent.run('Test', userId);

            expect(result.intent).toBe('ERROR');
            expect((result.payload as any)?.status).toBe('error');
        });

        it('should handle undefined output safely', async () => {
            mockInvoke.mockResolvedValue({}); // no output field

            const consoleSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            const result = await agent.run('Test', userId);

            expect(consoleSpy).toHaveBeenCalled();
            expect(result.intent).toBe('ERROR');

            consoleSpy.mockRestore();
        });
    });
});
