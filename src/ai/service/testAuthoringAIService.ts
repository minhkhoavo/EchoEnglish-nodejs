import { GoogleGenAIClient } from '../provider/googleGenAIClient.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';

/**
 * Thin AI runner for the admin test-authoring assistant.
 *
 * The prompts themselves live on the frontend (one prompt builder per action),
 * so this backend only needs a single generic endpoint: it forwards a prompt to
 * Gemini and returns the parsed JSON. This keeps the surface to one route.
 */
class TestAuthoringAIService {}

export const testAuthoringAIService = new TestAuthoringAIService();
export { TestAuthoringAIService };
