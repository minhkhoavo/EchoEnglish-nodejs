/* eslint-disable @typescript-eslint/no-explicit-any */
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import {
    convertMp3ToWav,
    makeAudioConfigFromPcm16kMonoWav,
} from '~/utils/audio-utils.js';

// ── Mocks ────────────────────────────────────────────────────────

// Mock SpeechRecognizer instance methods
const mockRecognizer = {
    sessionStarted: null as any,
    sessionStopped: null as any,
    speechStartDetected: null as any,
    speechEndDetected: null as any,
    recognizing: null as any,
    recognized: null as any,
    canceled: null as any,
    startContinuousRecognitionAsync: jest.fn(),
    stopContinuousRecognitionAsync: jest.fn(),
    close: jest.fn(),
};

const mockSpeechConfig = {
    speechRecognitionLanguage: '',
    outputFormat: 0,
    requestWordLevelTimestamps: jest.fn(),
};

const mockAudioConfig = {};
const mockPaConfig = {
    enableProsodyAssessment: false,
    applyTo: jest.fn(),
};

jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({
    __esModule: true,
    SpeechConfig: {
        fromSubscription: jest.fn(),
    },
    AudioConfig: {
        fromWavFileInput: jest.fn(),
    },
    SpeechRecognizer: jest.fn(),
    PronunciationAssessmentConfig: {
        fromJSON: jest.fn(),
    },
    OutputFormat: { Detailed: 1 },
    ResultReason: { RecognizedSpeech: 3, NoMatch: 0 },
    CancellationReason: { Error: 1, EndOfStream: 0 },
    PropertyId: { SpeechServiceResponse_JsonResult: 100 },
    AudioStreamFormat: { getWaveFormatPCM: jest.fn() },
    AudioInputStream: { createPushStream: jest.fn() },
}));

jest.mock('~/utils/audio-utils.js', () => ({
    __esModule: true,
    convertMp3ToWav: jest.fn(),
    makeAudioConfigFromPcm16kMonoWav: jest.fn(),
}));

const mockedSdk = sdk as jest.Mocked<typeof sdk>;
const mockedConvertMp3ToWav = convertMp3ToWav as jest.MockedFunction<
    typeof convertMp3ToWav
>;
const mockedMakeAudioConfig =
    makeAudioConfigFromPcm16kMonoWav as jest.MockedFunction<
        typeof makeAudioConfigFromPcm16kMonoWav
    >;

// Import service AFTER mocks
import speechAssessmentService from '~/services/speech-analyze/speechAssessmentService.js';

// ── Helpers ──────────────────────────────────────────────────────

function buildWavBuffer(): Buffer {
    // Minimal WAV header: RIFF....WAVE
    const buf = Buffer.alloc(44);
    buf.write('RIFF', 0, 4, 'ascii');
    buf.writeUInt32LE(36, 4);
    buf.write('WAVE', 8, 4, 'ascii');
    buf.write('fmt ', 12, 4, 'ascii');
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20); // PCM
    buf.writeUInt16LE(1, 22); // mono
    buf.writeUInt32LE(16000, 24); // sample rate
    buf.writeUInt32LE(32000, 28); // byte rate
    buf.writeUInt16LE(2, 32); // block align
    buf.writeUInt16LE(16, 34); // bits per sample
    buf.write('data', 36, 4, 'ascii');
    buf.writeUInt32LE(0, 40);
    return buf;
}

function setupMocks() {
    (mockedSdk.SpeechConfig.fromSubscription as jest.Mock).mockReturnValue(
        mockSpeechConfig
    );
    (mockedSdk.AudioConfig.fromWavFileInput as jest.Mock).mockReturnValue(
        mockAudioConfig
    );
    (mockedSdk.SpeechRecognizer as unknown as jest.Mock).mockImplementation(
        () => ({ ...mockRecognizer })
    );
    (
        mockedSdk.PronunciationAssessmentConfig.fromJSON as jest.Mock
    ).mockReturnValue(mockPaConfig);
}

// ── Tests ────────────────────────────────────────────────────────

