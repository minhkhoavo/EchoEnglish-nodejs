import { Request, Response } from 'express';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import { translateService } from '~/ai/service/translateService.js';

class TranslateController {
    public translate = async (req: Request, res: Response) => {
        const { sourceText, destinationLanguage = 'vi' } = req.body;
        try {
            const url = `https://ftapi.pythonanywhere.com/translate?dl=${encodeURIComponent(destinationLanguage)}&text=${encodeURIComponent(sourceText)}`;
            const response = await fetch(url);
            const result = await response.json();

            return res.status(200).json(
                new ApiResponse(SuccessMessage.TRANSLATE_SUCCESS, {
                    destinationText: result['destination-text'],
                })
            );
        } catch {
            console.error('Free API translation failed, falling back to AI');

            const translation = await translateService.translateWithAI(
                sourceText,
                destinationLanguage
            );
            return res.status(200).json(
                new ApiResponse(SuccessMessage.TRANSLATE_SUCCESS, {
                    destinationText: translation,
                    fallback: true,
                })
            );
        }
    };

    public dictionaryWithFreeTranslateAPI = async (
        req: Request,
        res: Response
    ) => {
        const { word, destinationLanguage = 'vi' } = req.body;

        // Kiểm tra chỉ nhập 1 từ
        if (
            !word ||
            typeof word !== 'string' ||
            word.trim().split(/\s+/).length !== 1
        ) {
            throw new ApiError(ErrorMessage.INPUT_MUST_BE_SINGLE_WORD);
        }

        const url = `https://ftapi.pythonanywhere.com/translate?dl=${encodeURIComponent(destinationLanguage)}&text=${encodeURIComponent(word)}`;
        const response = await fetch(url);
        const result = await response.json();

        // Trả về các trường cần thiết
        return res.status(200).json(
            new ApiResponse(SuccessMessage.TRANSLATE_SUCCESS, {
                sourceText: result['source-text'],
                destinationText: result['destination-text'],
                pronunciation: {
                    sourcePhonetic:
                        result['pronunciation']?.['source-text-phonetic'],
                    sourceAudio: result['pronunciation']?.['source-text-audio'],
                    destinationAudio:
                        result['pronunciation']?.['destination-text-audio'],
                },

                definitions: Array.isArray(result['definitions'])
                    ? result['definitions'].map((def) => ({
                          partOfSpeech: def['part-of-speech'],
                          definition: def['definition'],
                          example: def['example'],
                          synonyms: def['synonyms']?.[''] || [],
                      }))
                    : [],
            })
        );
    };
}

export const translateController = new TranslateController();
