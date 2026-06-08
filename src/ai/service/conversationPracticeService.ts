import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { GoogleGenAIClient } from '../provider/googleGenAIClient.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types
export interface ConversationTask {
    id: string;
    description: string;
    examplePhrases: string[];
}

export interface ConversationTopic {
    id: string;
    title: string;
    description: string;
    difficulty: 'beginner' | 'intermediate' | 'advanced';
    estimatedMinutes: number;
    tasks: ConversationTask[];
}

export interface ConversationCategory {
    id: string;
    name: string;
    description: string;
    icon: string;
    topicIds: string[];
}

export interface ConversationTopicsData {
    categories: ConversationCategory[];
    topics: ConversationTopic[];
}

export interface TaskChecklistItem {
    taskId: string;
    isCompleted: boolean;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface ConversationPracticeRequest {
    topicId?: string; // Optional - not needed if userPrompt is provided
    userPrompt?: string; // Optional custom prompt for personalized task generation
}

export interface ConversationPracticeMessageRequest {
    topicId: string;
    userMessage: string;
    chatHistory: ChatMessage[];
    checklist: TaskChecklistItem[];
}

export interface ConversationStartResponse {
    topic: ConversationTopic;
    starterMessage: string;
    checklist: TaskChecklistItem[];
    isCompleted: boolean;
    completedTasksCount: number;
    totalTasksCount: number;
}

export interface ConversationPracticeResponse {
    assistantMessage: string;
    checklist: TaskChecklistItem[];
    isCompleted: boolean;
    feedback?: string;
    completedTasksCount: number;
    totalTasksCount: number;
}

class ConversationPracticeService {
    private model: ChatGoogleGenerativeAI;
    private topics: ConversationTopic[] = [];
    private categories: ConversationCategory[] = [];

    constructor() {
        // Uses GEMINI_DEFAULT_MODEL from env via GoogleGenAIClient
        const client = new GoogleGenAIClient({
            model:
                process.env.GEMINI_CHATBOT_CONSERVATION_MODEL ??
                'gemini-2.5-flash-lite',
            temperature: 0.7,
        });
        this.model = client.getModel();

        this.loadTopics();
    }

    private loadTopics(): void {
        try {
            const dataPath = path.join(
                __dirname,
                '../../resources/data/conversation_topics.json'
            );
            const data = fs.readFileSync(dataPath, 'utf-8');
            const parsed: ConversationTopicsData = JSON.parse(data);
            this.topics = parsed.topics;
            this.categories = parsed.categories;
        } catch (error) {
            console.error(
                '[ConversationPracticeService] Failed to load topics:',
                error
            );
            this.topics = [];
            this.categories = [];
        }
    }

    public getAllTopics(): ConversationTopic[] {
        this.loadTopics();
        return this.topics;
    }

    public getAllCategories(): ConversationCategory[] {
        this.loadTopics();
        return this.categories;
    }

    public getCategoriesWithTopics(): (ConversationCategory & {
        topics: ConversationTopic[];
    })[] {
        this.loadTopics();
        return this.categories.map((category) => ({
            ...category,
            topics: category.topicIds
                .map((topicId) => this.topics.find((t) => t.id === topicId))
                .filter(
                    (topic): topic is ConversationTopic => topic !== undefined
                ),
        }));
    }

    public getTopicById(topicId: string): ConversationTopic | undefined {
        this.loadTopics();
        return this.topics.find((t) => t.id === topicId);
    }

