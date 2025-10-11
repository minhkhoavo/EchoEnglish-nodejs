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

        // Try speaking templates first
        let promptPath = path.join(
            __dirname,
            '../prompts/templates/speaking',
            `${templateName}.txt`
        );

        try {
            const template = await fs.readFile(promptPath, 'utf-8');
            this.promptCache.set(templateName, template);
            return template;
        } catch {
            // Try writing templates
            promptPath = path.join(
                __dirname,
                '../prompts/templates/writing',
                `${templateName}.txt`
            );

            try {
                const template = await fs.readFile(promptPath, 'utf-8');
                this.promptCache.set(templateName, template);
                return template;
            } catch (error2) {
                console.error(
                    `Error reading prompt template: ${templateName}`,
                    error2
                );
                throw new Error(`Prompt template ${templateName} not found.`);
            }
        }
    }

    /**
     * Load template from any subdirectory with variable substitution
     */
    public async loadTemplate(
        templatePath: string,
        variables?: Record<string, string>
    ): Promise<string> {
        const cacheKey = `${templatePath}`;

        if (this.promptCache.has(cacheKey) && !variables) {
            return this.promptCache.get(cacheKey)!;
        }

        const fullPath = path.join(
            __dirname,
            '../prompts/templates',
            `${templatePath}.txt`
        );

        try {
            let template = await fs.readFile(fullPath, 'utf-8');

            // Replace variables if provided
            if (variables) {
                Object.entries(variables).forEach(([key, value]) => {
                    const regex = new RegExp(`{{${key}}}`, 'g');
                    template = template.replace(regex, value);
                });
            }

            if (!variables) {
                this.promptCache.set(cacheKey, template);
            }

            return template;
        } catch (error) {
            console.error(`Error reading template: ${templatePath}`, error);
            throw new Error(`Template ${templatePath} not found.`);
        }
    }

    public async getSystemPrompt(promptName: string): Promise<string> {
        const promptPath = path.join(
            __dirname,
            '../prompts/systems',
            `${promptName}.txt`
        );
        try {
            const prompt = await fs.readFile(promptPath, 'utf-8');
            return prompt;
        } catch (error) {
            console.error(`Error reading system prompt: ${promptName}`, error);
            throw new Error(`System prompt ${promptName} not found.`);
        }
    }
}

export const promptManagerService = new PromptManagerService();
