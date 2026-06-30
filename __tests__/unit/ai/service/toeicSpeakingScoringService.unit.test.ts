/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { aiScoringService } from '~/ai/service/toeicSpeakingScoringService.js';
import RecordingService from '~/services/recordingService.js';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { imageUrlToDataUrl } from '~/utils/imageUtils.js';
import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';

jest.mock('~/services/recordingService.js', () => ({
    __esModule: true,
    default: {
        getRecordingSummary: jest.fn(),
    },
}));

jest.mock('~/ai/provider/googleGenAIClient.js', () => ({
    googleGenAIClient: {
        getModel: jest.fn(),
    },
}));

jest.mock('~/utils/imageUtils.js', () => ({
    imageUrlToDataUrl: jest.fn(),
}));

jest.mock('@langchain/core/prompts', () => ({
    PromptTemplate: {
        fromTemplate: jest.fn(),
    },
}));

describe('ToeicSpeakingScoringService (AIScoringService)', () => {
    let mockInvoke: jest.Mock;
    let consoleErrorSpy: jest.SpyInstance;
    let getTemplateSpy: jest.SpyInstance;
    let formatSpy: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();

        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        mockInvoke = jest.fn();
        const mockModel = {
            pipe: jest.fn().mockReturnValue({
                invoke: mockInvoke,
            }),
        };

        (googleGenAIClient.getModel as jest.Mock).mockReturnValue(mockModel);

        getTemplateSpy = jest
            .spyOn(promptManagerService, 'getTemplate')
            .mockResolvedValue('mocked template');

        formatSpy = jest.fn().mockResolvedValue('formatted text');
        (PromptTemplate.fromTemplate as jest.Mock).mockReturnValue({
            format: formatSpy,
        });

        (imageUrlToDataUrl as jest.Mock).mockResolvedValue(
            'data:image/png;base64,mock'
        );

        // Set env var for testing fallback
        process.env.GEMINI_DEFAULT_MODEL = 'gemini-1.5-flash';
        delete process.env.GEMINI_CHATBOT_CONSERVATION_MODEL;
    });

    afterEach(() => {
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
        if (getTemplateSpy) getTemplateSpy.mockRestore();
    });

    const mockContext: any = {
        questionType: 'speaking_part1',
        referenceText: 'Hello world',
        questionPrompt: 'Read aloud',
        providedInfo: 'info',
    };

    const mockSummary = {
        transcript: 'Hello world',
        quantitativeMetrics: {
            pronunciationScore: 90,
            fluencyScore: 80,
            prosodyScore: 85,
            wordsPerMinute: 120,
        },
        qualitativeAnalysis: {
            pronunciationMistakes: ['w1'],
            fluencyIssues: ['f1'],
        },
    };

    describe('scoreRecording', () => {
        it('should successfully score recording without image', async () => {
            (
                RecordingService.getRecordingSummary as jest.Mock
            ).mockResolvedValueOnce(mockSummary);
            mockInvoke.mockResolvedValueOnce({ score: 90 });

            const result = await aiScoringService.scoreRecording(
                'rec1',
                mockContext
            );

            expect(result).toEqual({ score: 90 });
            expect(RecordingService.getRecordingSummary).toHaveBeenCalledWith(
                'rec1'
            );
            expect(getTemplateSpy).toHaveBeenCalledWith('part_1_read_aloud');

            expect(formatSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    questionType: 'speaking_part1',
                    transcript: 'Hello world',
                    pronunciationScore: 90,
                    pronunciationMistakes: '- w1',
                })
            );

            expect(mockInvoke).toHaveBeenCalledWith('formatted text');
            expect(googleGenAIClient.getModel).toHaveBeenCalledWith(
                'gemini-1.5-flash'
            );
        });

        it('should successfully score recording with image and chatbot model override', async () => {
            process.env.GEMINI_CHATBOT_CONSERVATION_MODEL =
                'gemini-chatbot-model';

            (
                RecordingService.getRecordingSummary as jest.Mock
            ).mockResolvedValueOnce(mockSummary);
            mockInvoke.mockResolvedValueOnce({ score: 80 });

            const result = await aiScoringService.scoreRecording('rec1', {
                ...mockContext,
                questionType: 'speaking_part2',
                imageUrl: 'http://img.com/a.png',
            });

            expect(result).toEqual({ score: 80 });
            expect(getTemplateSpy).toHaveBeenCalledWith(
                'part_2_describe_picture'
            );
            expect(imageUrlToDataUrl).toHaveBeenCalledWith(
                'http://img.com/a.png'
            );
            expect(googleGenAIClient.getModel).toHaveBeenCalledWith(
                'gemini-chatbot-model'
            );

            expect(mockInvoke).toHaveBeenCalledWith([
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'formatted text' },
                        {
                            type: 'image_url',
                            image_url: { url: 'data:image/png;base64,mock' },
                        },
                    ],
                },
            ]);
        });

        it('should map all question types correctly', async () => {
            (
                RecordingService.getRecordingSummary as jest.Mock
            ).mockResolvedValue(mockSummary);
            mockInvoke.mockResolvedValue({ score: 100 });

            const types = [
                ['speaking_part1', 'part_1_read_aloud'],
                ['speaking_part2', 'part_2_describe_picture'],
                ['speaking_part3', 'part_3_respond_short'],
                ['speaking_part4', 'part_4_respond_with_info'],
                ['speaking_part5', 'part_5_express_opinion'],
                ['speaking_part6', 'part_6_propose_solution'],
            ];

            for (const [type, template] of types) {
                await aiScoringService.scoreRecording('rec1', {
                    questionType: type as any,
                });
                expect(getTemplateSpy).toHaveBeenCalledWith(template);
            }
        });

        it('should throw error for invalid question type', async () => {
            (
                RecordingService.getRecordingSummary as jest.Mock
            ).mockResolvedValueOnce(mockSummary);

            await expect(
                aiScoringService.scoreRecording('rec1', {
                    questionType: 'invalid_type' as any,
                })
            ).rejects.toThrow('Invalid questionType: invalid_type');
        });

        it('should throw error if recording summary not found', async () => {
            (
                RecordingService.getRecordingSummary as jest.Mock
            ).mockResolvedValueOnce(null);

            await expect(
                aiScoringService.scoreRecording('rec1', mockContext)
            ).rejects.toThrow('Could not get recording summary.');
        });

        it('should handle undefined optional fields in summary gracefully', async () => {
            (
                RecordingService.getRecordingSummary as jest.Mock
            ).mockResolvedValueOnce({
                // completely empty summary
            });
            mockInvoke.mockResolvedValueOnce({ score: 50 });

            await aiScoringService.scoreRecording('rec1', mockContext);

            expect(formatSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    pronunciationMistakes: 'None',
                    fluencyIssues: 'None',
                })
            );
        });

        it('should catch error on LLM failure and throw generic error', async () => {
            (
                RecordingService.getRecordingSummary as jest.Mock
            ).mockResolvedValueOnce(mockSummary);
            mockInvoke.mockRejectedValueOnce(new Error('crash'));

            await expect(
                aiScoringService.scoreRecording('rec1', mockContext)
            ).rejects.toThrow(
                'AI model failed to process the request or return valid JSON.'
            );

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[AIScoringService] Chain invocation failed.',
                expect.any(Error)
            );
        });
    });
});
