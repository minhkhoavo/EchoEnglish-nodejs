/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { conversationPracticeService } from '~/ai/service/conversationPracticeService.js';
import fs from 'fs';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';

// Setup basic mocks for top-level code execution
const mockData = {
    categories: [
        {
            id: 'cat1',
            name: 'Cat 1',
            description: 'Desc 1',
            icon: 'icon1',
            topicIds: ['topic1', 'topic-missing'],
        },
    ],
    topics: [
        {
            id: 'topic1',
            title: 'Topic 1',
            description: 'Desc 1',
            difficulty: 'beginner',
            estimatedMinutes: 10,
            tasks: [
                { id: 'task1', description: 't1', examplePhrases: ['ex1'] },
            ],
        },
        {
            id: 'daily_routine',
            title: 'Daily Routine',
            description: 'Desc',
            difficulty: 'beginner',
            estimatedMinutes: 10,
            tasks: [],
        },
    ],
};

jest.mock('fs', () => ({
    __esModule: true,
    default: {
        readFileSync: jest.fn().mockReturnValue(
            JSON.stringify({
                categories: [
                    {
                        id: 'cat1',
                        name: 'Cat 1',
                        description: 'Desc 1',
                        icon: 'icon1',
                        topicIds: ['topic1', 'topic-missing'],
                    },
                ],
                topics: [
                    {
                        id: 'topic1',
                        title: 'Topic 1',
                        description: 'Desc 1',
                        difficulty: 'beginner',
                        estimatedMinutes: 10,
                        tasks: [
                            {
                                id: 'task1',
                                description: 't1',
                                examplePhrases: ['ex1'],
                            },
                        ],
                    },
                    {
                        id: 'daily_routine',
                        title: 'Daily Routine',
                        description: 'Desc',
                        difficulty: 'beginner',
                        estimatedMinutes: 10,
                        tasks: [],
                    },
                ],
            })
        ),
    },
    readFileSync: jest.fn().mockReturnValue(
        JSON.stringify({
            categories: [
                {
                    id: 'cat1',
                    name: 'Cat 1',
                    description: 'Desc 1',
                    icon: 'icon1',
                    topicIds: ['topic1', 'topic-missing'],
                },
            ],
            topics: [
                {
                    id: 'topic1',
                    title: 'Topic 1',
                    description: 'Desc 1',
                    difficulty: 'beginner',
                    estimatedMinutes: 10,
                    tasks: [
                        {
                            id: 'task1',
                            description: 't1',
                            examplePhrases: ['ex1'],
                        },
                    ],
                },
                {
                    id: 'daily_routine',
                    title: 'Daily Routine',
                    description: 'Desc',
                    difficulty: 'beginner',
                    estimatedMinutes: 10,
                    tasks: [],
                },
            ],
        })
    ),
}));

jest.mock('~/ai/provider/googleGenAIClient.js');
jest.mock('@langchain/core/prompts');

const mockedChatPromptTemplate = ChatPromptTemplate as jest.Mocked<
    typeof ChatPromptTemplate
>;

