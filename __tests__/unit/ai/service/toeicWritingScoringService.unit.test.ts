/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { toeicWritingScoringService } from '~/ai/service/toeicWritingScoringService.js';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { imageUrlToDataUrl } from '~/utils/imageUtils.js';
import { PromptTemplate } from '@langchain/core/prompts';

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

describe('ToeicWritingScoringService', () => {
    let mockInvoke: jest.Mock;
    let consoleErrorSpy: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;
    let getTemplateSpy: jest.SpyInstance;
    let formatSpy: jest.Mock;
    let setTimeoutSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        setTimeoutSpy = jest
            .spyOn(global, 'setTimeout')
            .mockImplementation((cb: any) => {
                cb();
                return {} as any;
            });

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
    });

    afterEach(() => {
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (getTemplateSpy) getTemplateSpy.mockRestore();
        if (setTimeoutSpy) setTimeoutSpy.mockRestore();
    });

    const mockContext: any = {
        partType: 1,
        questionPrompt: 'Describe picture',
        userAnswer: 'A cat',
        keywords: 'cat, jump',
    };

    describe('scoreWriting', () => {
        it('should successfully score part 1 with text only (no image)', async () => {
            mockInvoke.mockResolvedValueOnce({ score: 100 });

            const result =
                await toeicWritingScoringService.scoreWriting(mockContext);

            expect(result).toEqual({ score: 100 });
            expect(getTemplateSpy).toHaveBeenCalledWith(
                'part_1_describe_picture'
            );
            expect(formatSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    questionPrompt: 'Describe picture',
                    keywords: 'cat, jump',
                    candidateSentence: 'A cat',
                })
            );
            expect(mockInvoke).toHaveBeenCalledWith('formatted text');
        });

        it('should successfully score part 2', async () => {
            mockInvoke.mockResolvedValueOnce({ score: 90 });

            const result = await toeicWritingScoringService.scoreWriting({
                ...mockContext,
                partType: 2,
                questionPrompt: 'Reply to email',
                userAnswer: 'Hello,',
            });

            expect(getTemplateSpy).toHaveBeenCalledWith(
                'part_2_email_response'
            );
            expect(formatSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    emailPrompt: 'Reply to email',
                    candidateResponse: 'Hello,',
                })
            );
        });

        it('should successfully score part 3', async () => {
            mockInvoke.mockResolvedValueOnce({ score: 80 });

            const result = await toeicWritingScoringService.scoreWriting({
                ...mockContext,
                partType: 3,
                questionPrompt: 'Write essay',
                userAnswer: 'I think',
            });

            expect(getTemplateSpy).toHaveBeenCalledWith('part_3_opinion_essay');
            expect(formatSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    essayPrompt: 'Write essay',
                    candidateEssay: 'I think',
                })
            );
        });

        it('should handle invalid partType gracefully (returns empty template string and fallbacks)', async () => {
            getTemplateSpy.mockRejectedValueOnce(
                new Error('Template not found')
            );
            mockInvoke.mockResolvedValueOnce({ score: 0 });

            // partType 4 is invalid
            await toeicWritingScoringService.scoreWriting({
                ...mockContext,
                partType: 4,
            });

            expect(getTemplateSpy).toHaveBeenCalledWith('');
            // fallback template for invalid part will go to "part_3_opinion_essay" default fallback branch if '' doesn't match 'part_1' or 'part_2'
            // check formatSpy was called
            expect(formatSpy).toHaveBeenCalled();
        });

        it('should successfully score with image (part 1)', async () => {
            mockInvoke.mockResolvedValueOnce({ score: 70 });

            await toeicWritingScoringService.scoreWriting({
                ...mockContext,
                imageUrl: 'http://img.com/a.png',
            });

            expect(imageUrlToDataUrl).toHaveBeenCalledWith(
                'http://img.com/a.png'
            );
            expect(mockInvoke).toHaveBeenCalledWith([
                expect.objectContaining({
                    role: 'user',
                    content: expect.arrayContaining([
                        { type: 'text', text: 'formatted text' },
                        {
                            type: 'image_url',
                            image_url: { url: 'data:image/png;base64,mock' },
                        },
                    ]),
                }),
            ]);
        });

        it('should fallback to text-only if image processing fails', async () => {
            (imageUrlToDataUrl as jest.Mock).mockRejectedValueOnce(
                new Error('Image fetch fail')
            );
            mockInvoke.mockResolvedValueOnce({ score: 60 });

            await toeicWritingScoringService.scoreWriting({
                ...mockContext,
                imageUrl: 'http://img.com/a.png',
            });

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[ToeicWritingScoringService] Image processing failed:',
                expect.any(Error)
            );
            // should fallback to text invoke
            expect(mockInvoke).toHaveBeenCalledWith('formatted text');
        });

        it('should use fallback templates if promptManagerService.getTemplate fails', async () => {
            getTemplateSpy.mockRejectedValue(new Error('Not found'));
            mockInvoke.mockResolvedValue({ score: 50 });

            // Test Part 1 fallback
            await toeicWritingScoringService.scoreWriting({
                ...mockContext,
                partType: 1,
            });
            let templateStr = (PromptTemplate.fromTemplate as jest.Mock).mock
                .calls[0][0];
            expect(templateStr).toContain(
                'You are evaluating a TOEIC Writing Part 1 response.'
            );

            (PromptTemplate.fromTemplate as jest.Mock).mockClear();

            // Test Part 2 fallback
            await toeicWritingScoringService.scoreWriting({
                ...mockContext,
                partType: 2,
            });
            templateStr = (PromptTemplate.fromTemplate as jest.Mock).mock
                .calls[0][0];
            expect(templateStr).toContain(
                'You are evaluating a TOEIC Writing Part 2 response.'
            );

            (PromptTemplate.fromTemplate as jest.Mock).mockClear();

            // Test Part 3 fallback
            await toeicWritingScoringService.scoreWriting({
                ...mockContext,
                partType: 3,
            });
            templateStr = (PromptTemplate.fromTemplate as jest.Mock).mock
                .calls[0][0];
            expect(templateStr).toContain(
                'You are evaluating a TOEIC Writing Part 3 essay.'
            );
        });

        it('should handle undefined optional fields (questionPrompt, keywords) gracefully', async () => {
            mockInvoke.mockResolvedValueOnce({ score: 40 });

            await toeicWritingScoringService.scoreWriting({
                ...mockContext,
                partType: 1,
                questionPrompt: undefined as any,
                keywords: undefined as any,
            });

            expect(formatSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    questionPrompt: '',
                    keywords: '',
                })
            );

            // Test for part 2 missing questionPrompt
            await toeicWritingScoringService.scoreWriting({
                ...mockContext,
                partType: 2,
                questionPrompt: undefined as any,
            });

            // Test for part 3 missing questionPrompt
            await toeicWritingScoringService.scoreWriting({
                ...mockContext,
                partType: 3,
                questionPrompt: undefined as any,
            });
        });

        it('should throw an error and log if LLM invocation fails', async () => {
            mockInvoke.mockRejectedValue(new Error('AI crash'));

            await expect(
                toeicWritingScoringService.scoreWriting(mockContext)
            ).rejects.toThrow('AI scoring failed');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[ToeicWritingScoringService] Scoring error:',
                expect.any(Error)
            );
        });
    });
});
