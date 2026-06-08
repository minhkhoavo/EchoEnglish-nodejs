import axios from 'axios';

/**
 * Dictionary API Service
 * Using Free Translate API: https://ftapi.pythonanywhere.com
 */

interface PhoneticData {
    text: string;
    audio?: string;
}

// Ex: https://ftapi.pythonanywhere.com/translate?sl=en&dl=vi&text=friend
interface FreeTranslateApiResponse {
    'source-language': string;
    'source-text': string;
    'destination-language': string;
    'destination-text': string;
    pronunciation: {
        'source-text-phonetic'?: string;
        'source-text-audio'?: string;
        'destination-text-audio'?: string;
    };
}

class DictionaryService {
    private readonly API_BASE = 'https://ftapi.pythonanywhere.com';

    /**
     * Get phonetics for a word from Free Translate API
     * @param word - English word to get phonetics for
     * @returns Array of phonetic data with text and audio
     */
    public async getPhonetics(word: string): Promise<PhoneticData[]> {
        try {
            const cleanWord = word.trim().toLowerCase();
            const response = await axios.get<FreeTranslateApiResponse>(
                `${this.API_BASE}/translate`,
                {
                    params: {
                        sl: 'en',
                        dl: 'en',
                        text: cleanWord,
                    },
                    timeout: 5000,
                }
            );

            if (!response.data) {
                return [];
            }

            const phonetics: PhoneticData[] = [];

            // Get phonetic from pronunciation
            if (response.data.pronunciation?.['source-text-phonetic']) {
                phonetics.push({
                    text: response.data.pronunciation['source-text-phonetic'],
                    audio: response.data.pronunciation['source-text-audio'],
                });
            }

            return phonetics;
        } catch (error) {
            if (error && typeof error === 'object' && 'response' in error) {
                const axiosError = error as {
                    response?: { status?: number };
                    message?: string;
                };
                if (axiosError.response?.status === 404) {
                    return [];
                }
                console.error(
                    `Dictionary API error for "${word}":`,
                    axiosError.message || 'Unknown error'
                );
            } else {
                console.error(`Error fetching phonetics for "${word}":`, error);
            }
            return [];
        }
    }

    /**
     * Format phonetic text to IPA format
     * @param phonetic - Raw phonetic text
     * @returns Formatted IPA string
     */
    public formatPhonetic(phonetic: string): string {
        // Ensure phonetic is wrapped in forward slashes if not already
        const trimmed = phonetic.trim();
        if (!trimmed.startsWith('/') && !trimmed.startsWith('[')) {
            return `/${trimmed}/`;
        }
        return trimmed;
    }

    /**
     * Extract first valid phonetic from array
     * @param phonetics - Array of phonetic data
     * @returns First phonetic text or empty string
     */
    public getFirstPhonetic(phonetics: PhoneticData[]): string {
        if (phonetics.length === 0) return '';
        return this.formatPhonetic(phonetics[0].text);
    }
}

export default new DictionaryService();