describe('SpeechAssessmentService', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeAll(() => {
        process.env.SPEECH_KEY = 'test-key';
        process.env.SPEECH_REGION = 'test-region';
    });

    beforeEach(() => {
        jest.clearAllMocks();
        setupMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    // ──────────────────────────────────────────────
    // assess – env vars validation
    // ──────────────────────────────────────────────
    describe('assess – env vars', () => {
        it('should throw Error when SPEECH_KEY is missing', async () => {
            const origKey = process.env.SPEECH_KEY;
            delete process.env.SPEECH_KEY;

            await expect(
                speechAssessmentService.assess(
                    buildWavBuffer(),
                    'audio/wav',
                    'hello'
                )
            ).rejects.toThrow('Missing SPEECH_KEY or SPEECH_REGION');

            process.env.SPEECH_KEY = origKey;
        });

        it('should throw Error when SPEECH_REGION is missing', async () => {
            const origRegion = process.env.SPEECH_REGION;
            delete process.env.SPEECH_REGION;

            await expect(
                speechAssessmentService.assess(
                    buildWavBuffer(),
                    'audio/wav',
                    'hello'
                )
            ).rejects.toThrow('Missing SPEECH_KEY or SPEECH_REGION');

            process.env.SPEECH_REGION = origRegion;
        });
    });

    // ──────────────────────────────────────────────
    // assess – WAV input (no conversion needed)
    // ──────────────────────────────────────────────
    describe('assess – WAV input', () => {
        it('should not call convertMp3ToWav when buffer has valid WAV header and mimeType is not mp3', async () => {
            const wavBuffer = buildWavBuffer();

            // Simulate recognizer behavior
            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    // Fire sessionStopped
                    setTimeout(() => {
                        rec.sessionStopped(null, null);
                    }, 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                });
                return rec;
            });

            const result = await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(mockedConvertMp3ToWav).not.toHaveBeenCalled();
            expect(result).toEqual([]);
        });
    });

    // ──────────────────────────────────────────────
    // assess – MP3 input (needs conversion)
    // ──────────────────────────────────────────────
    describe('assess – MP3 input', () => {
        it('should call convertMp3ToWav for mp3 mimeType', async () => {
            const wavBuffer = buildWavBuffer();
            mockedConvertMp3ToWav.mockResolvedValue(wavBuffer);

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            await speechAssessmentService.assess(
                Buffer.from('fake-mp3'),
                'audio/mp3',
                'hello'
            );

            expect(mockedConvertMp3ToWav).toHaveBeenCalled();
        });
    });

    // ──────────────────────────────────────────────
    // assess – convert fails
    // ──────────────────────────────────────────────
    describe('assess – convert fails', () => {
        it('should reject when convertMp3ToWav throws', async () => {
            mockedConvertMp3ToWav.mockRejectedValue(
                new Error('ffmpeg not found')
            );

            await expect(
                speechAssessmentService.assess(
                    Buffer.from('fake-mp3'),
                    'audio/mp3',
                    'hello'
                )
            ).rejects.toThrow('Failed to convert input to WAV');
        });
    });

    // ──────────────────────────────────────────────
    // assess – invalid WAV after convert
    // ──────────────────────────────────────────────
    describe('assess – invalid WAV after convert', () => {
        it('should throw when converted buffer is not valid WAV', async () => {
            mockedConvertMp3ToWav.mockResolvedValue(
                Buffer.from('not-a-wav-file-at-all')
            );

            await expect(
                speechAssessmentService.assess(
                    Buffer.from('fake'),
                    'audio/mp3',
                    'hello'
                )
            ).rejects.toThrow('Converted audio is not a valid WAV');
        });
    });

    // ──────────────────────────────────────────────
    // assess – fromWavFileInput fallback
    // ──────────────────────────────────────────────
    describe('assess – fromWavFileInput fallback', () => {
        it('should fall back to makeAudioConfigFromPcm16kMonoWav when fromWavFileInput throws', async () => {
            const wavBuffer = buildWavBuffer();
            (
                mockedSdk.AudioConfig.fromWavFileInput as jest.Mock
            ).mockImplementation(() => {
                throw new Error('WAV parse error');
            });
            mockedMakeAudioConfig.mockReturnValue({} as any);

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('fromWavFileInput failed'),
                expect.anything()
            );
            expect(mockedMakeAudioConfig).toHaveBeenCalledWith(wavBuffer);
        });
    });

    // ──────────────────────────────────────────────
    // assess – recognized results
    // ──────────────────────────────────────────────
    describe('assess – recognized results', () => {
        it('should push parsed JSON when RecognizedSpeech result arrives', async () => {
            const wavBuffer = buildWavBuffer();
            const mockResult = {
                AccuracyScore: 95,
                NBest: [],
            };

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    // Fire recognized event
                    rec.recognized(null, {
                        result: {
                            reason: sdk.ResultReason.RecognizedSpeech,
                            properties: {
                                getProperty: () => JSON.stringify(mockResult),
                            },
                        },
                    });
                    // Then stop
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            const results = await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(results).toHaveLength(1);
            expect(results[0]).toEqual(mockResult);
        });
    });

    // ──────────────────────────────────────────────
    // assess – NoMatch
    // ──────────────────────────────────────────────
    describe('assess – NoMatch', () => {
        it('should console.warn on NoMatch result', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.recognized(null, {
                        result: {
                            reason: sdk.ResultReason.NoMatch,
                        },
                    });
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[Speech] NoMatch result'
            );
        });
    });

    // ──────────────────────────────────────────────
    // assess – sessionStopped
    // ──────────────────────────────────────────────
    describe('assess – sessionStopped', () => {
        it('should resolve with empty results when sessionStopped fires with no recognized results', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            const results = await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(results).toEqual([]);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[Speech] sessionStopped with zero results'
            );
        });
    });

    // ──────────────────────────────────────────────
    // assess – sessionStopped stopContinuousRecognitionAsync error
    // ──────────────────────────────────────────────
    describe('assess – sessionStopped with stop error', () => {
        it('should reject when stopContinuousRecognitionAsync errors', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn(
                    (_onSuccess, onError) => {
                        onError('stop failed');
                    }
                );
                return rec;
            });

            await expect(
                speechAssessmentService.assess(wavBuffer, 'audio/wav', 'hello')
            ).rejects.toBe('stop failed');
        });
    });

    // ──────────────────────────────────────────────
    // assess – canceled Error
    // ──────────────────────────────────────────────
    describe('assess – canceled Error', () => {
        it('should reject when cancellation reason is Error', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.canceled(null, {
                        reason: sdk.CancellationReason.Error,
                        errorCode: 1,
                        errorDetails: 'Auth failed',
                    });
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            await expect(
                speechAssessmentService.assess(wavBuffer, 'audio/wav', 'hello')
            ).rejects.toThrow('Recognition canceled');
        });

        it('should provide Forbidden hint for 401/403 errors', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.canceled(null, {
                        reason: sdk.CancellationReason.Error,
                        errorCode: 1,
                        errorDetails: '401 Forbidden access',
                    });
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            await expect(
                speechAssessmentService.assess(wavBuffer, 'audio/wav', 'hello')
            ).rejects.toThrow('Recognition canceled');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Speech] Hint:',
                expect.stringContaining('SPEECH_KEY')
            );
        });

        it('should provide format hint for format-related errors', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.canceled(null, {
                        reason: sdk.CancellationReason.Error,
                        errorCode: 1,
                        errorDetails: 'invalid format header',
                    });
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            await expect(
                speechAssessmentService.assess(wavBuffer, 'audio/wav', 'hello')
            ).rejects.toThrow('Recognition canceled');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Speech] Hint:',
                expect.stringContaining('16kHz')
            );
        });

        it('should provide generic hint when no errorDetails', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.canceled(null, {
                        reason: sdk.CancellationReason.Error,
                        errorCode: 1,
                        errorDetails: undefined,
                    });
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            await expect(
                speechAssessmentService.assess(wavBuffer, 'audio/wav', 'hello')
            ).rejects.toThrow('Recognition canceled');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Speech] Hint:',
                expect.stringContaining('No errorDetails')
            );
        });
    });

    // ──────────────────────────────────────────────
    // assess – canceled EndOfStream
    // ──────────────────────────────────────────────
    describe('assess – canceled EndOfStream', () => {
        it('should resolve gracefully when cancellation reason is EndOfStream', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.canceled(null, {
                        reason: sdk.CancellationReason.EndOfStream,
                        errorCode: 0,
                        errorDetails: '',
                    });
                });
                return rec;
            });

            const results = await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(results).toEqual([]);
        });

        it('should use lastPartial as fallback result when EndOfStream and no recognized results', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    // Simulate partial result
                    rec.recognizing(null, {
                        result: { text: 'partial text' },
                    });
                    // Then EndOfStream
                    rec.canceled(null, {
                        reason: sdk.CancellationReason.EndOfStream,
                        errorCode: 0,
                        errorDetails: '',
                    });
                });
                return rec;
            });

            const results = await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(results).toHaveLength(1);
            expect((results[0] as any).DisplayText).toBe('partial text');
            expect((results[0] as any).RecognitionStatus).toBe('Success');
        });
    });

    // ──────────────────────────────────────────────
    // assess – canceled Error with stopContinuousRecognitionAsync error
    // ──────────────────────────────────────────────
    describe('assess – canceled with stop error', () => {
        it('should reject with Error when stopContinuousRecognitionAsync fails during cancel', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.canceled(null, {
                        reason: sdk.CancellationReason.Error,
                        errorCode: 1,
                        errorDetails: 'some error',
                    });
                });
                rec.stopContinuousRecognitionAsync = jest.fn(
                    (_onSuccess, onError) => {
                        onError('stop-cancel-failed');
                    }
                );
                return rec;
            });

            await expect(
                speechAssessmentService.assess(wavBuffer, 'audio/wav', 'hello')
            ).rejects.toThrow('stop-cancel-failed');
        });
    });

    // ──────────────────────────────────────────────
    // assess – startContinuousRecognitionAsync error
    // ──────────────────────────────────────────────
    describe('assess – start error', () => {
        it('should reject when startContinuousRecognitionAsync fails', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn(
                    (_onSuccess, onError) => {
                        onError('start failed');
                    }
                );
                return rec;
            });

            await expect(
                speechAssessmentService.assess(wavBuffer, 'audio/wav', 'hello')
            ).rejects.toBe('start failed');
        });
    });

    // ──────────────────────────────────────────────
    // assess – requestWordLevelTimestamps
    // ──────────────────────────────────────────────
    describe('assess – requestWordLevelTimestamps', () => {
        it('should call requestWordLevelTimestamps when it is a function', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(
                mockSpeechConfig.requestWordLevelTimestamps
            ).toHaveBeenCalled();
        });
    });

    // ──────────────────────────────────────────────
    // assess – JSON parse fail in recognized
    // ──────────────────────────────────────────────
    describe('assess – JSON parse fail', () => {
        it('should console.error when JSON.parse fails for recognized result', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.recognized(null, {
                        result: {
                            reason: sdk.ResultReason.RecognizedSpeech,
                            properties: {
                                getProperty: () => 'invalid{json',
                            },
                        },
                    });
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            const results = await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(results).toEqual([]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Failed to parse pronunciation assessment result JSON',
                expect.anything()
            );
        });
    });

    // ──────────────────────────────────────────────
    // assess – recognizing partial
    // ──────────────────────────────────────────────
    describe('assess – recognizing partial', () => {
        it('should track partial text during recognizing events', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    // Simulate partial events
                    rec.recognizing(null, { result: { text: 'hel' } });
                    rec.recognizing(null, { result: { text: 'hello' } });
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            const results = await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            // No recognized results, but partials were tracked (no crash)
            expect(results).toEqual([]);
        });
    });

    // ──────────────────────────────────────────────
    // assess – non-WAV, non-MP3 buffer needing conversion
    // ──────────────────────────────────────────────
    describe('assess – buffer without WAV header', () => {
        it('should attempt conversion for non-WAV buffer even with non-mp3 mimeType', async () => {
            const nonWavBuffer = Buffer.from('not-wav-not-mp3-data');
            const wavBuffer = buildWavBuffer();
            mockedConvertMp3ToWav.mockResolvedValue(wavBuffer);

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            await speechAssessmentService.assess(
                nonWavBuffer,
                'audio/ogg',
                'hello'
            );

            expect(mockedConvertMp3ToWav).toHaveBeenCalled();
        });
    });

    // ──────────────────────────────────────────────
    // assess – recognized with no rawResult
    // ──────────────────────────────────────────────
    describe('assess – recognized with no rawResult', () => {
        it('should skip when getProperty returns empty/null', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.recognized(null, {
                        result: {
                            reason: sdk.ResultReason.RecognizedSpeech,
                            properties: {
                                getProperty: () => '',
                            },
                        },
                    });
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            const results = await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(results).toEqual([]);
        });
    });

    // ──────────────────────────────────────────────
    // assess – initial event handlers (sessionStarted, speechStartDetected, speechEndDetected)
    // ──────────────────────────────────────────────
    describe('assess – initial event handlers coverage', () => {
        it('should call sessionStarted, speechStartDetected, speechEndDetected handlers without error', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    // Trigger initial event handlers
                    if (typeof rec.sessionStarted === 'function')
                        rec.sessionStarted(null, null);
                    if (typeof rec.speechStartDetected === 'function')
                        rec.speechStartDetected(null, null);
                    if (typeof rec.speechEndDetected === 'function')
                        rec.speechEndDetected(null, null);
                    // Then stop session
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            const results = await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(results).toEqual([]);
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[Speech] sessionStarted'
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[Speech] speechStartDetected'
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[Speech] speechEndDetected'
            );
        });
    });

    // ──────────────────────────────────────────────
    // assess – EndOfStream hint logging
    // ──────────────────────────────────────────────
    describe('assess – EndOfStream hint', () => {
        it('should log EndOfStream hint when reason is EndOfStream', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.canceled(null, {
                        reason: sdk.CancellationReason.EndOfStream,
                        errorCode: 0,
                        errorDetails: '',
                    });
                });
                return rec;
            });

            await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Speech] Hint:',
                expect.stringContaining('Stream ended unexpectedly')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Treating EndOfStream')
            );
        });
    });

    // ──────────────────────────────────────────────
    // assess – boundary and branch coverage edge cases
    // ──────────────────────────────────────────────
    describe('assess – boundary and branch coverage edge cases', () => {
        beforeEach(() => {
            // Restore fromWavFileInput mock
            (mockedSdk.AudioConfig.fromWavFileInput as jest.Mock).mockReset();
            (
                mockedSdk.AudioConfig.fromWavFileInput as jest.Mock
            ).mockReturnValue(mockAudioConfig);
        });

        it('should handle missing referenceText and null/undefined mimeType', async () => {
            const wavBuffer = buildWavBuffer();
            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    setTimeout(() => rec.sessionStopped(null, null), 5);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            // Call without referenceText and with null mimeType
            const results = await speechAssessmentService.assess(
                wavBuffer,
                null as any
            );
            expect(results).toEqual([]);
        });

        it('should handle requestWordLevelTimestamps not being a function', async () => {
            const wavBuffer = buildWavBuffer();
            const originalFn = mockSpeechConfig.requestWordLevelTimestamps;
            delete (mockSpeechConfig as any).requestWordLevelTimestamps;

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    setTimeout(() => rec.sessionStopped(null, null), 5);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            try {
                const results = await speechAssessmentService.assess(
                    wavBuffer,
                    'audio/wav',
                    'test'
                );
                expect(results).toEqual([]);
            } finally {
                // Restore
                mockSpeechConfig.requestWordLevelTimestamps = originalFn;
            }
        });

        it('should handle convertMp3ToWav throwing a non-Error string', async () => {
            mockedConvertMp3ToWav.mockRejectedValue(
                'Conversion string error' as any
            );
            const mp3Buffer = Buffer.from('fake-mp3');

            await expect(
                speechAssessmentService.assess(mp3Buffer, 'audio/mp3', 'hello')
            ).rejects.toThrow(
                'Failed to convert input to WAV: Conversion string error'
            );
        });

        it('should handle fromWavFileInput throwing a non-Error string', async () => {
            const wavBuffer = buildWavBuffer();
            (
                mockedSdk.AudioConfig.fromWavFileInput as jest.Mock
            ).mockImplementation(() => {
                throw 'Audio config string error';
            });

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    setTimeout(() => rec.sessionStopped(null, null), 5);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            const results = await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );
            expect(results).toEqual([]);
            // Should fall back gracefully and log the warning
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('[Speech] fromWavFileInput failed'),
                'Audio config string error'
            );
        });

        it('should ignore recognized event when reason is neither RecognizedSpeech nor NoMatch', async () => {
            const wavBuffer = buildWavBuffer();
            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.recognized(null, {
                        result: {
                            reason: 999, // Unknown reason
                            properties: {
                                getProperty: jest.fn(),
                            },
                        },
                    });
                    setTimeout(() => rec.sessionStopped(null, null), 5);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            const results = await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );
            expect(results).toEqual([]);
            expect(consoleWarnSpy).not.toHaveBeenCalledWith(
                expect.stringContaining('NoMatch')
            );
        });

        it('should handle cancel event when reason is neither Error nor EndOfStream', async () => {
            const wavBuffer = buildWavBuffer();
            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.canceled(null, {
                        reason: 999, // E.g. CancelledByUser or other reasons
                        errorCode: 0,
                        errorDetails: 'Cancelled by some other means',
                    });
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            await expect(
                speechAssessmentService.assess(wavBuffer, 'audio/wav', 'hello')
            ).rejects.toThrow('Recognition canceled');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Speech] Canceled:',
                expect.any(Object)
            );
            // Hint should not be logged because hint is empty
            expect(consoleErrorSpy).not.toHaveBeenCalledWith(
                '[Speech] Hint:',
                expect.any(String)
            );
        });

        it('should handle cancel event with Error reason but non-matching details', async () => {
            const wavBuffer = buildWavBuffer();
            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.canceled(null, {
                        reason: sdk.CancellationReason.Error,
                        errorCode: 123,
                        errorDetails:
                            'Some other error type completely unrelated',
                    });
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            await expect(
                speechAssessmentService.assess(wavBuffer, 'audio/wav', 'hello')
            ).rejects.toThrow('Recognition canceled');

            // Hint should not be logged because it does not match Forbidden or Format regex
            expect(consoleErrorSpy).not.toHaveBeenCalledWith(
                '[Speech] Hint:',
                expect.any(String)
            );
        });

        it('should call the first sessionStopped handler assigned during setup', async () => {
            const wavBuffer = buildWavBuffer();
            let firstSessionStoppedHandler: any = null;

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };

                let handlerValue: any = null;
                Object.defineProperty(rec, 'sessionStopped', {
                    get() {
                        return handlerValue;
                    },
                    set(val) {
                        if (!firstSessionStoppedHandler) {
                            firstSessionStoppedHandler = val;
                        }
                        handlerValue = val;
                    },
                    configurable: true,
                });

                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    if (firstSessionStoppedHandler) {
                        firstSessionStoppedHandler(null, null);
                    }
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );

            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[Speech] sessionStopped'
            );
        });

        it('should handle missing result or missing text in recognizing event', async () => {
            const wavBuffer = buildWavBuffer();

            (
                mockedSdk.SpeechRecognizer as unknown as jest.Mock
            ).mockImplementation(() => {
                const rec = { ...mockRecognizer };
                rec.startContinuousRecognitionAsync = jest.fn((onSuccess) => {
                    onSuccess();
                    rec.recognizing(null, {});
                    rec.recognizing(null, { result: {} });
                    setTimeout(() => rec.sessionStopped(null, null), 10);
                });
                rec.stopContinuousRecognitionAsync = jest.fn((onSuccess) =>
                    onSuccess()
                );
                return rec;
            });

            const results = await speechAssessmentService.assess(
                wavBuffer,
                'audio/wav',
                'hello'
            );
            expect(results).toEqual([]);
        });
    });
});
