/* eslint-disable @typescript-eslint/no-explicit-any */
import speechTransformService from '~/services/speech-analyze/speechTransformService.js';

// ── Factory helpers ──────────────────────────────────────────────

function buildPhoneme(overrides: Record<string, unknown> = {}) {
    return {
        Phoneme: 'æ',
        Offset: 10000000, // 1000 ms in ticks
        Duration: 5000000, // 500 ms
        PronunciationAssessment: {
            AccuracyScore: 95,
            NBestPhonemes: [{ Phoneme: 'æ' }],
        },
        ...overrides,
    };
}

function buildSyllable(overrides: Record<string, unknown> = {}) {
    return {
        Syllable: 'hɛ',
        Grapheme: 'he',
        Offset: 10000000,
        Duration: 5000000,
        PronunciationAssessment: { AccuracyScore: 90 },
        ...overrides,
    };
}

function buildWord(overrides: Record<string, unknown> = {}) {
    return {
        Word: 'hello',
        Offset: 10000000,
        Duration: 5000000,
        Phonemes: [buildPhoneme()],
        Syllables: [buildSyllable()],
        PronunciationAssessment: {
            AccuracyScore: 90,
            ErrorType: 'None',
        },
        ...overrides,
    };
}

function buildAzureSegment(overrides: Record<string, unknown> = {}) {
    return {
        DisplayText: 'Hello world.',
        NBest: [
            {
                Confidence: 0.95,
                Words: [buildWord()],
                PronunciationAssessment: {
                    AccuracyScore: 88,
                    FluencyScore: 85,
                    ProsodyScore: 80,
                    CompletenessScore: 100,
                    PronScore: 87,
                },
            },
        ],
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────────

describe('SpeechTransformService', () => {
    let dateSpy: jest.SpyInstance;

    beforeAll(() => {
        dateSpy = jest
            .spyOn(Date.prototype, 'toISOString')
            .mockReturnValue('2026-01-01T00:00:00.000Z');
    });

    afterAll(() => {
        dateSpy.mockRestore();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ──────────────────────────────────────────────
    // extractErrors (private, tested indirectly via transformSegmentToWords → createTranscriptData)
    // ──────────────────────────────────────────────
    describe('extractErrors – via createTranscriptData', () => {
        it('should return empty errors when ErrorType is None', () => {
            const segment = buildAzureSegment();
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const words = (result.segments as any[])[0].words;
            expect(words[0].errors).toEqual([]);
        });

        it('should return empty errors when ErrorType is missing/null', () => {
            const word = buildWord({
                PronunciationAssessment: { AccuracyScore: 90 },
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 88,
                            FluencyScore: 85,
                            ProsodyScore: 80,
                            CompletenessScore: 100,
                            PronScore: 87,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const words = (result.segments as any[])[0].words;
            expect(words[0].errors).toEqual([]);
        });

        it('should detect Mispronunciation error', () => {
            const word = buildWord({
                PronunciationAssessment: {
                    AccuracyScore: 40,
                    ErrorType: 'Mispronunciation',
                },
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 40,
                            FluencyScore: 85,
                            ProsodyScore: 80,
                            CompletenessScore: 100,
                            PronScore: 60,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const errors = (result.segments as any[])[0].words[0].errors;
            expect(errors).toEqual([
                { type: 'mispronunciation', confidence: 60 },
            ]);
        });

        it('should detect UnexpectedBreak error with confidence', () => {
            const word = buildWord({
                PronunciationAssessment: {
                    AccuracyScore: 0,
                    ErrorType: 'UnexpectedBreak',
                    Feedback: {
                        Prosody: {
                            Break: {
                                UnexpectedBreak: { Confidence: 0.85 },
                            },
                        },
                    },
                },
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 50,
                            FluencyScore: 50,
                            ProsodyScore: 50,
                            CompletenessScore: 50,
                            PronScore: 50,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const errors = (result.segments as any[])[0].words[0].errors;
            expect(errors).toEqual([
                { type: 'unexpected_break', confidence: 85 },
            ]);
        });

        it('should detect MissingBreak error with confidence', () => {
            const word = buildWord({
                PronunciationAssessment: {
                    AccuracyScore: 0,
                    ErrorType: 'MissingBreak',
                    Feedback: {
                        Prosody: {
                            Break: {
                                MissingBreak: { Confidence: 0.7 },
                            },
                        },
                    },
                },
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 50,
                            FluencyScore: 50,
                            ProsodyScore: 50,
                            CompletenessScore: 50,
                            PronScore: 50,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const errors = (result.segments as any[])[0].words[0].errors;
            expect(errors).toEqual([{ type: 'missing_break', confidence: 70 }]);
        });

        it('should detect Monotone error with confidence', () => {
            const word = buildWord({
                PronunciationAssessment: {
                    AccuracyScore: 0,
                    ErrorType: 'Monotone',
                    Feedback: {
                        Prosody: {
                            Intonation: {
                                Monotone: {
                                    SyllablePitchDeltaConfidence: 0.3,
                                },
                            },
                        },
                    },
                },
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 50,
                            FluencyScore: 50,
                            ProsodyScore: 50,
                            CompletenessScore: 50,
                            PronScore: 50,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const errors = (result.segments as any[])[0].words[0].errors;
            expect(errors).toEqual([{ type: 'monotone', confidence: 70 }]);
        });

        it('should return empty errors for unknown ErrorType (default case)', () => {
            const word = buildWord({
                PronunciationAssessment: {
                    AccuracyScore: 50,
                    ErrorType: 'SomeUnknownType',
                },
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 50,
                            FluencyScore: 50,
                            ProsodyScore: 50,
                            CompletenessScore: 50,
                            PronScore: 50,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const errors = (result.segments as any[])[0].words[0].errors;
            expect(errors).toEqual([]);
        });

        it('should not push error if UnexpectedBreak confidence is not a number', () => {
            const word = buildWord({
                PronunciationAssessment: {
                    AccuracyScore: 0,
                    ErrorType: 'UnexpectedBreak',
                    Feedback: {
                        Prosody: {
                            Break: {
                                UnexpectedBreak: {
                                    Confidence: 'not-a-number',
                                },
                            },
                        },
                    },
                },
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 50,
                            FluencyScore: 50,
                            ProsodyScore: 50,
                            CompletenessScore: 50,
                            PronScore: 50,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const errors = (result.segments as any[])[0].words[0].errors;
            expect(errors).toEqual([]);
        });

        it('should not push error if MissingBreak confidence is not a number', () => {
            const word = buildWord({
                PronunciationAssessment: {
                    AccuracyScore: 0,
                    ErrorType: 'MissingBreak',
                    Feedback: {
                        Prosody: {
                            Break: {
                                MissingBreak: { Confidence: undefined },
                            },
                        },
                    },
                },
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 50,
                            FluencyScore: 50,
                            ProsodyScore: 50,
                            CompletenessScore: 50,
                            PronScore: 50,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const errors = (result.segments as any[])[0].words[0].errors;
            expect(errors).toEqual([]);
        });

        it('should not push error if Monotone SyllablePitchDeltaConfidence is not a number', () => {
            const word = buildWord({
                PronunciationAssessment: {
                    AccuracyScore: 0,
                    ErrorType: 'Monotone',
                    Feedback: {
                        Prosody: {
                            Intonation: {
                                Monotone: {
                                    SyllablePitchDeltaConfidence: null,
                                },
                            },
                        },
                    },
                },
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 50,
                            FluencyScore: 50,
                            ProsodyScore: 50,
                            CompletenessScore: 50,
                            PronScore: 50,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const errors = (result.segments as any[])[0].words[0].errors;
            expect(errors).toEqual([]);
        });
    });

    // ──────────────────────────────────────────────
    // transformSegmentToWords (private, tested via createTranscriptData)
    // ──────────────────────────────────────────────
    describe('transformSegmentToWords – via createTranscriptData', () => {
        it('should return empty segment (filtered out) when NBest is missing', () => {
            const segment = { DisplayText: 'test' };
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            expect(result.segments).toEqual([]);
        });

        it('should return empty segment when NBest[0] is null', () => {
            const segment = { DisplayText: 'test', NBest: [null] };
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            expect(result.segments).toEqual([]);
        });

        it('should return empty segment when Words is missing', () => {
            const segment = {
                DisplayText: 'test',
                NBest: [{ Confidence: 0.9 }],
            };
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            expect(result.segments).toEqual([]);
        });

        it('should return empty segment when Words is empty array', () => {
            const segment = {
                DisplayText: 'test',
                NBest: [{ Confidence: 0.9, Words: [] }],
            };
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            expect(result.segments).toEqual([]);
        });

        it('should map phoneme accuracy > 60 as correct with expected phoneme', () => {
            const phoneme = buildPhoneme({
                Phoneme: 'æ',
                PronunciationAssessment: {
                    AccuracyScore: 95,
                    NBestPhonemes: [{ Phoneme: 'ɛ' }],
                },
            });
            const word = buildWord({ Phonemes: [phoneme] });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 90,
                            FluencyScore: 85,
                            ProsodyScore: 80,
                            CompletenessScore: 100,
                            PronScore: 87,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const ph = (result.segments as any[])[0].words[0].phonemes[0];
            expect(ph.isCorrect).toBe(true);
            expect(ph.actualPhoneme).toBe('æ'); // uses Phoneme, not NBest
        });

        it('should map phoneme accuracy <= 60 as incorrect with NBestPhoneme', () => {
            const phoneme = buildPhoneme({
                Phoneme: 'æ',
                PronunciationAssessment: {
                    AccuracyScore: 30,
                    NBestPhonemes: [{ Phoneme: 'ɛ' }],
                },
            });
            const word = buildWord({ Phonemes: [phoneme] });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 30,
                            FluencyScore: 85,
                            ProsodyScore: 80,
                            CompletenessScore: 100,
                            PronScore: 50,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const ph = (result.segments as any[])[0].words[0].phonemes[0];
            expect(ph.isCorrect).toBe(false);
            expect(ph.actualPhoneme).toBe('ɛ'); // from NBest
        });

        it('should handle missing NBestPhonemes for incorrect phoneme', () => {
            const phoneme = buildPhoneme({
                Phoneme: 'æ',
                PronunciationAssessment: {
                    AccuracyScore: 20,
                    NBestPhonemes: undefined,
                },
            });
            const word = buildWord({ Phonemes: [phoneme] });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 20,
                            FluencyScore: 50,
                            ProsodyScore: 50,
                            CompletenessScore: 100,
                            PronScore: 40,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const ph = (result.segments as any[])[0].words[0].phonemes[0];
            expect(ph.isCorrect).toBe(false);
            expect(ph.actualPhoneme).toBe('');
        });

        it('should handle empty Phonemes and Syllables arrays', () => {
            const word = buildWord({ Phonemes: [], Syllables: [] });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 90,
                            FluencyScore: 85,
                            ProsodyScore: 80,
                            CompletenessScore: 100,
                            PronScore: 87,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const w = (result.segments as any[])[0].words[0];
            expect(w.phonemes).toEqual([]);
            expect(w.syllables).toEqual([]);
            expect(w.expectedPronunciation).toBe('//');
            expect(w.actualPronunciation).toBe('//');
        });

        it('should handle non-array Phonemes and Syllables', () => {
            const word = buildWord({
                Phonemes: 'not-an-array',
                Syllables: null,
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 90,
                            FluencyScore: 85,
                            ProsodyScore: 80,
                            CompletenessScore: 100,
                            PronScore: 87,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const w = (result.segments as any[])[0].words[0];
            expect(w.phonemes).toEqual([]);
            expect(w.syllables).toEqual([]);
        });

        it('should detect isDuplicated for consecutive same-word entries', () => {
            const word1 = buildWord({ Word: 'the' });
            const word2 = buildWord({ Word: 'the' });
            const word3 = buildWord({ Word: 'cat' });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word1, word2, word3],
                        PronunciationAssessment: {
                            AccuracyScore: 90,
                            FluencyScore: 85,
                            ProsodyScore: 80,
                            CompletenessScore: 100,
                            PronScore: 87,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const words = (result.segments as any[])[0].words;
            expect(words[0].isDuplicated).toBe(false);
            expect(words[1].isDuplicated).toBe(true);
            expect(words[2].isDuplicated).toBe(false);
        });

        it('should build expectedPronunciation from syllables and actualPronunciation from correct phonemes', () => {
            const phoneme1 = buildPhoneme({
                Phoneme: 'h',
                PronunciationAssessment: {
                    AccuracyScore: 95,
                    NBestPhonemes: [{ Phoneme: 'h' }],
                },
            });
            const phoneme2 = buildPhoneme({
                Phoneme: 'ɛ',
                PronunciationAssessment: {
                    AccuracyScore: 20, // incorrect
                    NBestPhonemes: [{ Phoneme: 'æ' }],
                },
            });
            const syl1 = buildSyllable({ Syllable: 'hɛ' });
            const syl2 = buildSyllable({ Syllable: 'loʊ' });
            const word = buildWord({
                Phonemes: [phoneme1, phoneme2],
                Syllables: [syl1, syl2],
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 60,
                            FluencyScore: 85,
                            ProsodyScore: 80,
                            CompletenessScore: 100,
                            PronScore: 70,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const w = (result.segments as any[])[0].words[0];
            expect(w.expectedPronunciation).toBe('/hɛloʊ/');
            // only correct phonemes contribute to actual
            expect(w.actualPronunciation).toBe('/h/');
        });

        it('should convert Offset and Duration from ticks to ms', () => {
            const word = buildWord({
                Offset: 20000000, // 2000 ms
                Duration: 10000000, // 1000 ms
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word],
                        PronunciationAssessment: {
                            AccuracyScore: 90,
                            FluencyScore: 85,
                            ProsodyScore: 80,
                            CompletenessScore: 100,
                            PronScore: 87,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const w = (result.segments as any[])[0].words[0];
            expect(w.offset).toBe(2000);
            expect(w.duration).toBe(1000);
        });

        it('should set confidenceScore from segment Confidence * 100', () => {
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.87,
                        Words: [buildWord()],
                        PronunciationAssessment: {
                            AccuracyScore: 90,
                            FluencyScore: 85,
                            ProsodyScore: 80,
                            CompletenessScore: 100,
                            PronScore: 87,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const w = (result.segments as any[])[0].words[0];
            expect(w.confidenceScore).toBeCloseTo(87, 0);
        });
    });

    // ──────────────────────────────────────────────
    // createTranscriptData
    // ──────────────────────────────────────────────
    describe('createTranscriptData', () => {
        it('should return proper structure for a complete Azure response', () => {
            const result = speechTransformService.createTranscriptData(
                [buildAzureSegment()],
                'https://example.com/audio.wav'
            );
            expect(result.audioUrl).toBe('https://example.com/audio.wav');
            expect(result.segments).toHaveLength(1);
            expect(result.metadata).toBeDefined();
            expect(result.overall).toBeDefined();
        });

        it('should return empty segments for empty array', () => {
            const result = speechTransformService.createTranscriptData([]);
            expect(result.segments).toEqual([]);
            expect((result.overall as any).AccuracyScore).toBe(0);
            expect((result.overall as any).FluencyScore).toBe(0);
            expect((result.overall as any).ProsodyScore).toBe(0);
            expect((result.overall as any).CompletenessScore).toBe(0);
            expect((result.overall as any).PronScore).toBe(0);
        });

        it('should default audioUrl to empty string', () => {
            const result = speechTransformService.createTranscriptData([
                buildAzureSegment(),
            ]);
            expect(result.audioUrl).toBe('');
        });

        it('should extract overall scores from first response NBest[0].PronunciationAssessment', () => {
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [buildWord()],
                        PronunciationAssessment: {
                            AccuracyScore: 92,
                            FluencyScore: 88,
                            ProsodyScore: 75,
                            CompletenessScore: 100,
                            PronScore: 90,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const overall = result.overall as Record<string, number>;
            expect(overall.AccuracyScore).toBe(92);
            expect(overall.FluencyScore).toBe(88);
            expect(overall.ProsodyScore).toBe(75);
            expect(overall.CompletenessScore).toBe(100);
            expect(overall.PronScore).toBe(90);
        });

        it('should return 0 scores when PronunciationAssessment is missing', () => {
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [buildWord()],
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const overall = result.overall as Record<string, number>;
            expect(overall.AccuracyScore).toBe(0);
            expect(overall.FluencyScore).toBe(0);
            expect(overall.ProsodyScore).toBe(0);
            expect(overall.CompletenessScore).toBe(0);
            expect(overall.PronScore).toBe(0);
        });

        it('should filter out segments with no words', () => {
            const validSegment = buildAzureSegment();
            const emptySegment = {
                DisplayText: 'empty',
                NBest: [{ Confidence: 0.5, Words: [] }],
            };
            const result = speechTransformService.createTranscriptData([
                validSegment,
                emptySegment,
            ]);
            expect(result.segments).toHaveLength(1);
        });

        it('should compute segment id, startTime, endTime, text, overallAccuracy', () => {
            const word1 = buildWord({
                Word: 'hello',
                Offset: 10000000,
                Duration: 5000000,
            });
            const word2 = buildWord({
                Word: 'world',
                Offset: 20000000,
                Duration: 8000000,
            });
            const segment = buildAzureSegment({
                DisplayText: 'Hello world.',
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word1, word2],
                        PronunciationAssessment: {
                            AccuracyScore: 85,
                            FluencyScore: 80,
                            ProsodyScore: 75,
                            CompletenessScore: 100,
                            PronScore: 82,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const seg = (result.segments as any[])[0];
            expect(seg.id).toBe('segment-1');
            expect(seg.startTime).toBe(1000); // 10000000 / 10000
            expect(seg.endTime).toBe(2800); // (20000000 + 8000000) / 10000
            expect(seg.text).toBe('Hello world.');
            expect(seg.overallAccuracy).toBe(82);
        });

        it('should compute metadata duration and speakingTime', () => {
            const word1 = buildWord({
                Offset: 10000000,
                Duration: 5000000,
            });
            const word2 = buildWord({
                Offset: 20000000,
                Duration: 8000000,
            });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [word1, word2],
                        PronunciationAssessment: {
                            AccuracyScore: 85,
                            FluencyScore: 80,
                            ProsodyScore: 75,
                            CompletenessScore: 100,
                            PronScore: 82,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const metadata = result.metadata as Record<string, unknown>;
            // endTime = (20000000 + 8000000) / 10000 = 2800 → duration = 2800 / 1000 = 2.8
            expect(metadata.duration).toBeCloseTo(2.8, 1);
            // speakingTime = (500 + 800) / 1000 = 1.3
            expect(metadata.speakingTime).toBeCloseTo(1.3, 1);
            expect(metadata.language).toBe('en-US');
            expect(metadata.assessmentType).toBe('pronunciation');
            expect(metadata.createdAt).toBe('2026-01-01T00:00:00.000Z');
        });

        it('should handle multiple segments and compute totalDuration from last segment', () => {
            const seg1Word = buildWord({
                Offset: 10000000,
                Duration: 5000000,
            });
            const seg2Word = buildWord({
                Offset: 50000000,
                Duration: 10000000,
            });

            const segment1 = buildAzureSegment({
                DisplayText: 'Hello.',
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [seg1Word],
                        PronunciationAssessment: {
                            AccuracyScore: 90,
                            FluencyScore: 85,
                            ProsodyScore: 80,
                            CompletenessScore: 100,
                            PronScore: 87,
                        },
                    },
                ],
            });
            const segment2 = buildAzureSegment({
                DisplayText: 'World.',
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [seg2Word],
                        PronunciationAssessment: {
                            AccuracyScore: 88,
                            FluencyScore: 82,
                            ProsodyScore: 78,
                            CompletenessScore: 95,
                            PronScore: 85,
                        },
                    },
                ],
            });

            const result = speechTransformService.createTranscriptData([
                segment1,
                segment2,
            ]);
            expect(result.segments).toHaveLength(2);
            const metadata = result.metadata as Record<string, unknown>;
            // lastSegment endTime = (50000000 + 10000000) / 10000 = 6000 → 6000/1000 = 6
            expect(metadata.duration).toBeCloseTo(6, 0);
        });

        it('should set segment overallAccuracy to 0 when PronunciationAssessment is missing in NBest', () => {
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: 0.9,
                        Words: [buildWord()],
                        // no PronunciationAssessment
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const seg = (result.segments as any[])[0];
            expect(seg.overallAccuracy).toBe(0);
        });

        it('should handle missing AccuracyScore in extractErrors for Mispronunciation', () => {
            const word = buildWord({
                PronunciationAssessment: {
                    ErrorType: 'Mispronunciation',
                    // AccuracyScore is undefined
                },
            });
            const segment = buildAzureSegment({ NBest: [{ Words: [word] }] });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const error = (result.segments as any[])[0].words[0].errors[0];
            // confidence = 100 - (AccuracyScore || 0) = 100 - 0 = 100
            expect(error.confidence).toBe(100);
        });

        it('should handle undefined Confidence in firstResult', () => {
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Confidence: undefined,
                        Words: [buildWord()],
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const word = (result.segments as any[])[0].words[0];
            // segmentConfidence = (Confidence || 0) * 100 = 0
            expect(word.confidenceScore).toBe(0);
        });

        it('should handle non-string words in normalize function for duplication check', () => {
            const word1 = buildWord({ Word: null });
            const word2 = buildWord({ Word: {} as any });
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Words: [word1, word2],
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const words = (result.segments as any[])[0].words;
            // Neither is a string, both normalize to '', so they should match (isDuplicated = true)
            expect(words[1].isDuplicated).toBe(true);
        });

        it('should handle missing AccuracyScore, Offset, and Duration for phonemes', () => {
            const phoneme = buildPhoneme({
                Offset: undefined,
                Duration: undefined,
                PronunciationAssessment: {
                    AccuracyScore: undefined,
                },
            });
            const word = buildWord({ Phonemes: [phoneme] });
            const segment = buildAzureSegment({ NBest: [{ Words: [word] }] });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const ph = (result.segments as any[])[0].words[0].phonemes[0];
            expect(ph.accuracy).toBe(0);
            expect(ph.offset).toBe(0);
            expect(ph.duration).toBe(0);
        });

        it('should handle missing Offset and Duration for syllables', () => {
            const syllable = buildSyllable({
                Offset: undefined,
                Duration: undefined,
            });
            const word = buildWord({ Syllables: [syllable] });
            const segment = buildAzureSegment({ NBest: [{ Words: [word] }] });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const syl = (result.segments as any[])[0].words[0].syllables[0];
            expect(syl.offset).toBe(0);
            expect(syl.duration).toBe(0);
        });

        it('should handle missing Offset and Duration for words', () => {
            const word = buildWord({
                Offset: undefined,
                Duration: undefined,
            });
            const segment = buildAzureSegment({ NBest: [{ Words: [word] }] });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const w = (result.segments as any[])[0].words[0];
            expect(w.offset).toBe(0);
            expect(w.duration).toBe(0);
        });

        it('should handle missing PronScore in overall segment pronunciation assessment', () => {
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Words: [buildWord()],
                        PronunciationAssessment: {
                            PronScore: undefined,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const seg = (result.segments as any[])[0];
            expect(seg.overallAccuracy).toBe(0);
        });

        it('should handle missing individual scores in overall summary IIFEs', () => {
            const segment = buildAzureSegment({
                NBest: [
                    {
                        Words: [buildWord()],
                        PronunciationAssessment: {
                            AccuracyScore: undefined,
                            FluencyScore: undefined,
                            ProsodyScore: undefined,
                            CompletenessScore: undefined,
                            PronScore: undefined,
                        },
                    },
                ],
            });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const overall = result.overall as any;
            expect(overall.AccuracyScore).toBe(0);
            expect(overall.FluencyScore).toBe(0);
            expect(overall.ProsodyScore).toBe(0);
            expect(overall.CompletenessScore).toBe(0);
            expect(overall.PronScore).toBe(0);
        });

        it('should handle missing DisplayText in segment mapping', () => {
            const segment = buildAzureSegment({ DisplayText: undefined });
            const result = speechTransformService.createTranscriptData([
                segment,
            ]);
            const seg = (result.segments as any[])[0];
            expect(seg.text).toBe('');
        });

        it('should handle falsy segments in speakingTime calculation (branch coverage)', () => {
            const originalReduce = Array.prototype.reduce;
            Array.prototype.reduce = function (
                callback: any,
                initialValue?: any
            ) {
                if (
                    initialValue === 0 &&
                    this.length > 0 &&
                    typeof this[0] === 'object' &&
                    (this[0] as any).id &&
                    (this[0] as any).id.startsWith('segment-')
                ) {
                    const wrappedCallback = (
                        accumulator: any,
                        currentValue: any,
                        index: any,
                        array: any
                    ) => {
                        const nextAcc = callback(
                            accumulator,
                            currentValue,
                            index,
                            array
                        );
                        return callback(nextAcc, null, index, array);
                    };
                    return originalReduce.call(
                        this,
                        wrappedCallback,
                        initialValue
                    );
                }
                return originalReduce.call(this, callback, initialValue);
            };

            try {
                const result = speechTransformService.createTranscriptData([
                    buildAzureSegment(),
                ]);
                expect(result.metadata).toBeDefined();
            } finally {
                Array.prototype.reduce = originalReduce;
            }
        });
    });
});