    /**
     * Generate custom tasks based on user's personalized prompt
     */
    private async generateCustomTasks(
        topic: ConversationTopic,
        userPrompt: string
    ): Promise<{ tasks: ConversationTask[]; starterMessage: string }> {
        const systemPrompt = `You are an AI that creates personalized English conversation practice tasks.

Based on the topic "${topic.title}" and the user's custom request, generate a set of 3-5 conversation tasks that the user should complete during the practice session.

TOPIC CONTEXT:
- Title: ${topic.title}
- Description: ${topic.description}
- Difficulty: ${topic.difficulty}

USER'S CUSTOM REQUEST: ${userPrompt}

Generate tasks that are:
1. Relevant to both the topic and the user's specific request
2. Clear and achievable through conversation
3. Progressive in complexity (easier tasks first)
4. Focused on practical English speaking skills

OUTPUT FORMAT (JSON only, no markdown):
{{
    "tasks": [
        {{
            "id": "task_1",
            "description": "Clear description of what the user should express",
            "examplePhrases": ["Example phrase 1", "Example phrase 2"]
        }}
    ],
    "starterMessage": "A friendly opening message to start the conversation that relates to the custom request"
}}`;

        const prompt = ChatPromptTemplate.fromMessages([
            ['system', systemPrompt],
            ['human', 'Generate the custom tasks and starter message.'],
        ]);

        const chain = prompt.pipe(this.model).pipe(new StringOutputParser());

        try {
            const result = await chain.invoke({});
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    tasks: parsed.tasks || [],
                    starterMessage:
                        parsed.starterMessage ||
                        this.getDefaultStarterMessage(topic),
                };
            }
        } catch (error) {
            console.error(
                '[ConversationPracticeService] Failed to generate custom tasks:',
                error
            );
        }

