import { Router } from 'express';
import ConversationPracticeController from '~/controllers/conversationPracticeController.js';

const router = Router();

/**
 * GET /conversation-practice/topics
 * Get all conversation topics grouped by categories
 */
router.get('/topics', ConversationPracticeController.getAllTopics);

/**
 * POST /conversation-practice/start
 * Start a new conversation practice session
 * Body: {
 *   topicId: string,
 *   userPrompt?: string  // Optional: Custom prompt to personalize task generation
 * }
 * Returns: {
 *   topic,
 *   starterMessage,
 *   checklist,
 *   isCompleted,
 *   completedTasksCount,
 *   totalTasksCount,
 *   isCustom: boolean  // true if tasks were AI-generated from userPrompt
 * }
 */
router.post('/start', ConversationPracticeController.startConversation);

/**
 * POST /conversation-practice/message
 * Send a message in the conversation and get AI response
 * Body: {
 *   topicId: string,
 *   userMessage: string,
 *   chatHistory: Array<{ role: 'user' | 'assistant', content: string }>,
 *   checklist: Array<{ taskId: string, isCompleted: boolean }>
 * }
 * Returns: {
 *   assistantMessage: string,
 *   checklist: Array<{ taskId: string, isCompleted: boolean }>,
 *   isCompleted: boolean,
 *   feedback?: string,
 *   completedTasksCount: number,
 *   totalTasksCount: number
 * }
 */
router.post('/message', ConversationPracticeController.sendMessage);

export default router;
