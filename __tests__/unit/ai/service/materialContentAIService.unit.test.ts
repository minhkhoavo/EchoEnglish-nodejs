/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { materialContentAIService } from '~/ai/service/materialContentAIService.js';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import { GoogleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';

jest.mock('~/ai/provider/googleGenAIClient.js');
jest.mock('@langchain/core/output_parsers');

describe('MaterialContentAIService', () => {
    let mockInvoke: jest.Mock;
    let consoleErrorSpy: jest.SpyInstance;
    let loadTemplateSpy: jest.SpyInstance;

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

        jest.spyOn(
            (materialContentAIService as any).llmClient,
            'getModel'
        ).mockReturnValue(mockModel);

        loadTemplateSpy = jest
            .spyOn(promptManagerService, 'loadTemplate')
            .mockResolvedValue('mocked prompt');
    });

    afterEach(() => {
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
        if (loadTemplateSpy) loadTemplateSpy.mockRestore();
    });

    const baseInput = {
        title: 'Test Material',
        content: 'This is test content',
        focus: 'grammar',
        targetSkills: ['grammar'],
        level: 'beginner',
        studyTimePerDay: 30,
    };

    describe('extractFromMaterial', () => {
        it('should successfully extract material content with full data from LLM', async () => {
            const llmOutput = {
                grammarGuide: {
                    title: 'Custom Grammar Title',
                    sections: [{ title: 's1', content: 'c1' }],
                    quickTips: ['tip1'],
                },
                vocabulary: {
                    title: 'Custom Vocab Title',
                    description: 'Custom desc',
                    words: [
                        {
                            word: 'test',
                            partOfSpeech: 'n',
                            definition: 'def',
                            example: 'ex',
                            usageNote: 'note',
                        },
                    ],
                },
            };
            mockInvoke.mockResolvedValueOnce(llmOutput);

            const result =
                await materialContentAIService.extractFromMaterial(baseInput);

            expect(result).toEqual(llmOutput);
            expect(loadTemplateSpy).toHaveBeenCalledWith(
                'studyplan/material_content_extraction',
                expect.objectContaining({
                    title: 'Test Material',
                    targetSkills: 'grammar',
                    content: 'This is test content',
                })
            );
        });

        it('should use default values if LLM output is missing some properties', async () => {
            const llmOutput = {
                // empty objects missing properties
                grammarGuide: {},
                vocabulary: {},
            };
            mockInvoke.mockResolvedValueOnce(llmOutput);

            const result =
                await materialContentAIService.extractFromMaterial(baseInput);

            expect(result.grammarGuide.title).toBe(
                'Grammar from: Test Material'
            );
            expect(result.grammarGuide.sections).toEqual([]);
            expect(result.grammarGuide.quickTips).toEqual([]);

            expect(result.vocabulary.title).toBe(
                'Vocabulary from: Test Material'
            );
            expect(result.vocabulary.description).toBe(
                'Key words pulled from this material'
            );
            expect(result.vocabulary.words).toEqual([]);
        });

        it('should handle undefined LLM properties completely', async () => {
            const llmOutput = {}; // nothing returned at all
            mockInvoke.mockResolvedValueOnce(llmOutput);

            const result =
                await materialContentAIService.extractFromMaterial(baseInput);

            expect(result.grammarGuide.title).toBe(
                'Grammar from: Test Material'
            );
            expect(result.grammarGuide.sections).toEqual([]);
            expect(result.grammarGuide.quickTips).toEqual([]);

            expect(result.vocabulary.title).toBe(
                'Vocabulary from: Test Material'
            );
            expect(result.vocabulary.description).toBe(
                'Key words pulled from this material'
            );
            expect(result.vocabulary.words).toEqual([]);
        });

        it('should handle empty targetSkills and normalize it to "general"', async () => {
            mockInvoke.mockResolvedValueOnce({});
            const input = { ...baseInput, targetSkills: [] };

            await materialContentAIService.extractFromMaterial(input);

            expect(loadTemplateSpy).toHaveBeenCalledWith(
                'studyplan/material_content_extraction',
                expect.objectContaining({ targetSkills: 'general' })
            );
        });

        it('should truncate content if it exceeds MAX_CONTENT_CHARS (6000)', async () => {
            mockInvoke.mockResolvedValueOnce({});
            const longContent = 'A'.repeat(7000);
            const input = { ...baseInput, content: longContent };

            await materialContentAIService.extractFromMaterial(input);

            const callArgs = loadTemplateSpy.mock.calls[0][1];
            expect(callArgs.content.length).toBe(6000);
            expect(callArgs.content).toBe('A'.repeat(6000));
        });

        it('should handle undefined or falsy content gracefully', async () => {
            mockInvoke.mockResolvedValueOnce({});
            const input = { ...baseInput, content: undefined as any };

            await materialContentAIService.extractFromMaterial(input);

            const callArgs = loadTemplateSpy.mock.calls[0][1];
            expect(callArgs.content).toBe('');
        });

        it('should return fallback data and log error if LLM invocation fails', async () => {
            mockInvoke.mockRejectedValueOnce(new Error('LLM crash'));

            const result =
                await materialContentAIService.extractFromMaterial(baseInput);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error extracting material content:',
                expect.any(Error)
            );

            expect(result.grammarGuide.title).toBe(
                'Grammar from: Test Material'
            );
            expect(result.grammarGuide.sections).toEqual([]);
            expect(result.grammarGuide.quickTips).toEqual([]);

            expect(result.vocabulary.title).toBe(
                'Vocabulary from: Test Material'
            );
            expect(result.vocabulary.description).toBe(
                'Key words pulled from this material'
            );
            expect(result.vocabulary.words).toEqual([]);
        });
    });
});
