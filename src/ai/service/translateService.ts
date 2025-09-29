import { googleGenAIClient } from '../../ai/provider/googleGenAIClient.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

class TranslateService {
    public async translateWithAI(
        sourceText: string,
        destinationLanguage: 'vi' | 'en'
    ): Promise<string> {
        if (!sourceText || sourceText.trim().length === 0) {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }

        if (!['vi', 'en'].includes(destinationLanguage)) {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }

        // Tạo prompt dịch thuật tự động phát hiện ngôn ngữ nguồn
        let translatePrompt = '';

        if (destinationLanguage === 'vi') {
            translatePrompt = `Dịch đoạn text sau sang tiếng Việt một cách chính xác, tự nhiên và dễ hiểu. Chỉ trả về kết quả dịch, không thêm bất kỳ giải thích nào khác:
                Text cần dịch: "${sourceText}"
                Bản dịch tiếng Việt:`;
        } else {
            translatePrompt = `Translate the following text to English accurately, naturally and clearly. Only return the translation result, do not add any other explanation:
                Text to translate: "${sourceText}"
                English translation:`;
        }

        const model = googleGenAIClient.getModel();

        try {
            const result = await model.invoke(translatePrompt);

            let translation =
                typeof result === 'string'
                    ? result
                    : result?.content?.toString() || '';

            translation = translation.trim();

            if (!translation) {
                throw new Error('Translation result is empty');
            }

            return translation;
        } catch (error) {
            console.error('[ResourceService] translate failed', error);
            throw new Error('AI translation service failed. Please try again.');
        }
    }
}
export const translateService = new TranslateService();
