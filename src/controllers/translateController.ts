import { Request, Response } from 'express';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import dictionaryService from '~/services/dictionaryService.js';

class TranslateController {
    public translate = async (req: Request, res: Response) => {
        const { sourceText, destinationLanguage = 'vi' } = req.body;
        try {
            const translation = await dictionaryService.translateTextWithAI(
                sourceText,
                destinationLanguage as 'vi' | 'en'
            );
            return res.status(200).json(
                new ApiResponse(SuccessMessage.TRANSLATE_SUCCESS, {
                    destinationText: translation,
                })
            );
        } catch (error) {
            console.error('AI translation failed', error);
            throw new ApiError({ message: 'AI translation service failed' });
        }
    };

    public getDictionaryInfo = async (req: Request, res: Response) => {
        const word = req.body?.word || req.params?.word || req.query?.word;
        const destinationLanguage =
            req.body?.destinationLanguage ||
            req.query?.destinationLanguage ||
            'vi';

        // Kiểm tra chỉ nhập 1 từ
        if (
            !word ||
            typeof word !== 'string' ||
            word.trim().split(/\s+/).length !== 1
        ) {
            throw new ApiError(ErrorMessage.INPUT_MUST_BE_SINGLE_WORD);
        }

        const result = await dictionaryService.getDictionaryInfoWithAI(
            word,
            destinationLanguage as string
        );

        return res.status(200).json(
            new ApiResponse(SuccessMessage.TRANSLATE_SUCCESS, {
                // Unified fields for Dictionary Lookup
                sourceText: result.sourceText,
                destinationText: result.destinationText,
                pronunciation: result.pronunciation,
                definitions: result.definitions,
            })
        );
    };
}

export const translateController = new TranslateController();
