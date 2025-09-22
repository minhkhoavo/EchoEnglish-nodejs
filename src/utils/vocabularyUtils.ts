import fs from 'fs';
import path from 'path';

export function extractTranscript(transformed: unknown): string {
    const segs =
        ((transformed as Record<string, unknown>).segments as Array<
            Record<string, unknown>
        >) || [];
    return segs
        .map((s) => String((s.text as string) || ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeWord(w: string): string {
    return String(w || '')
        .toLowerCase()
        .replace(/[^a-z']/g, '');
}

export type PerformanceLevel = 'excellent' | 'good' | 'fair';
export function mapScoreToLevel(score: number): PerformanceLevel {
    return score >= 85 ? 'excellent' : score >= 70 ? 'good' : 'fair';
}
export type CEFREntry = Record<string, string>;

export function resolveCefrPath(): string | null {
    const candidates = [
        path.join(
            process.cwd(),
            'dist',
            'resources',
            'data',
            'cefr_words.json'
        ),
        path.join(process.cwd(), 'src', 'resources', 'data', 'cefr_words.json'),
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p;
        } catch {
            /* ignore error */
        }
    }
    return null;
}

export function loadCefrMap(): CEFREntry {
    try {
        const p = resolveCefrPath();
        if (!p) return {};
        const raw = fs.readFileSync(p, 'utf-8');
        const obj = JSON.parse(raw);
        return obj || {};
    } catch {
        return {
            /* ignore error */
        };
    }
}

export const cefrMap = loadCefrMap();
