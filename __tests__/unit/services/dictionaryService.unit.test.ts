 
import dictionaryService from '~/services/dictionaryService.js';
import axios from 'axios';

// ──────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────
describe('DictionaryService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ════════════════════════════════════════════
    // getPhonetics()
    // ════════════════════════════════════════════
    describe('getPhonetics', () => {
        const MOCK_API_RESPONSE = {
            'source-language': 'en',
            'source-text': 'friend',
            'destination-language': 'vi',
            'destination-text': 'bạn',
            pronunciation: {
                'source-text-phonetic': 'frend',
                'source-text-audio': 'https://example.com/audio/friend.mp3',
                'destination-text-audio': 'https://example.com/audio/ban.mp3',
            },
        };

        it('should trim and lowercase the search word', async () => {
            mockedAxios.get.mockResolvedValue({ data: MOCK_API_RESPONSE });

            await dictionaryService.getPhonetics('  FrIeNd  ');

            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://ftapi.pythonanywhere.com/translate',
                expect.objectContaining({
                    params: expect.objectContaining({
                        text: 'friend',
                    }),
                })
            );
        });

        it('should perform GET request with appropriate query parameters and timeout', async () => {
            mockedAxios.get.mockResolvedValue({ data: MOCK_API_RESPONSE });

            await dictionaryService.getPhonetics('hello');

            expect(mockedAxios.get).toHaveBeenCalledTimes(1);
            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://ftapi.pythonanywhere.com/translate',
                {
                    params: {
                        sl: 'en',
                        dl: 'en',
                        text: 'hello',
                    },
                    timeout: 5000,
                }
            );
        });

        it('should extract phonetic text and audio URL from API response', async () => {
            mockedAxios.get.mockResolvedValue({ data: MOCK_API_RESPONSE });

            const result = await dictionaryService.getPhonetics('friend');

            expect(result).toEqual([
                {
                    text: 'frend',
                    audio: 'https://example.com/audio/friend.mp3',
                },
            ]);
        });

        it('should return an empty array if API returns null/undefined data', async () => {
            mockedAxios.get.mockResolvedValue({ data: null });

            const result = await dictionaryService.getPhonetics('friend');

            expect(result).toEqual([]);
        });

        it('should return an empty array if pronunciation data is missing in API response', async () => {
            mockedAxios.get.mockResolvedValue({
                data: {
                    'source-text': 'friend',
                    pronunciation: {},
                },
            });

            const result = await dictionaryService.getPhonetics('friend');

            expect(result).toEqual([]);
        });

        it('should return an empty array and suppress logs if API returns a 404 response', async () => {
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            const error404 = {
                response: { status: 404 },
                message: 'Request failed with status code 404',
            };
            mockedAxios.get.mockRejectedValue(error404);

            const result =
                await dictionaryService.getPhonetics('nonexistentword');

            expect(result).toEqual([]);
            expect(consoleErrorSpy).not.toHaveBeenCalled();

            consoleErrorSpy.mockRestore();
        });

        it('should log the API error message and return an empty array for other axios errors', async () => {
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            const error500 = {
                response: { status: 500 },
                message: 'Internal Server Error',
            };
            mockedAxios.get.mockRejectedValue(error500);

            const result = await dictionaryService.getPhonetics('hello');

            expect(result).toEqual([]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Dictionary API error for "hello":',
                'Internal Server Error'
            );

            consoleErrorSpy.mockRestore();
        });

        it('should fall back to "Unknown error" when logging axios error without a message property', async () => {
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            const errorNoMsg = {
                response: { status: 500 },
            };
            mockedAxios.get.mockRejectedValue(errorNoMsg);

            const result = await dictionaryService.getPhonetics('hello');

            expect(result).toEqual([]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Dictionary API error for "hello":',
                'Unknown error'
            );

            consoleErrorSpy.mockRestore();
        });

        it('should log a generic error message and return an empty array for non-axios exceptions', async () => {
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            const errorObj = new Error('Network Failure');
            mockedAxios.get.mockRejectedValue(errorObj);

            const result = await dictionaryService.getPhonetics('hello');

            expect(result).toEqual([]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error fetching phonetics for "hello":',
                errorObj
            );

            consoleErrorSpy.mockRestore();
        });
    });

    // ════════════════════════════════════════════
    // formatPhonetic()
    // ════════════════════════════════════════════
    describe('formatPhonetic', () => {
        it('should wrap unwrapped phonetic text with forward slashes', () => {
            expect(dictionaryService.formatPhonetic('frend')).toBe('/frend/');
        });

        it('should not wrap phonetic text that already starts with a forward slash', () => {
            expect(dictionaryService.formatPhonetic('/frend/')).toBe('/frend/');
            expect(dictionaryService.formatPhonetic('/frend')).toBe('/frend');
        });

        it('should not wrap phonetic text that starts with a bracket', () => {
            expect(dictionaryService.formatPhonetic('[frend]')).toBe('[frend]');
            expect(dictionaryService.formatPhonetic('[frend')).toBe('[frend');
        });

        it('should trim whitespace before formatting', () => {
            expect(dictionaryService.formatPhonetic('  frend  ')).toBe(
                '/frend/'
            );
        });
    });

    // ════════════════════════════════════════════
    // getFirstPhonetic()
    // ════════════════════════════════════════════
    describe('getFirstPhonetic', () => {
        it('should return empty string if the phonetics array is empty', () => {
            expect(dictionaryService.getFirstPhonetic([])).toBe('');
        });

        it('should return formatted phonetic string of the first element in phonetics array', () => {
            const phonetics = [
                { text: 'frend', audio: 'audio-url' },
                { text: 'second-phonetic', audio: 'another-url' },
            ];
            expect(dictionaryService.getFirstPhonetic(phonetics)).toBe(
                '/frend/'
            );
        });
    });
});
