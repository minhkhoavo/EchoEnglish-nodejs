/* eslint-disable @typescript-eslint/no-explicit-any */
import { translateService } from '~/ai/service/translateService.js';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

jest.mock('~/ai/provider/googleGenAIClient.js', () => ({
    googleGenAIClient: {
        getModel: jest.fn(),
    },
}));

describe('TranslateService', () => {
    let mockInvoke: jest.Mock;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        mockInvoke = jest.fn();
        const mockModel = {
            invoke: mockInvoke,
        };
        (googleGenAIClient.getModel as jest.Mock).mockReturnValue(mockModel);
    });

    afterEach(() => {
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
    });

    describe('translateWithAI', () => {
        it('should translate to Vietnamese successfully', async () => {
            mockInvoke.mockResolvedValueOnce('Xin chào');

            const result = await translateService.translateWithAI(
                'Hello',
                'vi'
            );

            expect(result).toBe('Xin chào');
            const promptArg = mockInvoke.mock.calls[0][0];
            expect(promptArg).toContain('Dịch đoạn text sau sang tiếng Việt');
            expect(promptArg).toContain('Hello');
        });

        it('should translate to English successfully', async () => {
            // Test with object result instead of string
            mockInvoke.mockResolvedValueOnce({ content: 'Hello' });

            const result = await translateService.translateWithAI(
                'Xin chào',
                'en'
            );

            expect(result).toBe('Hello');
            const promptArg = mockInvoke.mock.calls[0][0];
            expect(promptArg).toContain(
                'Translate the following text to English'
            );
            expect(promptArg).toContain('Xin chào');
        });

        it('should handle result with empty content', async () => {
            mockInvoke.mockResolvedValueOnce({ content: '' }); // will cause 'Translation result is empty'

            await expect(
                translateService.translateWithAI('Hello', 'vi')
            ).rejects.toThrow(
                'AI translation service failed. Please try again.'
            );

            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        it('should throw ApiError if sourceText is empty or whitespace', async () => {
            await expect(
                translateService.translateWithAI('', 'vi')
            ).rejects.toThrow(ApiError);
            await expect(
                translateService.translateWithAI('   ', 'vi')
            ).rejects.toThrow(ApiError);

            try {
                await translateService.translateWithAI('', 'vi');
            } catch (err: any) {
                expect(err).toBeInstanceOf(ApiError);
                expect(err.status).toBe(ErrorMessage.INVALID_INPUT.status);
            }
        });

        it('should throw ApiError if destinationLanguage is invalid', async () => {
            await expect(
                translateService.translateWithAI('text', 'fr' as any)
            ).rejects.toThrow(ApiError);

            try {
                await translateService.translateWithAI('text', 'fr' as any);
            } catch (err: any) {
                expect(err).toBeInstanceOf(ApiError);
                expect(err.status).toBe(ErrorMessage.INVALID_INPUT.status);
            }
        });

        it('should throw error if translation result is empty string', async () => {
            mockInvoke.mockResolvedValueOnce('   '); // spaces which trim to empty

            await expect(
                translateService.translateWithAI('text', 'vi')
            ).rejects.toThrow(
                'AI translation service failed. Please try again.'
            );

            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        it('should catch arbitrary error and throw generic service failure', async () => {
            mockInvoke.mockRejectedValueOnce(new Error('AI crash'));

            await expect(
                translateService.translateWithAI('text', 'vi')
            ).rejects.toThrow(
                'AI translation service failed. Please try again.'
            );

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[ResourceService] translate failed',
                expect.any(Error)
            );
        });
    });
});
