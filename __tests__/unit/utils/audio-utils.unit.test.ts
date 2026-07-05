/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import {
    convertMp3ToWav,
    makeAudioConfigFromPcm16kMonoWav,
    getAudioDurationSeconds,
} from '~/utils/audio-utils.js';
import ffmpeg from '~/utils/ffmpeg.js';
import * as fs from 'node:fs/promises';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import wav from 'node-wav';

// Mock ffmpeg using factory to avoid top-level execution
jest.mock('~/utils/ffmpeg.js', () => {
    const fn = jest.fn();
    return {
        __esModule: true,
        default: fn,
    };
});

// Mock fs/promises
jest.mock('node:fs/promises', () => ({
    mkdtemp: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    rm: jest.fn(),
}));

// Mock node-wav
jest.mock('node-wav', () => ({
    __esModule: true,
    default: {
        decode: jest.fn(),
    },
}));

// Mock Microsoft Speech SDK
jest.mock('microsoft-cognitiveservices-speech-sdk', () => {
    return {
        AudioStreamFormat: {
            getWaveFormatPCM: jest.fn().mockReturnValue('mockFormat'),
        },
        AudioInputStream: {
            createPushStream: jest.fn().mockReturnValue({
                write: jest.fn(),
                close: jest.fn(),
            }),
        },
        AudioConfig: {
            fromStreamInput: jest.fn().mockReturnValue('mockAudioConfigStream'),
            fromWavFileInput: jest
                .fn()
                .mockReturnValue('mockAudioConfigWavFile'),
        },
    };
});

