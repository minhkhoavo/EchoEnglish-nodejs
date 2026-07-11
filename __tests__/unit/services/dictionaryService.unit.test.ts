import dictionaryService from '~/services/dictionaryService.js';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { ApiError } from '~/middleware/apiError.js';
import fs from 'fs';

// ──────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────
jest.mock('~/ai/provider/googleGenAIClient.js', () => ({
    googleGenAIClient: {
        getModel: jest.fn().mockReturnValue({
            invoke: jest.fn(),
        }),
    },
}));

jest.mock('fs');

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────
describe('DictionaryService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Mock prompt template reading based on file path
        (fs.readFileSync as jest.Mock).mockImplementation((pathStr: string) => {
            if (pathStr.includes('translate_to_')) {
                return 'Translate "{{sourceText}}"';
            }
            return 'Act as dictionary for "{{word}}" in "{{destinationLanguage}}"';
        });
    });

    // ════════════════════════════════════════════
    // translateTextWithAI()
    // ════════════════════════════════════════════
    describe('translateTextWithAI', () => {
        it('should throw ApiError if sourceText is empty', async () => {
            await expect(
                dictionaryService.translateTextWithAI('   ', 'vi')
            ).rejects.toThrow(ApiError);
        });

        it('should throw ApiError if destinationLanguage is invalid', async () => {
            await expect(
                dictionaryService.translateTextWithAI('hello', 'fr' as 'vi')
            ).rejects.toThrow(ApiError);
        });

        it('should return translation from AI for valid input', async () => {
            const mockModelInvoke = jest.fn().mockResolvedValue('xin chào');
            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            const result = await dictionaryService.translateTextWithAI(
                'hello',
                'vi'
            );

            expect(result).toBe('xin chào');
            expect(mockModelInvoke).toHaveBeenCalledWith(
                expect.stringContaining('hello')
            );
        });

        it('should strip quotes from translation if present', async () => {
            const mockModelInvoke = jest.fn().mockResolvedValue('"xin chào"');
            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            const result = await dictionaryService.translateTextWithAI(
                'hello',
                'vi'
            );

            expect(result).toBe('xin chào');
        });

        it('should return translation from AI when result is an object with content property', async () => {
            const mockModelInvoke = jest
                .fn()
                .mockResolvedValue({ content: 'xin chào object' });
            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            const result = await dictionaryService.translateTextWithAI(
                'hello',
                'vi'
            );

            expect(result).toBe('xin chào object');
        });

        it('should throw an error if AI returns an object without content', async () => {
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            const mockModelInvoke = jest.fn().mockResolvedValue({});
            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            await expect(
                dictionaryService.translateTextWithAI('hello', 'vi')
            ).rejects.toThrow(
                'AI translation service failed. Please try again.'
            );

            consoleErrorSpy.mockRestore();
        });

        it('should throw an error if AI returns empty translation', async () => {
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            const mockModelInvoke = jest.fn().mockResolvedValue('   ');
            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            await expect(
                dictionaryService.translateTextWithAI('hello', 'en')
            ).rejects.toThrow(
                'AI translation service failed. Please try again.'
            );

            consoleErrorSpy.mockRestore();
        });
    });

    // ════════════════════════════════════════════
    // getDictionaryInfoWithAI()
    // ════════════════════════════════════════════
    describe('getDictionaryInfoWithAI', () => {
        it('should return default result if word is empty', async () => {
            const result =
                await dictionaryService.getDictionaryInfoWithAI('   ');
            expect(result.sourceText).toBe('');
            expect(result.destinationText).toBe('');
            expect(result.definitions).toEqual([]);
            expect(result.pronunciation.sourcePhonetic).toBeNull();
        });

        it('should fetch dictionary info using AI and parse JSON correctly', async () => {
            const mockJson = JSON.stringify({
                destinationText: 'xin chào',
                phonetic: 'həˈloʊ',
                definitions: [{ definition: 'greeting' }],
            });
            const mockModelInvoke = jest
                .fn()
                .mockResolvedValue(`\`\`\`json\n${mockJson}\n\`\`\``);

            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            const result = await dictionaryService.getDictionaryInfoWithAI(
                '  Hello  ',
                'vi'
            );

            expect(result.sourceText).toBe('hello');
            expect(result.destinationText).toBe('xin chào');
            expect(result.pronunciation.sourcePhonetic).toBe('/həˈloʊ/');
            expect(result.definitions).toEqual([{ definition: 'greeting' }]);

            // Check if prompt was replaced
            expect(mockModelInvoke).toHaveBeenCalledWith(
                expect.stringContaining('hello')
            );
        });

        it('should handle AI returning string with slashes already in phonetic', async () => {
            const mockJson = JSON.stringify({
                destinationText: 'bạn',
                phonetic: '/frend/',
                definitions: [],
            });
            const mockModelInvoke = jest.fn().mockResolvedValue(mockJson);
            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            const result =
                await dictionaryService.getDictionaryInfoWithAI('friend');

            expect(result.pronunciation.sourcePhonetic).toBe('/frend/');
        });

        it('should strip quotes from finalDestinationText if present', async () => {
            const mockJson = JSON.stringify({
                destinationText: '"xin chào"',
                phonetic: 'həˈloʊ',
                definitions: [],
            });
            const mockModelInvoke = jest.fn().mockResolvedValue(mockJson);
            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            const result =
                await dictionaryService.getDictionaryInfoWithAI('hello');

            expect(result.destinationText).toBe('xin chào');
        });

        it('should handle AI returning an object with content property', async () => {
            const mockJson = JSON.stringify({
                destinationText: 'xin chào object',
                phonetic: 'həˈloʊ',
                definitions: [],
            });
            const mockModelInvoke = jest
                .fn()
                .mockResolvedValue({ content: mockJson });

            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            const result = await dictionaryService.getDictionaryInfoWithAI(
                'hello',
                'vi'
            );

            expect(result.destinationText).toBe('xin chào object');
        });

        it('should handle AI returning an object without content property', async () => {
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            const mockModelInvoke = jest.fn().mockResolvedValue({}); // result.content is undefined -> fallback to '' -> JSON parse throws

            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            const result = await dictionaryService.getDictionaryInfoWithAI(
                'hello',
                'vi'
            );

            expect(result.destinationText).toBe('');
            consoleErrorSpy.mockRestore();
        });

        it('should handle JSON response with missing optional fields', async () => {
            const mockJson = JSON.stringify({}); // empty object
            const mockModelInvoke = jest.fn().mockResolvedValue(mockJson);
            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            const result =
                await dictionaryService.getDictionaryInfoWithAI('friend');

            expect(result.destinationText).toBe('');
            expect(result.pronunciation.sourcePhonetic).toBeNull();
            expect(result.definitions).toEqual([]);
        });

        it('should return default format and log error if AI invocation fails', async () => {
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();

            const mockModelInvoke = jest
                .fn()
                .mockRejectedValue(new Error('AI down'));
            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            const result =
                await dictionaryService.getDictionaryInfoWithAI('hello');

            expect(result.sourceText).toBe('hello');
            expect(result.destinationText).toBe('');
            expect(result.pronunciation.sourcePhonetic).toBeNull();
            expect(result.definitions).toEqual([]);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'AI failed to generate dictionary info for "hello":',
                expect.any(Error)
            );

            consoleErrorSpy.mockRestore();
        });

        it('should handle JSON parsing error and return default format', async () => {
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();

            const mockModelInvoke = jest
                .fn()
                .mockResolvedValue('invalid json response');
            (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
                invoke: mockModelInvoke,
            });

            const result =
                await dictionaryService.getDictionaryInfoWithAI('hello');

            expect(result.sourceText).toBe('hello');
            expect(result.destinationText).toBe('');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'AI failed to generate dictionary info for "hello":',
                expect.any(Error)
            );

            consoleErrorSpy.mockRestore();
        });
    });
});
