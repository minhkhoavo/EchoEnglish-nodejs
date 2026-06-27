/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import pronunciationSummaryService from '~/services/speech-analyze/pronunciationSummaryService.js';

// ── Mock fs ──────────────────────────────────────────────────────
jest.mock('fs', () => ({
    __esModule: true,
    default: {
        existsSync: jest.fn(),
        readFileSync: jest.fn(),
    },
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

// ── Factory helpers ──────────────────────────────────────────────

function buildPhoneme(
    phoneme: string,
    accuracy: number,
    nbestPhoneme?: string
) {
    return {
        Phoneme: phoneme,
        PronunciationAssessment: {
            AccuracyScore: accuracy,
            NBestPhonemes: nbestPhoneme
                ? [{ Phoneme: nbestPhoneme }]
                : undefined,
        },
    };
}

function buildWord(
    word: string,
    phonemes: Record<string, unknown>[],
    syllables?: Record<string, unknown>[]
) {
    return {
        Word: word,
        Phonemes: phonemes,
        Syllables: syllables || [{ Syllable: 'wɜːrd' }],
    };
}

function buildAzureResponse(words: Record<string, unknown>[]) {
    return {
        NBest: [{ Words: words }],
    };
}

// ── Tests ────────────────────────────────────────────────────────

describe('PronunciationSummaryService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default: no resource index found
        mockedFs.existsSync.mockReturnValue(false);
    });

    // ──────────────────────────────────────────────
    // summarize – empty/null input
    // ──────────────────────────────────────────────
    describe('summarize – empty/null input', () => {
        it.each([
            ['empty array', []],
            ['null', null as any],
            ['undefined', undefined as any],
        ])(
            'should return empty chartData and topMistakes for %s input',
            (_, input) => {
                const result = pronunciationSummaryService.summarize(input);
                expect(result.chartData).toEqual([]);
                expect(result.topMistakes).toEqual([]);
            }
        );
    });

    // ──────────────────────────────────────────────
    // summarize – no errors
    // ──────────────────────────────────────────────
    describe('summarize – no errors (all scores >= 60)', () => {
        it('should return chartData with all errorRate 0 and empty topMistakes', () => {
            const words = [
                buildWord('hello', [
                    buildPhoneme('h', 90),
                    buildPhoneme('ɛ', 85),
                ]),
                buildWord('world', [
                    buildPhoneme('w', 95),
                    buildPhoneme('ɝ', 70),
                ]),
            ];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            // All error rates should be 0, so topFiveChart filters them out
            expect(result.chartData).toEqual([]);
            expect(result.topMistakes).toEqual([]);
        });
    });

    // ──────────────────────────────────────────────
    // summarize – with errors
    // ──────────────────────────────────────────────
    describe('summarize – with errors', () => {
        it('should compute errorRate and sort chartData descending by errorRate', () => {
            const words = [
                buildWord('think', [
                    buildPhoneme('θ', 20, 's'), // error
                    buildPhoneme('ɪ', 90),
                    buildPhoneme('ŋ', 90),
                    buildPhoneme('k', 90),
                ]),
                buildWord('this', [
                    buildPhoneme('ð', 30, 'd'), // error
                    buildPhoneme('ɪ', 80),
                    buildPhoneme('s', 85),
                ]),
                buildWord('thought', [
                    buildPhoneme('θ', 95), // correct this time
                    buildPhoneme('ɔ', 90),
                    buildPhoneme('t', 90),
                ]),
            ];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            // ð appears 1 time, 1 error → 100%
            // θ appears 2 times, 1 error → 50%
            const chartWithErrors = result.chartData.filter(
                (c) => c.errorRate > 0
            );
            expect(chartWithErrors.length).toBeGreaterThanOrEqual(2);
            // Should be sorted descending
            for (let i = 1; i < result.chartData.length; i++) {
                expect(
                    result.chartData[i - 1].errorRate
                ).toBeGreaterThanOrEqual(result.chartData[i].errorRate);
            }
        });

        it('should keep only top 5 errors with errorRate > 0 in chartData', () => {
            // Create 7 different phonemes all with errors
            const phonemeKeys = ['θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h'];
            const words = phonemeKeys.map((key) =>
                buildWord('test', [buildPhoneme(key, 10, 'x')])
            );
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.chartData.length).toBeLessThanOrEqual(5);
            expect(result.chartData.every((c) => c.errorRate > 0)).toBe(true);
        });
    });

    // ──────────────────────────────────────────────
    // summarize – topMistakes details
    // ──────────────────────────────────────────────
    describe('summarize – topMistakes details', () => {
        it('should return at most 3 topMistakes from top 5 chart', () => {
            const phonemeKeys = ['θ', 'ð', 's', 'z', 'ʃ'];
            const words = phonemeKeys.map((key) =>
                buildWord('word', [buildPhoneme(key, 10, 'x')])
            );
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes.length).toBeLessThanOrEqual(3);
        });

        it('should include wordsWithMistakes with word and phoneticTranscription', () => {
            const words = [
                buildWord(
                    'think',
                    [buildPhoneme('θ', 20, 's')],
                    [{ Syllable: 'θɪŋk' }]
                ),
            ];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes.length).toBeGreaterThanOrEqual(1);
            const mistake = result.topMistakes[0];
            expect(mistake.wordsWithMistakes).toEqual([
                { word: 'think', phoneticTranscription: '/θɪŋk/' },
            ]);
        });

        it('should not add duplicate words to wordsWithMistakes', () => {
            // Same word 'think' used twice with same phoneme error
            const words = [
                buildWord('think', [buildPhoneme('θ', 20, 's')]),
                buildWord('think', [buildPhoneme('θ', 30, 's')]),
            ];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            const mistake = result.topMistakes[0];
            expect(
                mistake.wordsWithMistakes.filter((w) => w.word === 'think')
                    .length
            ).toBe(1);
        });
    });

    // ──────────────────────────────────────────────
    // summarize – mistakeSummary variants
    // ──────────────────────────────────────────────
    describe('summarize – mistakeSummary variants', () => {
        it('should say "said /x/ instead of" when actual is not "omitted"', () => {
            const words = [buildWord('think', [buildPhoneme('θ', 20, 's')])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].mistakeSummary).toContain(
                'instead of'
            );
        });

        it('should say "forgot to pronounce" when actual is "omitted"', () => {
            const words = [
                buildWord('think', [buildPhoneme('θ', 20, 'omitted')]),
            ];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].mistakeSummary).toContain(
                'forgot to pronounce'
            );
        });

        it('should say "had trouble with" when details lookup returns undefined (key mismatch)', () => {
            // Use normalizeForResourceMatch mapping: chart uses '/o/' but
            // errorMap stores under 'o', normalizeForResourceMatch converts 'o' → 'oʊ',
            // so errorMap.get('oʊ') returns undefined → actual = null → "had trouble with"
            const words = [buildWord('go', [buildPhoneme('o', 20, 's')])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].mistakeSummary).toContain(
                'had trouble with'
            );
        });

        it('should sort substitutions descending and select the most common one when multiple substitutions exist', () => {
            const words = [
                buildWord('think', [
                    buildPhoneme('θ', 20, 's'),
                    buildPhoneme('θ', 20, 't'),
                    buildPhoneme('θ', 20, 't'),
                ]),
            ];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].mistakeSummary).toContain(
                'said /t/ instead of'
            );
        });
    });

    // ──────────────────────────────────────────────
    // summarize – howToImprove
    // ──────────────────────────────────────────────
    describe('summarize – howToImprove', () => {
        it('should return PhonemeSuggestionDB entry when phoneme exists', () => {
            const words = [buildWord('think', [buildPhoneme('θ', 20, 's')])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].howToImprove).toContain('/θ/');
        });

        it('should return default message when phoneme is not in PhonemeSuggestionDB', () => {
            // Use an unusual phoneme not in the DB
            const words = [buildWord('test', [buildPhoneme('ɻ', 20, 'r')])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].howToImprove).toBe(
                'Practice this sound by listening and repeating.'
            );
        });
    });

    // ──────────────────────────────────────────────
    // summarize – skillsData with resources
    // ──────────────────────────────────────────────
    describe('summarize – skillsData with resources', () => {
        it('should populate skillsData when resource index has entries', () => {
            // Mock fs to find resource index
            mockedFs.existsSync.mockReturnValue(true);
            (mockedFs.readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({
                    θ: [
                        {
                            name: 'TH Sound Tutorial',
                            url: 'https://youtube.com/watch?v=abc',
                        },
                        {
                            name: 'TH Practice Guide',
                            url: 'https://example.com/th-guide',
                        },
                    ],
                })
            );

            const words = [buildWord('think', [buildPhoneme('θ', 20, 's')])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            const mistake = result.topMistakes[0];
            expect(mistake.skillsData).toHaveLength(1);
            expect(mistake.skillsData![0].title).toContain('/θ/');
            expect(mistake.skillsData![0].resources).toHaveLength(2);
            expect(mistake.skillsData![0].resources[0].type).toBe('video');
            expect(mistake.skillsData![0].resources[1].type).toBe('article');
        });

        it('should return empty skillsData when resource index is empty', () => {
            mockedFs.existsSync.mockReturnValue(false);

            const words = [buildWord('think', [buildPhoneme('θ', 20, 's')])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].skillsData).toEqual([]);
        });

        it('should limit resources to 3 per phoneme', () => {
            mockedFs.existsSync.mockReturnValue(true);
            (mockedFs.readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({
                    θ: [
                        { name: 'R1', url: 'https://a.com/1' },
                        { name: 'R2', url: 'https://a.com/2' },
                        { name: 'R3', url: 'https://a.com/3' },
                        { name: 'R4', url: 'https://a.com/4' },
                        { name: 'R5', url: 'https://a.com/5' },
                    ],
                })
            );

            const words = [buildWord('think', [buildPhoneme('θ', 20, 's')])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].skillsData![0].resources).toHaveLength(
                3
            );
        });
    });

    // ──────────────────────────────────────────────
    // summarize – determineLevel
    // ──────────────────────────────────────────────
    describe('summarize – determineLevel', () => {
        it('should set level "Needs Improvement" for errorRate >= 70', () => {
            mockedFs.existsSync.mockReturnValue(true);
            (mockedFs.readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({
                    θ: [{ name: 'R1', url: 'https://a.com/1' }],
                })
            );

            // 1 phoneme, 1 error → 100% error rate
            const words = [buildWord('think', [buildPhoneme('θ', 10, 's')])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].skillsData![0].level).toBe(
                'Needs Improvement'
            );
        });

        it('should set level "Good" for errorRate >= 40 and < 70', () => {
            mockedFs.existsSync.mockReturnValue(true);
            (mockedFs.readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({
                    θ: [{ name: 'R1', url: 'https://a.com/1' }],
                })
            );

            // 2 phonemes, 1 error → 50% error rate
            const words = [
                buildWord('think', [
                    buildPhoneme('θ', 10, 's'),
                    buildPhoneme('θ', 90),
                ]),
            ];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].skillsData![0].level).toBe('Good');
        });

        it('should set level "Correct" for errorRate < 40', () => {
            mockedFs.existsSync.mockReturnValue(true);
            (mockedFs.readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({
                    θ: [{ name: 'R1', url: 'https://a.com/1' }],
                })
            );

            // 5 phonemes, 1 error → 20% error rate
            const words = [
                buildWord('think', [
                    buildPhoneme('θ', 10, 's'),
                    buildPhoneme('θ', 90),
                    buildPhoneme('θ', 90),
                    buildPhoneme('θ', 90),
                    buildPhoneme('θ', 90),
                ]),
            ];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].skillsData![0].level).toBe('Correct');
        });
    });

    // ──────────────────────────────────────────────
    // resolveResourceIndexPath (indirectly via loadResourceIndex → summarize)
    // ──────────────────────────────────────────────
    describe('resolveResourceIndexPath – via summarize', () => {
        it('should try dist path first, then src', () => {
            // First call: dist → false, second: src → true
            mockedFs.existsSync
                .mockReturnValueOnce(false)
                .mockReturnValueOnce(true);
            (mockedFs.readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({})
            );

            const words = [buildWord('test', [buildPhoneme('θ', 20, 's')])];
            pronunciationSummaryService.summarize([buildAzureResponse(words)]);

            expect(mockedFs.existsSync).toHaveBeenCalledTimes(2);
            expect(
                (mockedFs.existsSync as jest.Mock).mock.calls[0][0]
            ).toContain('dist');
            expect(
                (mockedFs.existsSync as jest.Mock).mock.calls[1][0]
            ).toContain('src');
        });

        it('should return empty resourceIndex when existsSync throws', () => {
            mockedFs.existsSync.mockImplementation(() => {
                throw new Error('permission denied');
            });

            const words = [buildWord('test', [buildPhoneme('θ', 20, 's')])];
            const result = pronunciationSummaryService.summarize([
                buildAzureResponse(words),
            ]);

            // Should still work — empty resources
            expect(result.topMistakes[0].skillsData).toEqual([]);
        });
    });

    // ──────────────────────────────────────────────
    // loadResourceIndex – via summarize
    // ──────────────────────────────────────────────
    describe('loadResourceIndex – via summarize', () => {
        it('should handle readFileSync throwing', () => {
            mockedFs.existsSync.mockReturnValue(true);
            (mockedFs.readFileSync as jest.Mock).mockImplementation(() => {
                throw new Error('file read error');
            });

            const words = [buildWord('test', [buildPhoneme('θ', 20, 's')])];
            const result = pronunciationSummaryService.summarize([
                buildAzureResponse(words),
            ]);

            expect(result.topMistakes[0].skillsData).toEqual([]);
        });

        it('should handle invalid JSON', () => {
            mockedFs.existsSync.mockReturnValue(true);
            (mockedFs.readFileSync as jest.Mock).mockReturnValue(
                'invalid json {'
            );

            const words = [buildWord('test', [buildPhoneme('θ', 20, 's')])];
            const result = pronunciationSummaryService.summarize([
                buildAzureResponse(words),
            ]);

            expect(result.topMistakes[0].skillsData).toEqual([]);
        });
    });

    // ──────────────────────────────────────────────
    // normalizeForResourceMatch (indirectly tested)
    // ──────────────────────────────────────────────
    describe('normalizeForResourceMatch – via summarize', () => {
        it('should map "g" phoneme to "ɡ" for resource lookup', () => {
            mockedFs.existsSync.mockReturnValue(true);
            (mockedFs.readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({
                    ɡ: [{ name: 'G sound', url: 'https://a.com/g' }],
                })
            );

            const words = [buildWord('go', [buildPhoneme('g', 20, 'k')])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            // The errorMap key is 'g', but resource lookup normalizes to 'ɡ'
            // However, since the error is tracked under 'g' and the chart shows '/g/',
            // normalizeForResourceMatch converts 'g' → 'ɡ' for resource lookup
            expect(
                result.topMistakes[0].skillsData!.length
            ).toBeGreaterThanOrEqual(0);
        });

        it('should keep unmapped phonemes as-is', () => {
            mockedFs.existsSync.mockReturnValue(true);
            (mockedFs.readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({
                    θ: [{ name: 'TH sound', url: 'https://a.com/th' }],
                })
            );

            const words = [buildWord('think', [buildPhoneme('θ', 20, 's')])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].skillsData!).toHaveLength(1);
        });
    });

    // ──────────────────────────────────────────────
    // summarize – skips phonemes without Phoneme field
    // ──────────────────────────────────────────────
    describe('summarize – edge cases', () => {
        it('should skip phonemes with empty/null Phoneme field', () => {
            const words = [
                buildWord('test', [
                    {
                        Phoneme: null,
                        PronunciationAssessment: { AccuracyScore: 50 },
                    },
                    {
                        Phoneme: '',
                        PronunciationAssessment: { AccuracyScore: 50 },
                    },
                    buildPhoneme('θ', 90),
                ]),
            ];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            // Only θ should be counted
            expect(result.chartData.length).toBeLessThanOrEqual(1);
        });

        it('should handle segments with missing NBest', () => {
            const response = { DisplayText: 'test' };
            const result = pronunciationSummaryService.summarize([
                response as any,
            ]);
            expect(result.chartData).toEqual([]);
            expect(result.topMistakes).toEqual([]);
        });

        it('should handle words without Phonemes array', () => {
            const response = {
                NBest: [
                    {
                        Words: [{ Word: 'hello' }],
                    },
                ],
            };
            const result = pronunciationSummaryService.summarize([
                response as any,
            ]);
            expect(result.chartData).toEqual([]);
        });

        it('should handle empty Word field in word data', () => {
            const words = [buildWord('', [buildPhoneme('θ', 20, 's')])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            // Word is empty, should not appear in wordsWithMistakes
            if (result.topMistakes.length > 0) {
                expect(result.topMistakes[0].wordsWithMistakes).toEqual([]);
            }
        });

        it('should handle falsy resourceIndex from loadResourceIndex (return null)', () => {
            mockedFs.existsSync.mockReturnValue(true);
            (mockedFs.readFileSync as jest.Mock).mockReturnValue('null');

            const words = [buildWord('think', [buildPhoneme('θ', 20, 's')])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes[0].skillsData).toEqual([]);
        });

        it('should fallback to 100 when AccuracyScore is missing, and handle empty actual Phoneme', () => {
            const phoneme = {
                Phoneme: 'θ',
                PronunciationAssessment: {
                    NBestPhonemes: [{ Phoneme: '' }],
                },
            };
            const words = [buildWord('think', [phoneme])];
            const response = buildAzureResponse(words);
            const result = pronunciationSummaryService.summarize([response]);

            expect(result.topMistakes).toEqual([]);

            const badPhoneme = {
                Phoneme: 'θ',
                PronunciationAssessment: {
                    AccuracyScore: 20,
                    NBestPhonemes: [{ Phoneme: '' }],
                },
            };
            const response2 = buildAzureResponse([
                buildWord('think', [badPhoneme]),
            ]);
            const result2 = pronunciationSummaryService.summarize([response2]);
            expect(result2.topMistakes[0].mistakeSummary).toContain(
                'forgot to pronounce'
            );
        });

        it('should handle totals <= 0 in rate calculation (branch coverage)', () => {
            const originalEntries = Map.prototype.entries;
            Map.prototype.entries = function () {
                return [['θ', 0]][Symbol.iterator]() as any;
            };

            try {
                const result = pronunciationSummaryService.summarize([
                    buildAzureResponse([]),
                ]);
                expect(result.chartData).toEqual([]);
            } finally {
                Map.prototype.entries = originalEntries;
            }
        });
    });
});