describe('Audio Utils', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (consoleWarnSpy) consoleWarnSpy.mockRestore();
    });

    describe('convertMp3ToWav', () => {
        let mockFfmpegChain: any;

        beforeEach(() => {
            mockFfmpegChain = {
                input: jest.fn().mockReturnThis(),
                noVideo: jest.fn().mockReturnThis(),
                audioChannels: jest.fn().mockReturnThis(),
                audioFrequency: jest.fn().mockReturnThis(),
                audioCodec: jest.fn().mockReturnThis(),
                outputOptions: jest.fn().mockReturnThis(),
                save: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (
                    this: any,
                    event: string,
                    cb: any
                ) {
                    if (event === 'end') {
                        setTimeout(() => cb(), 0); // Trigger end event
                    }
                    return this;
                }),
            };
            (ffmpeg as unknown as jest.Mock).mockReturnValue(mockFfmpegChain);
            (fs.mkdtemp as jest.Mock).mockResolvedValue('/tmp/ffx-1234');
            (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
            (fs.readFile as jest.Mock).mockResolvedValue(
                Buffer.from('wav-data')
            );
            (fs.rm as jest.Mock).mockResolvedValue(undefined);
        });

        it('should convert mp3 to wav successfully and clean up', async () => {
            const inputBuf = Buffer.from('mp3-data');
            const result = await convertMp3ToWav(inputBuf);

            expect(result).toEqual(Buffer.from('wav-data'));
            expect(fs.mkdtemp).toHaveBeenCalled();
            expect(fs.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('in.mp3'),
                inputBuf
            );
            expect(ffmpeg).toHaveBeenCalled();
            expect(mockFfmpegChain.save).toHaveBeenCalledWith(
                expect.stringContaining('out.wav')
            );
            expect(fs.readFile).toHaveBeenCalledWith(
                expect.stringContaining('out.wav')
            );
            expect(fs.rm).toHaveBeenCalledWith('/tmp/ffx-1234', {
                recursive: true,
                force: true,
            });
        });

        it('should throw and clean up if ffmpeg errors', async () => {
            mockFfmpegChain.on.mockImplementation(function (
                this: any,
                event: string,
                cb: any
            ) {
                if (event === 'error') {
                    setTimeout(() => cb(new Error('ffmpeg failed')), 0);
                }
                return this;
            });

            const inputBuf = Buffer.from('mp3-data');
            await expect(convertMp3ToWav(inputBuf)).rejects.toThrow(
                'ffmpeg failed'
            );
            expect(fs.rm).toHaveBeenCalledWith('/tmp/ffx-1234', {
                recursive: true,
                force: true,
            });
        });

        it('should handle fs.rm throwing error without failing the whole process', async () => {
            (fs.rm as jest.Mock).mockRejectedValue(new Error('rm failed'));

            const inputBuf = Buffer.from('mp3-data');
            const result = await convertMp3ToWav(inputBuf);

            expect(result).toEqual(Buffer.from('wav-data'));
            expect(fs.rm).toHaveBeenCalled(); // Tried to clean up but ignored error
        });
    });

    describe('makeAudioConfigFromPcm16kMonoWav', () => {
        it('should return push stream config if valid RIFF/WAVE PCM buffer is provided', () => {
            // Construct a fake WAV buffer
            const wavBuffer = Buffer.alloc(44 + 8); // 44 bytes header + 8 bytes data
            wavBuffer.write('RIFF', 0, 'ascii'); // 0-3
            wavBuffer.writeUInt32LE(36 + 8, 4); // 4-7 size
            wavBuffer.write('WAVE', 8, 'ascii'); // 8-11 format

            // Chunk 1 (not data)
            wavBuffer.write('fmt ', 12, 'ascii');
            wavBuffer.writeUInt32LE(16, 16);

            // Chunk 2 (data)
            wavBuffer.write('data', 36, 'ascii');
            wavBuffer.writeUInt32LE(8, 40); // data size

            const config = makeAudioConfigFromPcm16kMonoWav(wavBuffer);
            expect(sdk.AudioConfig.fromStreamInput).toHaveBeenCalled();
            expect(config).toBe('mockAudioConfigStream');
        });

        it('should fallback to fromWavFileInput if not a valid RIFF buffer', () => {
            const badBuffer = Buffer.from('Not a wave file');
            const config = makeAudioConfigFromPcm16kMonoWav(badBuffer);
            expect(sdk.AudioConfig.fromWavFileInput).toHaveBeenCalledWith(
                badBuffer
            );
            expect(config).toBe('mockAudioConfigWavFile');
        });

        it('should fallback if RIFF but no WAVE', () => {
            const badBuffer = Buffer.alloc(44);
            badBuffer.write('RIFF', 0, 'ascii');
            badBuffer.write('NOTW', 8, 'ascii');
            const config = makeAudioConfigFromPcm16kMonoWav(badBuffer);
            expect(sdk.AudioConfig.fromWavFileInput).toHaveBeenCalledWith(
                badBuffer
            );
        });

        it('should break if chunk size exceeds buffer length', () => {
            const badBuffer = Buffer.alloc(44);
            badBuffer.write('RIFF', 0, 'ascii');
            badBuffer.writeUInt32LE(36, 4);
            badBuffer.write('WAVE', 8, 'ascii');
            badBuffer.write('fmt ', 12, 'ascii');
            badBuffer.writeUInt32LE(100, 16); // Chunk size is 100 but buffer is 44!
            const config = makeAudioConfigFromPcm16kMonoWav(badBuffer);
            expect(sdk.AudioConfig.fromWavFileInput).toHaveBeenCalledWith(
                badBuffer
            );
        });

        it('should fallback if no data chunk is found', () => {
            const badBuffer = Buffer.alloc(44);
            badBuffer.write('RIFF', 0, 'ascii');
            badBuffer.writeUInt32LE(36, 4);
            badBuffer.write('WAVE', 8, 'ascii');
            badBuffer.write('fmt ', 12, 'ascii');
            badBuffer.writeUInt32LE(16, 16);
            // No data chunk
            const config = makeAudioConfigFromPcm16kMonoWav(badBuffer);
            expect(sdk.AudioConfig.fromWavFileInput).toHaveBeenCalledWith(
                badBuffer
            );
        });
    });

    describe('getAudioDurationSeconds', () => {
        let mockFfmpegChain: any;

        beforeEach(() => {
            mockFfmpegChain = {
                input: jest.fn().mockReturnThis(),
                noVideo: jest.fn().mockReturnThis(),
                audioChannels: jest.fn().mockReturnThis(),
                audioFrequency: jest.fn().mockReturnThis(),
                audioCodec: jest.fn().mockReturnThis(),
                outputOptions: jest.fn().mockReturnThis(),
                save: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (
                    this: any,
                    event: string,
                    cb: any
                ) {
                    if (event === 'end') {
                        setTimeout(() => cb(), 0);
                    }
                    return this;
                }),
            };
            (ffmpeg as unknown as jest.Mock).mockReturnValue(mockFfmpegChain);
            (fs.mkdtemp as jest.Mock).mockResolvedValue('/tmp/ffx-1234');
            (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
            (fs.readFile as jest.Mock).mockResolvedValue(
                Buffer.from('wav-data')
            );
            (fs.rm as jest.Mock).mockResolvedValue(undefined);
        });

        const mockWavData = {
            sampleRate: 16000,
            channelData: [
                new Float32Array(32000), // 2 seconds
            ],
        };

        it('should decode wav directly if mimeType is wav', async () => {
            (wav.decode as jest.Mock).mockReturnValueOnce(mockWavData);
            const duration = await getAudioDurationSeconds(
                Buffer.from('wav-data'),
                'audio/wav'
            );
            expect(duration).toBe(2);
            expect(wav.decode).toHaveBeenCalled();
        });

        it('should convert mp3 to wav and decode if mimeType is not wav', async () => {
            (wav.decode as jest.Mock).mockReturnValueOnce(mockWavData);
            const duration = await getAudioDurationSeconds(
                Buffer.from('mp3-data'),
                'audio/mpeg'
            );
            expect(duration).toBe(2);
            expect(wav.decode).toHaveBeenCalled();
        });

        it('should handle undefined mimeType and convert mp3 to wav', async () => {
            (wav.decode as jest.Mock).mockReturnValueOnce(mockWavData);
            const duration = await getAudioDurationSeconds(
                Buffer.from('mp3-data'),
                undefined
            );
            expect(duration).toBe(2);
            expect(wav.decode).toHaveBeenCalled();
        });

        it('should return 0 when decoding fails', async () => {
            (wav.decode as jest.Mock).mockImplementationOnce(() => {
                throw new Error('decode error');
            });
            const duration = await getAudioDurationSeconds(
                Buffer.from('wav-data'),
                'audio/wav'
            );
            expect(duration).toBe(0);
        });

        it('should return 0 when channelData is empty or sampleRate is 0', async () => {
            (wav.decode as jest.Mock).mockReturnValueOnce({
                sampleRate: 16000,
                channelData: [],
            });
            let duration = await getAudioDurationSeconds(
                Buffer.from('wav-data'),
                'audio/wav'
            );
            expect(duration).toBe(0);

            (wav.decode as jest.Mock).mockReturnValueOnce({
                sampleRate: 0,
                channelData: [new Float32Array(32000)],
            });
            duration = await getAudioDurationSeconds(
                Buffer.from('wav-data'),
                'audio/wav'
            );
            expect(duration).toBe(0);
        });
    });
});