describe('ConversationPracticeService', () => {
    let consoleErrorSpy: jest.SpyInstance;
    let mockInvoke: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        mockInvoke = jest.fn();
        mockedChatPromptTemplate.fromMessages.mockReturnValue({
            pipe: jest.fn().mockReturnValue({
                pipe: jest.fn().mockReturnValue({
                    invoke: mockInvoke,
                }),
            }),
        } as any);

        // Reset fs.readFileSync to return mockData by default
        (fs.readFileSync as jest.Mock).mockReturnValue(
            JSON.stringify(mockData)
        );
    });

    afterEach(() => {
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
    });

    describe('Data Loading', () => {
        it('getAllTopics should return topics', () => {
            const topics = conversationPracticeService.getAllTopics();
            expect(topics.length).toBe(2);
            expect(topics[0].id).toBe('topic1');
        });

        it('getAllCategories should return categories', () => {
            const categories = conversationPracticeService.getAllCategories();
            expect(categories.length).toBe(1);
            expect(categories[0].id).toBe('cat1');
        });

        it('getCategoriesWithTopics should map topics properly and filter undefined', () => {
            const catsWithTopics =
                conversationPracticeService.getCategoriesWithTopics();
            expect(catsWithTopics[0].topics.length).toBe(1); // 'topic-missing' should be filtered out
            expect(catsWithTopics[0].topics[0].id).toBe('topic1');
        });

        it('getTopicById should return correct topic', () => {
            const topic = conversationPracticeService.getTopicById('topic1');
            expect(topic?.id).toBe('topic1');
        });

        it('should handle fs.readFileSync error gracefully and set empty arrays', () => {
            (fs.readFileSync as jest.Mock).mockImplementation(() => {
                throw new Error('File read error');
            });

            const topics = conversationPracticeService.getAllTopics();
            expect(topics.length).toBe(0);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[ConversationPracticeService] Failed to load topics:',
                expect.any(Error)
            );

            const categories = conversationPracticeService.getAllCategories();
            expect(categories.length).toBe(0);
        });
    });

    describe('startConversation', () => {
        it('should start with userPrompt and topicId (custom AI generation success)', async () => {
            mockInvoke.mockResolvedValueOnce(
                '```json\n{"tasks": [{"id": "c1", "description": "d", "examplePhrases": []}], "starterMessage": "Hello custom"}\n```'
            );

            const req = {
                topicId: 'topic1',
                userPrompt: 'I want to focus on grammar',
            };
            const result =
                await conversationPracticeService.startConversation(req);

            expect(result.starterMessage).toBe('Hello custom');
            expect(result.checklist.length).toBe(1);
            expect(result.checklist[0].taskId).toBe('c1');
            expect(result.topic.tasks.length).toBe(1);
            expect(result.topic.tasks[0].id).toBe('c1');
            expect(result.totalTasksCount).toBe(1);
        });

        it('should start with userPrompt and NO topicId (creates generic topic)', async () => {
            mockInvoke.mockResolvedValueOnce(
                '{"tasks": [{"id": "c1", "description": "d", "examplePhrases": []}]}'
            ); // Missing starterMessage in JSON

            const req = { userPrompt: 'General practice' };
            const result =
                await conversationPracticeService.startConversation(req);

            expect(result.topic.id).toBe('custom_topic');
            expect(result.checklist.length).toBe(1);
            // Should fallback to default starter message for custom_topic since it wasn't in JSON
            expect(result.starterMessage).toContain(
                'Let\'s practice talking about "Custom Conversation Practice"'
            );
        });

        it('should fallback to default tasks if AI returns no JSON during custom generation', async () => {
            mockInvoke.mockResolvedValueOnce(
                'I am an AI and I forgot to output JSON'
            );

            const req = {
                topicId: 'topic1',
                userPrompt: 'I want to focus on grammar',
            };
            const result =
                await conversationPracticeService.startConversation(req);

            expect(result.checklist.length).toBe(1);
            expect(result.checklist[0].taskId).toBe('task1');
        });

        it('should fallback to default tasks if AI returns invalid JSON that throws on parse', async () => {
            mockInvoke.mockResolvedValueOnce(
                '{ "tasks": "invalid json missing bracket }'
            );

            const req = {
                topicId: 'topic1',
                userPrompt: 'I want to focus on grammar',
            };
            const result =
                await conversationPracticeService.startConversation(req);

            expect(result.checklist.length).toBe(1);
            expect(result.checklist[0].taskId).toBe('task1');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[ConversationPracticeService] Failed to generate custom tasks:',
                expect.any(Error)
            );
        });

        it('should handle AI JSON missing the tasks array gracefully', async () => {
            mockInvoke.mockResolvedValueOnce(
                '{"starterMessage": "I have no tasks"}'
            ); // tasks is undefined

            const req = {
                topicId: 'topic1',
                userPrompt: 'I want to focus on grammar',
            };
            const result =
                await conversationPracticeService.startConversation(req);

            expect(result.topic.tasks).toEqual([]); // fallback to [] in code
            expect(result.checklist).toEqual([]); // tasks.map is empty
            expect(result.starterMessage).toBe('I have no tasks');
        });

        it('should fallback to default tasks if AI throws error during custom generation', async () => {
            mockInvoke.mockRejectedValueOnce(new Error('AI generation failed'));

            const req = {
                topicId: 'topic1',
                userPrompt: 'I want to focus on grammar',
            };
            const result =
                await conversationPracticeService.startConversation(req);

            expect(result.checklist.length).toBe(1);
            expect(result.checklist[0].taskId).toBe('task1');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[ConversationPracticeService] Failed to generate custom tasks:',
                expect.any(Error)
            );
        });

        it('should throw error if userPrompt provided but topicId is invalid', async () => {
            const req = {
                topicId: 'invalid-topic',
                userPrompt: 'General practice',
            };
            await expect(
                conversationPracticeService.startConversation(req)
            ).rejects.toThrow('Topic not found: invalid-topic');
        });

        it('should start with NO userPrompt and valid topicId (default JSON tasks)', async () => {
            const req = { topicId: 'topic1' };
            const result =
                await conversationPracticeService.startConversation(req);

            expect(result.checklist.length).toBe(1);
            expect(result.checklist[0].taskId).toBe('task1');
        });

        it('should throw error if NO userPrompt and NO topicId provided', async () => {
            const req = {};
            await expect(
                conversationPracticeService.startConversation(req)
            ).rejects.toThrow('Either topicId or userPrompt must be provided');
        });

        it('should throw error if NO userPrompt and invalid topicId provided', async () => {
            const req = { topicId: 'invalid-topic' };
            await expect(
                conversationPracticeService.startConversation(req)
            ).rejects.toThrow('Topic not found: invalid-topic');
        });
    });

    describe('getDefaultStarterMessage', () => {
        it('should return predefined message if topic id matches', () => {
            const result =
                conversationPracticeService.getStarterMessage('daily_routine');
            expect(result).toBe(
                "Hi there! I'm curious about how you spend your day. What does a typical day look like for you?"
            );
        });

        it('should return generic message if topic id not predefined', () => {
            const result =
                conversationPracticeService.getStarterMessage('topic1');
            expect(result).toBe(
                'Let\'s practice talking about "Topic 1". I\'ll start - tell me about yourself!'
            );
        });

        it('should throw error if topic id is invalid', () => {
            expect(() =>
                conversationPracticeService.getStarterMessage('invalid-topic')
            ).toThrow('Topic not found: invalid-topic');
        });
    });

    describe('initializeChecklist', () => {
        it('should return initialized checklist', () => {
            const result =
                conversationPracticeService.initializeChecklist('topic1');
            expect(result.length).toBe(1);
            expect(result[0].taskId).toBe('task1');
            expect(result[0].isCompleted).toBe(false);
        });

        it('should throw error if topic id is invalid', () => {
            expect(() =>
                conversationPracticeService.initializeChecklist('invalid-topic')
            ).toThrow('Topic not found: invalid-topic');
        });
    });

    describe('processConversation', () => {
        const mockRequest = {
            topicId: 'topic1',
            userMessage: 'Hello',
            chatHistory: [{ role: 'user' as const, content: 'Hi' }],
            checklist: [{ taskId: 'task1', isCompleted: false }],
        };

        it('should process conversation successfully and mark all tasks complete', async () => {
            mockInvoke.mockResolvedValueOnce(
                '{"assistantMessage": "Great!", "updatedChecklist": [{"taskId": "task1", "isCompleted": true}]}'
            );

            const result =
                await conversationPracticeService.processConversation(
                    mockRequest
                );

            expect(result.isCompleted).toBe(true);
            expect(result.completedTasksCount).toBe(1);
            expect(result.assistantMessage).toContain('🎉 Congratulations');
            expect(result.checklist[0].isCompleted).toBe(true);
        });

        it('should process conversation successfully but partially complete', async () => {
            mockInvoke.mockResolvedValueOnce(
                '{"assistantMessage": "Keep going", "updatedChecklist": [{"taskId": "task1", "isCompleted": false}]}'
            );

            const result =
                await conversationPracticeService.processConversation(
                    mockRequest
                );

            expect(result.isCompleted).toBe(false);
            expect(result.assistantMessage).toBe('Keep going');
        });

        it('should keep previously completed tasks as completed even if AI returns false', async () => {
            mockInvoke.mockResolvedValueOnce(
                '{"assistantMessage": "Keep going", "updatedChecklist": [{"taskId": "task1", "isCompleted": false}]}'
            );

            const reqCompleted = {
                ...mockRequest,
                checklist: [{ taskId: 'task1', isCompleted: true }],
            };
            const result =
                await conversationPracticeService.processConversation(
                    reqCompleted
                );

            expect(result.checklist[0].isCompleted).toBe(true);
        });

        it('should use fallback if AI returns no JSON', async () => {
            mockInvoke.mockResolvedValueOnce('Just plain text without json');

            const result =
                await conversationPracticeService.processConversation(
                    mockRequest
                );

            expect(result.assistantMessage).toContain(
                "I'm sorry, I had trouble understanding"
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[ConversationPracticeService] Failed to parse AI response:',
                'Just plain text without json'
            );
        });

        it('should use fallback if AI returns invalid JSON', async () => {
            mockInvoke.mockResolvedValueOnce(
                '{"assistantMessage": "Broken JSON'
            );

            const result =
                await conversationPracticeService.processConversation(
                    mockRequest
                );

            expect(result.isCompleted).toBe(false);
            expect(result.assistantMessage).toContain(
                "I'm sorry, I had trouble understanding"
            );
        });

        it('should use fallback with different message if no incomplete tasks exist', async () => {
            mockInvoke.mockResolvedValueOnce('Invalid JSON');

            const reqCompleted = {
                ...mockRequest,
                checklist: [{ taskId: 'task1', isCompleted: true }],
            };
            const result =
                await conversationPracticeService.processConversation(
                    reqCompleted
                );

            expect(result.assistantMessage).toBe(
                "I'm sorry, I had trouble understanding. Could you please repeat that?"
            );
        });

        it('should throw error if AI invocation throws', async () => {
            mockInvoke.mockRejectedValueOnce(new Error('AI crash'));

            await expect(
                conversationPracticeService.processConversation(mockRequest)
            ).rejects.toThrow(
                'Failed to process conversation. Please try again.'
            );

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[ConversationPracticeService] AI processing error:',
                expect.any(Error)
            );
        });

        it('should handle request with invalid topicId by treating tasks as empty (or from checklist)', async () => {
            // When topicId is invalid, topic is undefined, so it uses request.checklist as tasks
            const reqInvalidTopic = {
                ...mockRequest,
                topicId: 'invalid-topic',
            };
            mockInvoke.mockResolvedValueOnce(
                '{"assistantMessage": "Sure!", "updatedChecklist": [{"taskId": "task1", "isCompleted": true}]}'
            );

            const result =
                await conversationPracticeService.processConversation(
                    reqInvalidTopic
                );

            expect(result.checklist.length).toBe(1);
            expect(result.checklist[0].taskId).toBe('task1');
            expect(result.checklist[0].isCompleted).toBe(true);
        });

        it('should handle request with empty chatHistory', async () => {
            const reqEmptyHistory = { ...mockRequest, chatHistory: [] };
            mockInvoke.mockResolvedValueOnce('{"assistantMessage": "Hello!"}'); // No updatedChecklist provided

            const result =
                await conversationPracticeService.processConversation(
                    reqEmptyHistory
                );

            expect(result.assistantMessage).toBe('Hello!');
            expect(result.checklist[0].isCompleted).toBe(false); // Default to false
        });
    });
});
