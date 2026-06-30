/* eslint-disable @typescript-eslint/no-explicit-any */
import { contentModerationService } from '~/services/document-analyze/moderationService.js';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
jest.mock('~/ai/provider/googleGenAIClient.js', () => ({
    googleGenAIClient: {
        getModel: jest.fn(),
    },
}));
jest.mock('dotenv', () => {
    const actual = jest.requireActual('dotenv');
    return {
        ...actual,
        config: (...args: any[]) => {
            const originalLog = console.log;
            console.log = jest.fn();
            const result = actual.config(...args);
            console.log = originalLog;
            return result;
        },
    };
});

describe('ContentModerationService', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;
    let getModelSpy: jest.SpyInstance;
    let mockInvoke: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        mockInvoke = jest.fn();
        getModelSpy = jest
            .spyOn(googleGenAIClient, 'getModel')
            .mockReturnValue({
                pipe: jest.fn().mockReturnValue({
                    invoke: mockInvoke,
                }),
            } as any);
    });

    afterEach(() => {
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (consoleWarnSpy) consoleWarnSpy.mockRestore();
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
        if (getModelSpy) getModelSpy.mockRestore();
    });

    it('should truncate text to 10,000 characters and succeed with approved status', async () => {
        const longText = 'A'.repeat(12_000);
        mockInvoke.mockResolvedValue({
            status: 'approved',
            categories: [],
            reason: 'Looks good',
        });

        const result = await contentModerationService.moderate(longText);

        expect(result.status).toBe('approved');
        expect(result.categories).toEqual([]);
        expect(result.reason).toBe('Looks good');
        expect(mockInvoke).toHaveBeenCalledTimes(1);

        // Ensure prompt contains exactly 10,000 'A's
        const invokeArg = mockInvoke.mock.calls[0][0];
        expect(invokeArg).toContain('A'.repeat(10_000));
        expect(invokeArg).not.toContain('A'.repeat(10_001));
    });

    it('should fallback to empty categories if undefined in result', async () => {
        mockInvoke.mockResolvedValue({
            status: 'flagged',
            reason: 'some bad words',
            // no categories
        });

        const result = await contentModerationService.moderate('some text');
        expect(result.categories).toEqual([]);
    });

    it('should catch error and return flagged status on failure', async () => {
        mockInvoke.mockRejectedValue(new Error('AI service down'));

        const result = await contentModerationService.moderate('text');

        expect(result.status).toBe('flagged');
        expect(result.categories).toEqual(['moderation_error']);
        expect(result.reason).toBe('Moderation service unavailable');
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});
