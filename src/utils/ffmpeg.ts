import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import ffmpeg from 'fluent-ffmpeg';
import inst from '@ffmpeg-installer/ffmpeg';
import mod from 'ffmpeg-static';

function canRun(bin: string): boolean {
    try {
        execSync(`"${bin}" -version`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function tryEnv(): string | null {
    const p = process.env.FFMPEG_PATH;
    return p && fs.existsSync(p) && canRun(p) ? p : null;
}

function trySystem(): string | null {
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        return 'ffmpeg';
    } catch {
        return null;
    }
}

function tryFfmpegInstaller(): string | null {
    try {
        const p: string | undefined = inst?.path;
        if (p && fs.existsSync(p) && canRun(p)) return p;
    } catch {
        /* ignore */
    }
    return null;
}

function tryFfmpegStatic(): string | null {
    try {
        const cands = [mod, mod?.default].filter(Boolean) as string[];
        for (const c of cands) {
            if (fs.existsSync(c) && canRun(c)) return c;
        }
    } catch {
        /* ignore */
    }
    return null;
}

function resolveFFmpeg(): string {
    const order: Array<[string, string | null]> = [
        ['ENV FFMPEG_PATH', tryEnv()],
        ['System PATH', trySystem()],
        ['@ffmpeg-installer/ffmpeg', tryFfmpegInstaller()],
        ['ffmpeg-static', tryFfmpegStatic()],
    ];
    for (const [label, p] of order) {
        if (p) {
            console.log(`[FFmpeg] resolved via ${label}: ${p}`);
            return p;
        }
    }
    throw new Error(
        'No available FFmpeg found.\n' +
            'Option 1: winget install ffmpeg (or choco install ffmpeg)\n' +
            'Option 2: pnpm add @ffmpeg-installer/ffmpeg (recommended)\n' +
            'Option 3: set FFMPEG_PATH to point to ffmpeg.exe'
    );
}

const resolved = resolveFFmpeg();
ffmpeg.setFfmpegPath(resolved);
process.env.FFMPEG_PATH = resolved;
console.log('[FFmpeg] using:', resolved);

export default ffmpeg;
