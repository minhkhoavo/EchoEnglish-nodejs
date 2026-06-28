import {
    extractTextFromMessage,
    extractUsageMetadata,
    composeUsage,
} from '~/utils/aiUtils.js';

describe('aiUtils', () => {
    describe('extractTextFromMessage', () => {
        it('should return empty string if response is falsy', () => {
            expect(extractTextFromMessage(null)).toBe('');
            expect(extractTextFromMessage(undefined)).toBe('');
        });

        it('should return text if message.text is a string', () => {
            expect(extractTextFromMessage({ text: 'Hello' })).toBe('Hello');
        });

        it('should return joined text if message.content is an array', () => {
            const response = {
                content: [
                    'Part 1',
                    { text: 'Part 2' },
                    null,
                    { something: 'else' },
                ],
            };
            expect(extractTextFromMessage(response)).toBe('Part 1\nPart 2');
        });

        it('should return string if message.content is a string', () => {
            expect(extractTextFromMessage({ content: 'String content' })).toBe(
                'String content'
            );
        });

        it('should fallback to String(response) if no other condition matches', () => {
            expect(extractTextFromMessage(123)).toBe('123');
        });
    });

    describe('extractUsageMetadata', () => {
        it('should return undefined if usage_metadata is missing', () => {
            expect(extractUsageMetadata({})).toBeUndefined();
        });

        it('should extract usage metadata correctly with defaults', () => {
            const response = {
                usage_metadata: {},
            };
            expect(extractUsageMetadata(response)).toEqual({
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                model: 'gemini-2.0-flash',
            });
        });

        it('should extract usage metadata correctly with values', () => {
            const response = {
                modelVersion: 'gemini-2.0-pro',
                usage_metadata: {
                    input_tokens: 10,
                    output_tokens: 20,
                    total_tokens: 30,
                },
            };
            expect(extractUsageMetadata(response)).toEqual({
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30,
                model: 'gemini-2.0-pro',
            });
        });
    });

    describe('composeUsage', () => {
        it('should return undefined if extractUsageMetadata returns undefined', () => {
            expect(composeUsage({})).toBeUndefined();
        });

        it('should calculate cost based on RATE_TABLE', () => {
            const response = {
                modelVersion: 'gemini-2.0-flash',
                usage_metadata: {
                    input_tokens: 1000000, // 0.1 USD
                    output_tokens: 1000000, // 0.4 USD
                },
            };
            const result = composeUsage(response);
            expect(result).toEqual({
                promptTokens: 1000000,
                completionTokens: 1000000,
                totalTokens: 0,
                totalCost: 0.5,
                currency: 'USD',
                model: 'gemini-2.0-flash',
            });
        });

        it('should handle unknown models gracefully', () => {
            const response = {
                modelVersion: 'unknown-model',
                usage_metadata: {
                    input_tokens: 1000000,
                    output_tokens: 1000000,
                },
            };
            const result = composeUsage(response);
            expect(result).toEqual({
                promptTokens: 1000000,
                completionTokens: 1000000,
                totalTokens: 0,
                totalCost: 0,
                currency: 'USD',
                model: 'unknown-model',
            });
        });
    });
});