        // Fallback to default tasks
        return {
            tasks: topic.tasks,
            starterMessage: this.getDefaultStarterMessage(topic),
        };
    }

    private getDefaultStarterMessage(topic: ConversationTopic): string {
        const starterMessages: Record<string, string> = {
            introduce_yourself:
                "Hello! Nice to meet you! I'd love to get to know you better. Could you start by telling me a bit about yourself?",
            daily_routine:
                "Hi there! I'm curious about how you spend your day. What does a typical day look like for you?",
            hobbies_interests:
                "Hello! It's great to chat with you. So, what do you like to do for fun in your free time?",
            ordering_food:
                "Welcome to our restaurant! I'll be your server today. Are you ready to order, or would you like a few more minutes to look at the menu?",
            asking_directions:
                'Hello! You look a bit lost. Can I help you find somewhere?',
            job_interview:
                "Good morning! Thank you for coming in today. Please, have a seat. Let's start - could you tell me a little about yourself?",
            travel_vacation:
                "Hi! I love traveling and hearing about other people's adventures. Have you been anywhere interesting recently, or do you have any trips planned?",
            making_appointment:
                'Good morning! Thank you for calling. How may I help you today?',
            shopping:
                "Welcome to our store! Is there anything specific you're looking for today, or would you like to browse around?",
            describe_family:
                "Hey! I'd love to learn more about you. Can you tell me about your family?",
            hotel_checkin:
                'Good evening and welcome to our hotel! How may I assist you today?',
            at_the_airport:
                'Hello! Welcome to the check-in counter. May I see your passport and booking confirmation?',
            cafe_conversation:
                'Hi there! Welcome to our café. What can I get for you today?',
            at_the_bank:
                'Good morning! Welcome to the bank. How can I help you today?',
            taking_taxi: 'Hello! Where would you like to go today?',
            business_meeting:
                "Good morning everyone. Thank you all for joining this meeting. Let's get started.",
            phone_call:
                'Hello, this is customer service. How may I help you today?',
            making_friends:
                "Hey! I don't think we've met before. I'm Alex. What's your name?",
            party_conversation:
                "Hey! Great party, right? I don't think I've seen you here before.",
            at_the_doctor:
                'Hello! Please have a seat. What brings you in today?',
            pharmacy_visit: 'Hello! How can I help you today?',
        };

        return (
            starterMessages[topic.id] ||
            `Let's practice talking about "${topic.title}". I'll start - tell me about yourself!`
        );
    }

    /**
     * Start a new conversation session
     * If userPrompt is provided, generates custom tasks using AI (topicId optional in this case)
     * If only topicId is provided, uses default tasks from JSON
     */
    public async startConversation(
        request: ConversationPracticeRequest
    ): Promise<ConversationStartResponse> {
        // Determine topic and starter message strategy
        let topic: ConversationTopic | undefined;
        let tasks: ConversationTask[];
        let starterMessage: string;

        if (request.userPrompt && request.userPrompt.trim().length > 0) {
            // User provided custom prompt - try to use topicId if available, otherwise create generic topic
            if (request.topicId) {
                topic = this.getTopicById(request.topicId);
                if (!topic) {
                    throw new Error(`Topic not found: ${request.topicId}`);
                }
            } else {
                // Create a generic topic for custom prompt
                topic = {
                    id: 'custom_topic',
                    title: 'Custom Conversation Practice',
                    description:
                        'Personalized conversation practice based on your request',
                    difficulty: 'intermediate',
                    estimatedMinutes: 15,
                    tasks: [], // Will be replaced by AI-generated tasks
                } as ConversationTopic;
            }

            // Generate custom tasks using AI
            const customResult = await this.generateCustomTasks(
                topic,
                request.userPrompt
            );
            tasks = customResult.tasks;
            starterMessage = customResult.starterMessage;
        } else {
            // No custom prompt - topicId is required
            if (!request.topicId) {
                throw new Error(
                    'Either topicId or userPrompt must be provided'
                );
            }

            topic = this.getTopicById(request.topicId);
            if (!topic) {
                throw new Error(`Topic not found: ${request.topicId}`);
            }

            // Use default tasks from JSON
            tasks = topic.tasks;
            starterMessage = this.getDefaultStarterMessage(topic);
        }

        const checklist: TaskChecklistItem[] = tasks.map((task) => ({
            taskId: task.id,
            isCompleted: false,
        }));

        return {
            topic: {
                ...topic,
                tasks, // Tasks (either from JSON or AI-generated)
            },
            starterMessage,
            checklist,
            isCompleted: false,
            completedTasksCount: 0,
            totalTasksCount: tasks.length,
        };
    }

    public async processConversation(
        request: ConversationPracticeMessageRequest
    ): Promise<ConversationPracticeResponse> {
        const topic = this.getTopicById(request.topicId);
        // Use tasks from topic
        const tasks =
            topic?.tasks ||
            request.checklist.map((item) => ({
                id: item.taskId,
                description: '',
                examplePhrases: [],
            }));

        // Build task descriptions for the prompt
        const taskDescriptions = tasks
            .map((task, index) => {
                const checklistItem = request.checklist.find(
                    (c: TaskChecklistItem) => c.taskId === task.id
                );
                const status = checklistItem?.isCompleted
                    ? 'COMPLETED'
                    : 'NOT YET';
                return `${index + 1}. [${status}] ${task.id}: ${task.description} (Example phrases: ${task.examplePhrases.join(', ')})`;
            })
            .join('\n');

        // Build chat history string
        const chatHistoryStr = request.chatHistory
            .map(
                (msg: ChatMessage) =>
                    `${msg.role.toUpperCase()}: ${msg.content}`
            )
            .join('\n');

        const systemPrompt = `You are an English conversation practice partner helping users improve their speaking skills through interactive dialogue.

TOPIC: ${topic?.title}
DESCRIPTION: ${topic?.description}

TASKS TO COMPLETE:
${taskDescriptions}

INSTRUCTIONS:
1. You are having a natural conversation with the user about "${topic?.title}".
2. Your role is to engage the user in conversation and help them complete all the tasks naturally.
3. After analyzing the user's latest message and the conversation history, determine which tasks have been completed.
4. Continue the conversation naturally - ask follow-up questions to encourage the user to complete remaining tasks.
5. Be encouraging and supportive. Provide gentle corrections if there are grammar mistakes.
6. Keep responses concise and conversational (2-4 sentences typically).

OUTPUT FORMAT:
You MUST respond in the following JSON format ONLY (no markdown, no extra text):
{{
    "assistantMessage": "Your conversational response here",
    "updatedChecklist": [
        {{"taskId": "task_id_here", "isCompleted": true_or_false}},
        ... for each task
    ],
    "feedback": "Brief feedback on user's English if any corrections or praise needed, or null if not needed"
}}

IMPORTANT RULES:
- Analyze ALL messages in the chat history to determine completed tasks, not just the latest message.
- A task is completed when the user has expressed the required information in ANY of their messages.
- Once a task is marked as completed, it should STAY completed.
- Only return valid JSON. Do not include any other text before or after the JSON.`;

        const humanTemplate = `CHAT HISTORY:
${chatHistoryStr || 'No previous messages'}

USER'S LATEST MESSAGE: ${request.userMessage}

Please respond and update the checklist based on the entire conversation.`;

        const prompt = ChatPromptTemplate.fromMessages([
            ['system', systemPrompt],
            ['human', humanTemplate],
        ]);

        const chain = prompt.pipe(this.model).pipe(new StringOutputParser());

        try {
            const result = await chain.invoke({});

            // Parse the JSON response
            let parsed;
            try {
                // Clean up the response in case there's any extra text
                const jsonMatch = result.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('No JSON found in response');
                }
            } catch {
                console.error(
                    '[ConversationPracticeService] Failed to parse AI response:',
                    result
                );
                // Fallback response
                return this.createFallbackResponse(request, tasks);
            }

            // Build the updated checklist
            const updatedChecklist: TaskChecklistItem[] = tasks.map((task) => {
                const aiUpdate = parsed.updatedChecklist?.find(
                    (c: TaskChecklistItem) => c.taskId === task.id
                );
                const previousStatus = request.checklist.find(
                    (c: TaskChecklistItem) => c.taskId === task.id
                );

                // Keep completed status if previously completed
                const isCompleted =
                    previousStatus?.isCompleted ||
                    aiUpdate?.isCompleted ||
                    false;

                return {
                    taskId: task.id,
                    isCompleted,
                };
            });

            const completedCount = updatedChecklist.filter(
                (c) => c.isCompleted
            ).length;
            const isAllCompleted = completedCount === tasks.length;

            let finalMessage = parsed.assistantMessage;

            // Add completion message if all tasks are done
            if (isAllCompleted) {
                finalMessage +=
                    '\n\n🎉 Congratulations! You have completed all the tasks for this topic! Great job practicing your English!';
            }

            return {
                assistantMessage: finalMessage,
                checklist: updatedChecklist,
                isCompleted: isAllCompleted,
                feedback: parsed.feedback || undefined,
                completedTasksCount: completedCount,
                totalTasksCount: tasks.length,
            };
        } catch (error) {
            console.error(
                '[ConversationPracticeService] AI processing error:',
                error
            );
            throw new Error(
                'Failed to process conversation. Please try again.'
            );
        }
    }

    private createFallbackResponse(
        request: ConversationPracticeMessageRequest,
        tasks: ConversationTask[]
    ): ConversationPracticeResponse {
        // Find incomplete tasks
        const incompleteTasks = tasks.filter((task) => {
            const checkItem = request.checklist.find(
                (c: TaskChecklistItem) => c.taskId === task.id
            );
            return !checkItem?.isCompleted;
        });

        let message = "I'm sorry, I had trouble understanding. ";
        if (incompleteTasks.length > 0) {
            message += `Could you tell me more about ${incompleteTasks[0].description.toLowerCase()}?`;
        } else {
            message += 'Could you please repeat that?';
        }

        const completedCount = request.checklist.filter(
            (c: TaskChecklistItem) => c.isCompleted
        ).length;

        return {
            assistantMessage: message,
            checklist: request.checklist,
            isCompleted: false,
            completedTasksCount: completedCount,
            totalTasksCount: tasks.length,
        };
    }

    public initializeChecklist(topicId: string): TaskChecklistItem[] {
        const topic = this.getTopicById(topicId);
        if (!topic) {
            throw new Error(`Topic not found: ${topicId}`);
        }

        return topic.tasks.map((task) => ({
            taskId: task.id,
            isCompleted: false,
        }));
    }

    public getStarterMessage(topicId: string): string {
        const topic = this.getTopicById(topicId);
        if (!topic) {
            throw new Error(`Topic not found: ${topicId}`);
        }

        return this.getDefaultStarterMessage(topic);
    }
}

export const conversationPracticeService = new ConversationPracticeService();
