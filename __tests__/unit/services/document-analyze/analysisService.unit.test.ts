/* eslint-disable @typescript-eslint/no-explicit-any */
import { documentAnalysisService } from '~/services/document-analyze/analysisService.js';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
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

jest.mock('mongoose', () => {
    const actual = jest.requireActual('mongoose');
    const originalEmitWarning = process.emitWarning;
    process.emitWarning = (warning: any, ...args: any[]) => {
        if (
            typeof warning === 'string' &&
            warning.includes('suppressReservedKeysWarning')
        ) {
            return;
        }
        if (args[0] === 'MongooseWarning') {
            return;
        }
        return originalEmitWarning(warning, ...args);
    };
    return actual;
});

// Mock googleGenAIClient
jest.mock('~/ai/provider/googleGenAIClient.js', () => ({
    googleGenAIClient: {
        getModel: jest.fn(),
    },
}));

describe('DocumentAnalysisService', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let mockInvoke: jest.Mock;

    const mockValidJson = {
        difficulty: 'CEFR_A1',
        style: 'formal',
        domain: ['business'],
        genre: ['article'],
        setting: ['office'],
        toeic_parts: {
            part2: false,
            part3: true,
            part4: false,
            part5: true,
            part6: false,
            part7: true,
        },
        token_length: 150,
        text_quality: 0.9,
        summary: 'This is a summary with at least 10 characters.',
        language: 'en',
        language_confidence: 0.95,
        teaching_notes: 'Focus on business vocabulary.',
        personalization_ideas: ['Roleplay office scenarios.'],
        toeic_question_ideas: ['What is the main topic?'],
        vocabulary_highlights: [
            {
                term: 'business',
                cefr: 'A2',
                explanation: 'commerce',
                example: 'business deal',
            },
        ],
        additional_metadata: { source: 'test' },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        consoleWarnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});

        mockInvoke = jest.fn().mockResolvedValue({
            content: JSON.stringify(mockValidJson),
        });

        (googleGenAIClient.getModel as jest.Mock).mockReturnValue({
            invoke: mockInvoke,
        });
    });

    afterEach(() => {
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
        if (consoleWarnSpy) consoleWarnSpy.mockRestore();
    });

    it('should successfully analyze text and return correct shape', async () => {
        const text = 'This is a sample document text for analysis.';
        const result = await documentAnalysisService.analyze(text);

        expect(googleGenAIClient.getModel).toHaveBeenCalled();
        expect(mockInvoke).toHaveBeenCalledTimes(1);

        const invokeArgs = mockInvoke.mock.calls[0][0];
        expect(invokeArgs[0].role).toBe('user');
        expect(invokeArgs[0].content).toContain(text);

        expect(result.analysis).toBeDefined();
        expect(result.analysis.difficulty).toBe(mockValidJson.difficulty);
        expect(result.analysis.domain).toEqual(mockValidJson.domain);
        expect(result.raw).toEqual(mockValidJson);
        expect(result.response).toEqual({
            content: JSON.stringify(mockValidJson),
        });
    });

    it('should truncate text to 25,000 characters if input is too long', async () => {
        const longText = 'A'.repeat(30_000);
        await documentAnalysisService.analyze(longText);

        const invokeArgs = mockInvoke.mock.calls[0][0];
        const promptContent = invokeArgs[0].content;

        // The text is included between --- markers
        const extractedTextMatch = promptContent.match(/---\n([\s\S]*)\n---/);
        expect(extractedTextMatch).toBeDefined();
        if (extractedTextMatch) {
            expect(extractedTextMatch[1].length).toBe(25_000);
            expect(extractedTextMatch[1]).toBe('A'.repeat(25_000));
        }
    });

    it('should throw error if parsing fails', async () => {
        mockInvoke.mockResolvedValue({
            content: 'Invalid JSON',
        });

        await expect(documentAnalysisService.analyze('text')).rejects.toThrow();
    });
});
