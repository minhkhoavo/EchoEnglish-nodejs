/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-require-imports */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

jest.mock('node:child_process', () => ({
    execSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
    existsSync: jest.fn(),
}));

jest.mock('fluent-ffmpeg', () => ({
    setFfmpegPath: jest.fn(),
    default: { setFfmpegPath: jest.fn() },
}));

jest.mock('@ffmpeg-installer/ffmpeg', () => ({
    path: '/mock/installer/ffmpeg',
}));

jest.mock('ffmpeg-static', () => '/mock/static/ffmpeg');

describe('ffmpeg util', () => {
    let consoleLogSpy: jest.SpyInstance;
    let originalEnvFFMPEG: string | undefined;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        originalEnvFFMPEG = process.env.FFMPEG_PATH;
        delete process.env.FFMPEG_PATH;
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        if (originalEnvFFMPEG !== undefined) {
            process.env.FFMPEG_PATH = originalEnvFFMPEG;
        } else {
            delete process.env.FFMPEG_PATH;
        }
    });

    it('should resolve via ENV FFMPEG_PATH', () => {
        process.env.FFMPEG_PATH = '/mock/env/ffmpeg';
        (fs.existsSync as jest.Mock).mockImplementation(
            (p) => p === '/mock/env/ffmpeg'
        );
        (execSync as jest.Mock).mockReturnValue(Buffer.from('ffmpeg version'));

        let imported: any;
        jest.isolateModules(() => {
            imported = require('~/utils/ffmpeg.js');
        });
        expect(imported.default).toBeDefined();
        expect(consoleLogSpy).toHaveBeenCalledWith(
            '[FFmpeg] resolved via ENV FFMPEG_PATH: /mock/env/ffmpeg'
        );
    });

    it('should fallback to system if ENV FFMPEG_PATH cannot run', () => {
        process.env.FFMPEG_PATH = '/mock/env/ffmpeg';
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (execSync as jest.Mock).mockImplementation((cmd) => {
            if (cmd.includes('/mock/env/ffmpeg')) throw new Error('Bad binary');
            if (cmd === 'ffmpeg -version') return Buffer.from('ffmpeg version');
            throw new Error('Not found');
        });

        let imported: any;
        jest.isolateModules(() => {
            imported = require('~/utils/ffmpeg.js');
        });
        expect(consoleLogSpy).toHaveBeenCalledWith(
            '[FFmpeg] resolved via System PATH: ffmpeg'
        );
    });

    it('should resolve via System PATH', () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false); // ENV fails
        (execSync as jest.Mock).mockImplementation((cmd) => {
            if (cmd === 'ffmpeg -version') return Buffer.from('ffmpeg version');
            throw new Error('Not found');
        });

        let imported: any;
        jest.isolateModules(() => {
            imported = require('~/utils/ffmpeg.js');
        });
        expect(imported.default).toBeDefined();
        expect(consoleLogSpy).toHaveBeenCalledWith(
            '[FFmpeg] resolved via System PATH: ffmpeg'
        );
    });

    it('should resolve via @ffmpeg-installer/ffmpeg', () => {
        (fs.existsSync as jest.Mock).mockImplementation(
            (p) => p === '/mock/installer/ffmpeg'
        );
        (execSync as jest.Mock).mockImplementation((cmd) => {
            if (cmd === '"/mock/installer/ffmpeg" -version')
                return Buffer.from('ffmpeg version');
            throw new Error('Not found');
        });

        let imported: any;
        jest.isolateModules(() => {
            imported = require('~/utils/ffmpeg.js');
        });
        expect(imported.default).toBeDefined();
        expect(consoleLogSpy).toHaveBeenCalledWith(
            '[FFmpeg] resolved via @ffmpeg-installer/ffmpeg: /mock/installer/ffmpeg'
        );
    });

    it('should resolve via ffmpeg-static', () => {
        (fs.existsSync as jest.Mock).mockImplementation(
            (p) => p === '/mock/static/ffmpeg'
        );
        (execSync as jest.Mock).mockImplementation((cmd) => {
            if (cmd === '"/mock/static/ffmpeg" -version')
                return Buffer.from('ffmpeg version');
            throw new Error('Not found');
        });

        let imported: any;
        jest.isolateModules(() => {
            imported = require('~/utils/ffmpeg.js');
        });
        expect(imported.default).toBeDefined();
        expect(consoleLogSpy).toHaveBeenCalledWith(
            '[FFmpeg] resolved via ffmpeg-static: /mock/static/ffmpeg'
        );
    });

    it('should resolve via ffmpeg-static if installer exists but cannot run', () => {
        (fs.existsSync as jest.Mock).mockImplementation(
            (p) => p === '/mock/installer/ffmpeg' || p === '/mock/static/ffmpeg'
        );
        (execSync as jest.Mock).mockImplementation((cmd) => {
            if (cmd === '"/mock/static/ffmpeg" -version')
                return Buffer.from('ffmpeg version');
            throw new Error('Not found'); // installer will throw here
        });

        let imported: any;
        jest.isolateModules(() => {
            imported = require('~/utils/ffmpeg.js');
        });
        expect(imported.default).toBeDefined();
        expect(consoleLogSpy).toHaveBeenCalledWith(
            '[FFmpeg] resolved via ffmpeg-static: /mock/static/ffmpeg'
        );
    });

    it('should throw Error if no available FFmpeg found', () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        (execSync as jest.Mock).mockImplementation(() => {
            throw new Error('Not found');
        });

        jest.isolateModules(() => {
            expect(() => require('~/utils/ffmpeg.js')).toThrow(
                /No available FFmpeg found/
            );
        });
    });
});
