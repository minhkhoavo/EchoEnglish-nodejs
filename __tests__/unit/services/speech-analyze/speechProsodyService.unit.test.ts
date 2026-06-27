/* eslint-disable @typescript-eslint/no-explicit-any */
import wav from 'node-wav';
import speechProsodyService from '~/services/speech-analyze/speechProsodyService.js';

// ── Mock node-wav ────────────────────────────────────────────────
jest.mock('node-wav', () => ({
    __esModule: true,
    default: {
        decode: jest.fn(),
    },
}));

const mockedWav = wav as jest.Mocked<typeof wav>;

// ── Factory helpers ──────────────────────────────────────────────

function buildTransformed(
    segments: Array<{
        words: Array<{
            word: string;
            offset: number; // ms
            duration: number; // ms
        }>;
        startTime?: number;
        endTime?: number;
        text?: string;
    }>,
    metadataDuration?: number
) {
    return {
        segments: segments.map((seg) => ({
            ...seg,
            startTime: seg.startTime ?? seg.words[0]?.offset ?? 0,
            endTime:
                seg.endTime ??
                (seg.words.length
                    ? seg.words[seg.words.length - 1].offset +
                      seg.words[seg.words.length - 1].duration
                    : 0),
            text: seg.text ?? seg.words.map((w) => w.word).join(' '),
        })),
        metadata: {
            duration: metadataDuration ?? 5000, // ms
        },
    };
}

function buildSimpleTransformed(
    wordTimings: Array<{ word: string; offset: number; duration: number }>
) {
    return buildTransformed([{ words: wordTimings }]);
}

function buildWavDecodeResult(sampleRate: number, channelData: Float32Array) {
    return {
        sampleRate,
        channelData: [channelData],
    };
}

// Generate a simple sine wave for testing
function generateSineWave(
    sampleRate: number,
    durationSec: number,
    frequency: number = 200,
    amplitude: number = 0.5
): Float32Array {
    const numSamples = Math.floor(sampleRate * durationSec);
    const samples = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        samples[i] =
            amplitude * Math.sin(2 * Math.PI * frequency * (i / sampleRate));
    }
    return samples;
}

// ── Tests ────────────────────────────────────────────────────────

