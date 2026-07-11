import fs from 'fs';
import path from 'path';
import { googleGenAIClient } from '../ai/provider/googleGenAIClient.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

interface DictionaryInfo {
    sourceText: string;
    destinationText: string;
    pronunciation: {
        sourcePhonetic: string | null;
    };
    definitions: unknown[];
}

class DictionaryService {
    /**
     * Translate a block of text using AI
     * @param sourceText - Text to translate
     * @param destinationLanguage - Target language ('vi' | 'en')
     */
    public async translateTextWithAI(
        sourceText: string,
        destinationLanguage: 'vi' | 'en'
    ): Promise<string> {
        if (!sourceText || sourceText.trim().length === 0) {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }

        if (!['vi', 'en'].includes(destinationLanguage)) {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }

        try {
            const fileName =
                destinationLanguage === 'vi'
                    ? 'translate_to_vi.txt'
                    : 'translate_to_en.txt';
            const promptPath = path.join(
                process.cwd(),
                `src/ai/prompts/templates/dictionary/${fileName}`
            );

            let translatePrompt = fs.readFileSync(promptPath, 'utf-8');
            translatePrompt = translatePrompt.replace(
                /{{sourceText}}/g,
                sourceText
            );

            const model = googleGenAIClient.getModel();
            const result = await model.invoke(translatePrompt);

            let translation =
                typeof result === 'string'
                    ? result
                    : result?.content?.toString() || '';
            translation = translation.trim();

            if (translation.startsWith('"') && translation.endsWith('"')) {
                translation = translation.slice(1, -1);
            }

            if (!translation) {
                throw new Error('Translation result is empty');
            }

            return translation;
        } catch (error) {
            console.error('TranslateTextWithAI failed:', error);
            throw new Error('AI translation service failed. Please try again.');
        }
    }

    /**
     * Get dictionary info for a word using AI and prompt template
     * @param word - English word to lookup
     * @param destinationLanguage - Language to translate to (default: vi)
     */
    public async getDictionaryInfoWithAI(
        word: string,
        destinationLanguage: string = 'vi'
    ): Promise<DictionaryInfo> {
        const cleanWord = word.trim().toLowerCase();

        const defaultResult: DictionaryInfo = {
            sourceText: cleanWord,
            destinationText: '',
            pronunciation: {
                sourcePhonetic: null,
            },
            definitions: [],
        };

        if (!cleanWord) return defaultResult;

        try {
            const promptPath = path.join(
                process.cwd(),
                'src/ai/prompts/templates/dictionary/get_dictionary_info.txt'
            );
            let prompt = fs.readFileSync(promptPath, 'utf-8');
            prompt = prompt
                .replace(/{{word}}/g, cleanWord)
                .replace(/{{destinationLanguage}}/g, destinationLanguage);

            const model = googleGenAIClient.getModel();
            const result = await model.invoke(prompt);

            let jsonString =
                typeof result === 'string'
                    ? result
                    : result?.content?.toString() || '';
            jsonString = jsonString
                .trim()
                .replace(/^```json/i, '')
                .replace(/^```/i, '')
                .replace(/```$/i, '')
                .trim();

            const parsedData = JSON.parse(jsonString);

            let finalPhonetic = parsedData.phonetic || null;
            if (
                finalPhonetic &&
                !finalPhonetic.startsWith('/') &&
                !finalPhonetic.startsWith('[')
            ) {
                finalPhonetic = `/${finalPhonetic}/`;
            }

            let finalDestinationText = parsedData.destinationText || '';
            if (
                typeof finalDestinationText === 'string' &&
                finalDestinationText.startsWith('"') &&
                finalDestinationText.endsWith('"')
            ) {
                finalDestinationText = finalDestinationText.slice(1, -1);
            }

            return {
                sourceText: cleanWord,
                destinationText: finalDestinationText,
                pronunciation: {
                    sourcePhonetic: finalPhonetic,
                },
                definitions: parsedData.definitions || [],
            };
        } catch (aiError) {
            console.error(
                `AI failed to generate dictionary info for "${cleanWord}":`,
                aiError
            );
            return defaultResult;
        }
    }
}

export default new DictionaryService();
