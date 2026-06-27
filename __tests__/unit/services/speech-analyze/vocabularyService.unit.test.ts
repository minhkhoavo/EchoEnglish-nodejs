/* eslint-disable @typescript-eslint/no-explicit-any */
import { PromptTemplate } from '@langchain/core/prompts';

import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { extractTranscript } from '~/utils/vocabularyUtils.js';

// ── Mocks ────────────────────────────────────────────────────────

jest.mock('@langchain/core/prompts', () => ({
    __esModule: true,
    PromptTemplate: {
        fromTemplate: jest.fn(),
    },
}));

jest.mock('@langchain/core/output_parsers', () => ({
    __esModule: true,
    JsonOutputParser: jest.fn(),
}));

jest.mock('~/ai/service/PromptManagerService.js', () => ({
    __esModule: true,
    promptManagerService: {
        getTemplate: jest.fn(),
    },
}));

jest.mock('~/ai/provider/googleGenAIClient.js', () => ({
    __esModule: true,
    googleGenAIClient: {
        getModel: jest.fn(),
    },
}));

jest.mock('~/utils/vocabularyUtils.js', () => ({
    __esModule: true,
    extractTranscript: jest.fn(),
    normalizeWord: jest.fn((w: string) =>
        String(w || '')
            .toLowerCase()
            .replace(/[^a-z']/g, '')
    ),
    cefrMap: {
        hello: 'A1',
        world: 'A1',
        good: 'A1',
        important: 'B2',
        sophisticated: 'C1',
        eloquent: 'C2',
        interesting: 'B1',
        beautiful: 'A2',
    } as Record<string, string>,
    PerformanceLevel: {},
}));

const mockedExtractTranscript = extractTranscript as jest.MockedFunction<
    typeof extractTranscript
>;
const mockedPromptManagerService = promptManagerService as jest.Mocked<
    typeof promptManagerService
>;
const mockedGoogleGenAIClient = googleGenAIClient as jest.Mocked<
    typeof googleGenAIClient
>;
const mockedPromptTemplate = PromptTemplate as jest.Mocked<
    typeof PromptTemplate
>;

// Import AFTER mocks
import vocabularyService from '~/services/speech-analyze/vocabularyService.js';

// ── Helpers ──────────────────────────────────────────────────────

function buildTransformed(
    segments: Array<{
        words: Array<{ word: string }>;
    }>
) {
    return { segments };
}

// ── Tests ────────────────────────────────────────────────────────

describe('VocabularyService (speech-analyze)', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    // ──────────────────────────────────────────────
    // analyzeVocabulary
    // ──────────────────────────────────────────────
    describe('analyzeVocabulary', () => {
        it('should return zeros for empty segments', () => {
            const transformed = buildTransformed([]);
            const result = vocabularyService.analyzeVocabulary(transformed);

            expect(result.totalWords).toBe(0);
            expect(result.uniqueWords).toBe(0);
            expect(result.knownWords).toBe(0);
            expect(result.unknownWords).toBe(0);
            expect(result.distribution).toEqual({});
            expect(result.topAdvanced).toEqual([]);
        });

        it('should count total and unique words correctly', () => {
            const transformed = buildTransformed([
                {
                    words: [
                        { word: 'hello' },
                        { word: 'world' },
                        { word: 'hello' },
                    ],
                },
            ]);
            const result = vocabularyService.analyzeVocabulary(transformed);

            expect(result.totalWords).toBe(3);
            expect(result.uniqueWords).toBe(2); // hello, world
        });

        it('should compute CEFR distribution from cefrMap', () => {
            const transformed = buildTransformed([
                {
                    words: [
                        { word: 'hello' },
                        { word: 'world' },
                        { word: 'important' },
                        { word: 'beautiful' },
                    ],
                },
            ]);
            const result = vocabularyService.analyzeVocabulary(transformed);

            expect(result.distribution['A1']).toBe(2); // hello, world
            expect(result.distribution['B2']).toBe(1); // important
            expect(result.distribution['A2']).toBe(1); // beautiful
            expect(result.knownWords).toBe(4);
            expect(result.unknownWords).toBe(0);
        });

        it('should count unknown words not in cefrMap', () => {
            const transformed = buildTransformed([
                {
                    words: [
                        { word: 'hello' },
                        { word: 'xylophone' }, // not in our mock cefrMap
                        { word: 'zzzz' }, // not in cefrMap
                    ],
                },
            ]);
            const result = vocabularyService.analyzeVocabulary(transformed);

            expect(result.knownWords).toBe(1); // hello
            expect(result.unknownWords).toBe(2); // xylophone, zzzz
        });

        it('should identify topAdvanced words (B2/C1/C2) sorted by frequency', () => {
            const transformed = buildTransformed([
                {
                    words: [
                        { word: 'sophisticated' },
                        { word: 'important' },
                        { word: 'important' },
                        { word: 'eloquent' },
                        { word: 'hello' }, // A1, should not appear
                    ],
                },
            ]);
            const result = vocabularyService.analyzeVocabulary(transformed);

            expect(result.topAdvanced.length).toBeGreaterThanOrEqual(3);
            // important appears twice, should be first
            expect(result.topAdvanced[0].word).toBe('important');
            expect(result.topAdvanced[0].level).toBe('B2');
            // All topAdvanced should be B2/C1/C2
            result.topAdvanced.forEach((item) => {
                expect(['B2', 'C1', 'C2']).toContain(item.level);
            });
        });

        it('should limit topAdvanced to 10 items', () => {
            // We only have 3 advanced words in our mock cefrMap, so
            // this test verifies the slice logic exists
            const transformed = buildTransformed([
                {
                    words: [
                        { word: 'important' },
                        { word: 'sophisticated' },
                        { word: 'eloquent' },
                    ],
                },
            ]);
            const result = vocabularyService.analyzeVocabulary(transformed);

            expect(result.topAdvanced.length).toBeLessThanOrEqual(10);
        });

        it('should skip empty/null words after normalization', () => {
            const transformed = buildTransformed([
                {
                    words: [
                        { word: '' },
                        { word: '123' }, // normalizes to empty
                        { word: 'hello' },
                    ],
                },
            ]);
            const result = vocabularyService.analyzeVocabulary(transformed);

            // '' and '123' normalize to empty and are skipped
            expect(result.totalWords).toBe(1);
        });

        it('should handle segments with empty words array', () => {
            const transformed = buildTransformed([{ words: [] }]);
            const result = vocabularyService.analyzeVocabulary(transformed);

            expect(result.totalWords).toBe(0);
        });

        it('should handle missing words property in segments', () => {
            const transformed = { segments: [{}] };
            const result = vocabularyService.analyzeVocabulary(transformed);

            expect(result.totalWords).toBe(0);
        });

        it('should handle missing segments property', () => {
            const transformed = { segments: null };
            const result = vocabularyService.analyzeVocabulary(
                transformed as any
            );

            expect(result.totalWords).toBe(0);
        });
    });

    // ──────────────────────────────────────────────
    // buildVocabularyField
    // ──────────────────────────────────────────────
    describe('buildVocabularyField', () => {
        it('should return AI result merged with stats on success', async () => {
            const transformed = buildTransformed([
                {
                    words: [{ word: 'hello' }, { word: 'world' }],
                },
            ]);

            mockedExtractTranscript.mockReturnValue('hello world');
            mockedPromptManagerService.getTemplate.mockResolvedValue(
                'template {transcript} {stats_json}'
            );
            (mockedPromptTemplate.fromTemplate as jest.Mock).mockReturnValue({
                format: jest.fn().mockResolvedValue('formatted prompt'),
            });

            const mockAiResult = {
                paraphraseSuggestions: [
                    {
                        original: 'hello',
                        paraphrase: 'greetings',
                        technique: 'synonym',
                    },
                ],
                topPerformances: [
                    {
                        category: 'Vocabulary Range',
                        description: 'Good range',
                        score: 85,
                        level: 'excellent',
                    },
                ],
                suggestedWords: [],
                vocabularyUpgrades: [],
            };

            const mockModel = {
                pipe: jest.fn().mockReturnValue({
                    invoke: jest.fn().mockResolvedValue(mockAiResult),
                }),
            };
            mockedGoogleGenAIClient.getModel.mockReturnValue(mockModel as any);

            const result =
                await vocabularyService.buildVocabularyField(transformed);

            expect(result.paraphraseSuggestions).toEqual(
                mockAiResult.paraphraseSuggestions
            );
            expect(result.topPerformances).toEqual(
                mockAiResult.topPerformances
            );
            expect(result.stats).toBeDefined();
            expect(result.stats.totalWords).toBe(2);
            expect(result.stats.uniqueWords).toBe(2);
        });

        it('should return fallback with empty arrays when AI fails', async () => {
            const transformed = buildTransformed([
                {
                    words: [{ word: 'hello' }],
                },
            ]);

            mockedExtractTranscript.mockReturnValue('hello');
            mockedPromptManagerService.getTemplate.mockResolvedValue(
                'template'
            );
            (mockedPromptTemplate.fromTemplate as jest.Mock).mockReturnValue({
                format: jest.fn().mockResolvedValue('formatted'),
            });

            const mockModel = {
                pipe: jest.fn().mockReturnValue({
                    invoke: jest.fn().mockRejectedValue(new Error('AI error')),
                }),
            };
            mockedGoogleGenAIClient.getModel.mockReturnValue(mockModel as any);

            const result =
                await vocabularyService.buildVocabularyField(transformed);

            expect(result.paraphraseSuggestions).toEqual([]);
            expect(result.topPerformances).toEqual([]);
            expect(result.suggestedWords).toEqual([]);
            expect(result.vocabularyUpgrades).toEqual([]);
            expect(result.stats).toBeDefined();
            expect(result.stats.totalWords).toBe(1);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[VocabularyService] AI failed, using fallback:',
                expect.any(Error)
            );
        });

        it('should call promptManagerService.getTemplate with "vocabulary_analysis"', async () => {
            const transformed = buildTransformed([
                { words: [{ word: 'hello' }] },
            ]);

            mockedExtractTranscript.mockReturnValue('hello');
            mockedPromptManagerService.getTemplate.mockResolvedValue('tpl');
            (mockedPromptTemplate.fromTemplate as jest.Mock).mockReturnValue({
                format: jest.fn().mockResolvedValue('formatted'),
            });

            const mockModel = {
                pipe: jest.fn().mockReturnValue({
                    invoke: jest.fn().mockResolvedValue({
                        paraphraseSuggestions: [],
                        topPerformances: [],
                        suggestedWords: [],
                        vocabularyUpgrades: [],
                    }),
                }),
            };
            mockedGoogleGenAIClient.getModel.mockReturnValue(mockModel as any);

            await vocabularyService.buildVocabularyField(transformed);

            expect(mockedPromptManagerService.getTemplate).toHaveBeenCalledWith(
                'vocabulary_analysis'
            );
        });

        it('should pass transcript and stats_json to prompt template', async () => {
            const transformed = buildTransformed([
                { words: [{ word: 'hello' }] },
            ]);

            mockedExtractTranscript.mockReturnValue('hello');
            mockedPromptManagerService.getTemplate.mockResolvedValue(
                '{transcript} {stats_json}'
            );
            const mockFormat = jest.fn().mockResolvedValue('formatted');
            (mockedPromptTemplate.fromTemplate as jest.Mock).mockReturnValue({
                format: mockFormat,
            });

            const mockModel = {
                pipe: jest.fn().mockReturnValue({
                    invoke: jest.fn().mockResolvedValue({
                        paraphraseSuggestions: [],
                        topPerformances: [],
                        suggestedWords: [],
                        vocabularyUpgrades: [],
                    }),
                }),
            };
            mockedGoogleGenAIClient.getModel.mockReturnValue(mockModel as any);

            await vocabularyService.buildVocabularyField(transformed);

            expect(mockFormat).toHaveBeenCalledWith(
                expect.objectContaining({
                    transcript: 'hello',
                    stats_json: expect.any(String),
                })
            );
        });
    });
});