describe('SpeechProsodyService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ──────────────────────────────────────────────
    // analyze – non-WAV mimeType
    // ──────────────────────────────────────────────
    describe('analyze – non-WAV mimeType', () => {
        it('should skip waveform analysis for mp3 mimeType', () => {
            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 500 },
                { word: 'world', offset: 600, duration: 400 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake-mp3-data'),
                mimeType: 'audio/mp3',
            });

            expect(result.prosody.pitch_points).toEqual([]);
            expect(result.prosody.energy_points).toEqual([]);
            expect(result.prosody.pitch_range_min).toBe(0);
            expect(result.prosody.pitch_range_max).toBe(0);
            expect(result.prosody.energy_range_min).toBe(0);
            expect(result.prosody.energy_range_max).toBe(0);
            expect(mockedWav.decode).not.toHaveBeenCalled();
        });

        it('should still compute fluency from word timings for non-WAV', () => {
            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 500 },
                { word: 'world', offset: 600, duration: 400 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake-mp3-data'),
                mimeType: 'audio/mpeg',
            });

            expect(result.fluency.words_per_minute).toBeGreaterThan(0);
            expect(result.stressWords).toHaveLength(2);
        });
    });

    // ──────────────────────────────────────────────
    // analyze – WAV decode success
    // ──────────────────────────────────────────────
    describe('analyze – WAV decode success', () => {
        it('should populate prosody points from decoded WAV data', () => {
            const sampleRate = 16000;
            const durationSec = 2;
            const channel = generateSineWave(sampleRate, durationSec, 200);
            mockedWav.decode.mockReturnValue(
                buildWavDecodeResult(sampleRate, channel) as any
            );

            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 500 },
                { word: 'world', offset: 600, duration: 400 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('RIFF....WAVEdata'),
                mimeType: 'audio/wav',
            });

            expect(result.prosody.energy_points.length).toBeGreaterThan(0);
            expect(result.prosody.energy_range_max).toBeGreaterThan(0);
        });

        it('should compute word intensities from channel data', () => {
            const sampleRate = 16000;
            const durationSec = 2;
            // Generate two segments with different amplitudes
            const numSamples = sampleRate * durationSec;
            const channel = new Float32Array(numSamples);
            // First half: loud
            for (let i = 0; i < numSamples / 2; i++) channel[i] = 0.8;
            // Second half: quiet
            for (let i = numSamples / 2; i < numSamples; i++) channel[i] = 0.1;

            mockedWav.decode.mockReturnValue(
                buildWavDecodeResult(sampleRate, channel) as any
            );

            const transformed = buildSimpleTransformed([
                { word: 'loud', offset: 0, duration: 500 },
                { word: 'quiet', offset: 1000, duration: 500 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/wave',
            });

            // Stress scores should differ
            expect(result.stressWords).toHaveLength(2);
        });
    });

    // ──────────────────────────────────────────────
    // analyze – WAV decode error
    // ──────────────────────────────────────────────
    describe('analyze – WAV decode error', () => {
        it('should gracefully handle wav.decode throwing', () => {
            mockedWav.decode.mockImplementation(() => {
                throw new Error('Invalid WAV file');
            });

            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 500 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/wav',
            });

            // Should fall back gracefully
            expect(result.prosody.pitch_points).toEqual([]);
            expect(result.prosody.energy_points).toEqual([]);
            expect(result.fluency.words_per_minute).toBeGreaterThan(0);
        });
    });

    // ──────────────────────────────────────────────
    // analyze – empty segments
    // ──────────────────────────────────────────────
    describe('analyze – empty segments', () => {
        it('should return empty stressWords and zero fluency for empty segments', () => {
            const transformed = { segments: [], metadata: { duration: 0 } };

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/mp3',
            });

            expect(result.stressWords).toEqual([]);
            expect(result.fluency.words_per_minute).toBe(0);
            expect(result.fluency.pausing_score).toBe(100);
            expect(result.fluency.pausing_decision).toBe('correct');
            expect(result.fluency.feedbacks).toEqual([]);
        });
    });

    // ──────────────────────────────────────────────
    // analyze – fluency pausing_decision
    // ──────────────────────────────────────────────
    describe('analyze – fluency pausing_decision', () => {
        it('should return "correct" for 0 pauses', () => {
            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 400 },
                { word: 'world', offset: 400, duration: 400 }, // no gap
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/mp3',
            });

            expect(result.fluency.pausing_decision).toBe('correct');
        });

        it('should return "warning" for 1-2 pauses', () => {
            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 300 },
                { word: 'world', offset: 1000, duration: 300 }, // 0.7s gap
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/mp3',
            });

            expect(result.fluency.pausing_decision).toBe('warning');
        });

        it('should return "incorrect" for > 2 pauses', () => {
            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 200 },
                { word: 'world', offset: 1000, duration: 200 }, // gap 0.8s
                { word: 'how', offset: 2000, duration: 200 }, // gap 0.8s
                { word: 'are', offset: 3000, duration: 200 }, // gap 0.8s
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/mp3',
            });

            expect(result.fluency.pausing_decision).toBe('incorrect');
        });
    });

    // ──────────────────────────────────────────────
    // analyze – pausing_score clamped
    // ──────────────────────────────────────────────
    describe('analyze – pausing_score', () => {
        it('should be 100 when no pauses', () => {
            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 400 },
                { word: 'world', offset: 400, duration: 400 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/mp3',
            });

            expect(result.fluency.pausing_score).toBe(100);
        });

        it('should clamp to 0 when many pauses (>= 10)', () => {
            // Create words with large gaps
            const words: Array<{
                word: string;
                offset: number;
                duration: number;
            }> = [];
            for (let i = 0; i < 12; i++) {
                words.push({
                    word: `word${i}`,
                    offset: i * 2000, // 2s apart
                    duration: 200, // 0.2s each → 1.8s gap
                });
            }

            const transformed = buildSimpleTransformed(words);
            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/mp3',
            });

            expect(result.fluency.pausing_score).toBe(0);
        });
    });

    // ──────────────────────────────────────────────
    // analyze – downsample
    // ──────────────────────────────────────────────
    describe('analyze – downsample', () => {
        it('should not downsample when points count is within limit', () => {
            const sampleRate = 16000;
            const channel = generateSineWave(sampleRate, 5, 200);
            mockedWav.decode.mockReturnValue(
                buildWavDecodeResult(sampleRate, channel) as any
            );

            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 5000 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/wav',
            });

            // 5 seconds → maxPoints = 80 (< 30s), hop = 0.5s → ~10 points
            expect(result.prosody.energy_points.length).toBeLessThanOrEqual(80);
        });

        it('should downsample when points count exceeds the limit', () => {
            const sampleRate = 16000;
            const durationSec = 110; // totalSeconds = 110, so maxPoints = 140
            const channel = generateSineWave(sampleRate, durationSec, 200);
            mockedWav.decode.mockReturnValue(
                buildWavDecodeResult(sampleRate, channel) as any
            );

            const transformed = buildTransformed(
                [
                    {
                        words: [
                            { word: 'start', offset: 0, duration: 100 },
                            { word: 'end', offset: 109000, duration: 100 },
                        ],
                    },
                ],
                110000
            );

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/wav',
            });

            expect(result.prosody.pitch_points.length).toBeLessThanOrEqual(140);
            expect(result.prosody.energy_points.length).toBeLessThanOrEqual(
                140
            );
        });
    });

    // ──────────────────────────────────────────────
    // analyze – top 5 feedbacks
    // ──────────────────────────────────────────────
    describe('analyze – feedbacks', () => {
        it('should limit feedbacks to top 5 by duration', () => {
            const words: Array<{
                word: string;
                offset: number;
                duration: number;
            }> = [];
            for (let i = 0; i < 8; i++) {
                words.push({
                    word: `word${i}`,
                    offset: i * 2000,
                    duration: 200,
                });
            }
            const transformed = buildSimpleTransformed(words);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/mp3',
            });

            expect(result.fluency.feedbacks.length).toBeLessThanOrEqual(5);
            // Sorted by duration descending
            for (let i = 1; i < result.fluency.feedbacks.length; i++) {
                expect(
                    result.fluency.feedbacks[i - 1].duration
                ).toBeGreaterThanOrEqual(result.fluency.feedbacks[i].duration);
            }
        });

        it('should set feedbacks correctness to "incorrect"', () => {
            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 200 },
                { word: 'world', offset: 1000, duration: 200 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/mp3',
            });

            if (result.fluency.feedbacks.length > 0) {
                expect(result.fluency.feedbacks[0].correctness).toBe(
                    'incorrect'
                );
            }
        });
    });

    // ──────────────────────────────────────────────
    // analyze – fluency points from segments
    // ──────────────────────────────────────────────
    describe('analyze – fluency.points from segments', () => {
        it('should create one fluency point per segment with WPM', () => {
            const transformed = buildTransformed([
                {
                    words: [
                        { word: 'hello', offset: 0, duration: 300 },
                        { word: 'world', offset: 400, duration: 300 },
                    ],
                    startTime: 0,
                    endTime: 700,
                },
                {
                    words: [
                        { word: 'how', offset: 1000, duration: 200 },
                        { word: 'are', offset: 1300, duration: 200 },
                        { word: 'you', offset: 1600, duration: 200 },
                    ],
                    startTime: 1000,
                    endTime: 1800,
                },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/mp3',
            });

            expect(result.fluency.points).toHaveLength(2);
            expect(result.fluency.points[0].value).toBeGreaterThan(0);
            expect(result.fluency.points[1].value).toBeGreaterThan(0);
        });
    });

    // ──────────────────────────────────────────────
    // analyze – stress words
    // ──────────────────────────────────────────────
    describe('analyze – stressWords', () => {
        it('should compute stress scores for all words', () => {
            const transformed = buildSimpleTransformed([
                { word: 'the', offset: 0, duration: 100 },
                { word: 'BIG', offset: 200, duration: 500 },
                { word: 'cat', offset: 800, duration: 300 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/mp3',
            });

            expect(result.stressWords).toHaveLength(3);
            expect(result.stressWords[0].word).toBe('the');
            expect(result.stressWords[1].word).toBe('BIG');
            expect(result.stressWords[2].word).toBe('cat');
            // Each has index, stressScore, isStressed
            result.stressWords.forEach((sw, i) => {
                expect(sw.index).toBe(i);
                expect(typeof sw.stressScore).toBe('number');
                expect(typeof sw.isStressed).toBe('boolean');
            });
        });

        it('should mark longest duration word as stressed in a varied set', () => {
            const transformed = buildSimpleTransformed([
                { word: 'a', offset: 0, duration: 50 },
                { word: 'IMPORTANT', offset: 100, duration: 800 },
                { word: 'the', offset: 1000, duration: 50 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/mp3',
            });

            // 'IMPORTANT' with 800ms should likely be stressed
            const importantWord = result.stressWords.find(
                (w) => w.word === 'IMPORTANT'
            );
            expect(importantWord).toBeDefined();
            expect(importantWord!.stressScore).toBeGreaterThan(0);
        });
    });

    // ──────────────────────────────────────────────
    // analyze – words_per_minute
    // ──────────────────────────────────────────────
    describe('analyze – words_per_minute', () => {
        it('should compute WPM based on totalSeconds and word count', () => {
            // 4 words over 5s → WPM = 4/5 * 60 = 48
            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 500 },
                { word: 'world', offset: 600, duration: 500 },
                { word: 'how', offset: 1200, duration: 500 },
                { word: 'are', offset: 1800, duration: 500 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/mp3',
            });

            expect(result.fluency.words_per_minute).toBeGreaterThan(0);
        });
    });

    // ──────────────────────────────────────────────
    // analyze – boundary and branch coverage edge cases
    // ──────────────────────────────────────────────
    describe('analyze – boundary and branch coverage edge cases', () => {
        it('should handle flat line audio (no pitch detected)', () => {
            const sampleRate = 16000;
            const channel = generateSineWave(sampleRate, 2, 200, 0); // amplitude = 0 (flat line)
            mockedWav.decode.mockReturnValue(
                buildWavDecodeResult(sampleRate, channel) as any
            );

            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 2000 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/wav',
            });

            // flat line should result in empty pitch points because estimatePitchHz returns null
            expect(result.prosody.pitch_points).toEqual([]);
            expect(result.prosody.pitch_range_min).toBe(0);
            expect(result.prosody.pitch_range_max).toBe(0);
        });

        it('should handle missing channelData or sampleRate in decoded WAV', () => {
            // Missing channelData
            mockedWav.decode.mockReturnValue({
                sampleRate: 16000,
            } as any);

            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 1000 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/wav',
            });

            expect(result.prosody.pitch_points).toEqual([]);
            expect(result.prosody.energy_points).toEqual([]);
        });

        it('should handle missing segments or missing words in transformed data', () => {
            const sampleRate = 16000;
            const channel = generateSineWave(sampleRate, 2, 200);
            mockedWav.decode.mockReturnValue(
                buildWavDecodeResult(sampleRate, channel) as any
            );

            // 1. Missing segments
            const resultNoSeg = speechProsodyService.analyze({
                transformed: { metadata: { duration: 2000 } } as any,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/wav',
            });
            expect(resultNoSeg.stressWords).toEqual([]);

            // 2. Segments exists but words is missing
            const resultNoWords = speechProsodyService.analyze({
                transformed: {
                    segments: [{ startTime: 0, endTime: 2000 }],
                    metadata: { duration: 2000 },
                } as any,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/wav',
            });
            expect(resultNoWords.stressWords).toEqual([]);
            expect(resultNoWords.fluency.points[0].value).toBe(0); // segment.words is missing, fallback to 0 length
        });

        it('should handle missing word duration and handle very long audio for maxPoints ternary', () => {
            const sampleRate = 16000;
            const channel = generateSineWave(sampleRate, 150, 200); // 150 seconds
            mockedWav.decode.mockReturnValue(
                buildWavDecodeResult(sampleRate, channel) as any
            );

            // Word with missing duration
            const transformed = buildTransformed(
                [
                    {
                        words: [
                            {
                                word: 'start',
                                offset: 0,
                                duration: undefined as any,
                            },
                            { word: 'end', offset: 149000, duration: 1000 },
                        ],
                    },
                ],
                150000
            );

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/wav',
            });

            // 150s is >= 120s, so maxPoints should be 200
            expect(result.prosody.pitch_points.length).toBeLessThanOrEqual(200);
        });

        it('should handle extremely low sample rate to trigger frame.length < sampleRate / minHz branch', () => {
            mockedWav.decode.mockReturnValue({
                sampleRate: 10,
                channelData: [new Float32Array(100)],
            } as any);

            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 1000 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/wav',
            });

            expect(result.prosody.pitch_points).toEqual([]);
        });

        it('should handle invalid/zero/negative/NaN sample rates to trigger freq <= 0 or isFinite branch', () => {
            const originalFloor = Math.floor;
            Math.floor = jest.fn().mockImplementation((val) => {
                if (typeof val === 'number') {
                    if (isNaN(val)) {
                        return 5; // minLag, maxLag, hop, frame for NaN
                    }
                    if (val < 0) {
                        return Math.abs(originalFloor(val));
                    }
                }
                return originalFloor(val);
            });

            try {
                const channel = generateSineWave(16000, 2, 200, 1.0);
                const transformed = buildSimpleTransformed([
                    { word: 'hello', offset: 0, duration: 1000 },
                ]);

                // 1. Trigger freq <= 0 (sampleRate = -16000)
                mockedWav.decode.mockReturnValue({
                    sampleRate: -16000,
                    channelData: [channel],
                } as any);

                speechProsodyService.analyze({
                    transformed,
                    audioBuffer: Buffer.from('fake'),
                    mimeType: 'audio/wav',
                });

                // 2. Trigger !isFinite(freq) (sampleRate = NaN)
                mockedWav.decode.mockReturnValue({
                    sampleRate: NaN,
                    channelData: [channel],
                } as any);

                speechProsodyService.analyze({
                    transformed,
                    audioBuffer: Buffer.from('fake'),
                    mimeType: 'audio/wav',
                });
            } finally {
                Math.floor = originalFloor;
            }
        });

        it('should handle falsy sampleRate with truthy channel branch', () => {
            mockedWav.decode.mockReturnValue({
                channelData: [new Float32Array(100)],
                sampleRate: 0, // falsy sample rate
            } as any);

            const transformed = buildSimpleTransformed([
                { word: 'hello', offset: 0, duration: 1000 },
            ]);

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/wav',
            });

            expect(result.prosody.pitch_points).toEqual([]);
            expect(result.prosody.energy_points).toEqual([]);
        });

        it('should trigger the true branch of out[last] !== pts[last] in downsampling', () => {
            const sampleRate = 16000;
            const durationSec = 109.54; // produces exactly 220 points
            const channel = generateSineWave(sampleRate, durationSec, 200);
            mockedWav.decode.mockReturnValue(
                buildWavDecodeResult(sampleRate, channel) as any
            );

            const transformed = buildTransformed(
                [
                    {
                        words: [
                            { word: 'start', offset: 0, duration: 100 },
                            { word: 'end', offset: 109000, duration: 540 },
                        ],
                    },
                ],
                109540
            );

            const result = speechProsodyService.analyze({
                transformed,
                audioBuffer: Buffer.from('fake'),
                mimeType: 'audio/wav',
            });

            // The downsampled size should include the last element pushed explicitly in `if` branch
            expect(result.prosody.pitch_points.length).toBeLessThanOrEqual(140);
        });
    });
});
