// src/services/PromptManagerService.ts (Phiên bản mới)
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class PromptManagerService {
    private promptCache = new Map<string, string>();

    public async getTemplate(templateName: string): Promise<string> {
        if (this.promptCache.has(templateName)) {
            return this.promptCache.get(templateName)!;
        }

        const promptPath = path.join(
            __dirname,
            '../prompts/templates/speaking',
            `${templateName}.txt`
        );
        try {
            const template = await fs.readFile(promptPath, 'utf-8');
            this.promptCache.set(templateName, template);
            return template;
        } catch (error) {
            console.error(
                `Error reading prompt template: ${templateName}`,
                error
            );
            throw new Error(`Prompt template ${templateName} not found.`);
        }
    }
}

export const promptManagerService = new PromptManagerService();
