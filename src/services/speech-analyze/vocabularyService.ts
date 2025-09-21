import fs from 'fs';
import path from 'path';

type CEFREntry = Record<string, string>;

function resolveCefrPath(): string | null {
    const candidates = [
        path.join(process.cwd(), 'dist', 'resources', 'data', 'cefr_words.json'),
        path.join(process.cwd(), 'src', 'resources', 'data', 'cefr_words.json'),
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p;
        } catch {}
    }
    return null;
}

function loadCefrMap(): CEFREntry {
    try {
        const p = resolveCefrPath();
        if (!p) return {};
        const raw = fs.readFileSync(p, 'utf-8');
        const obj = JSON.parse(raw);
        return obj || {};
    } catch {
        return {};
    }
}

const cefrMap = loadCefrMap();

function normalizeWord(w: string): string {
    return String(w || '').toLowerCase().replace(/[^a-z']/g, '');
}

export type VocabularyAnalysis = {
    totalWords: number;
    uniqueWords: number;
    knownWords: number;
    unknownWords: number;
    distribution: Record<string, number>; // e.g., { A1: 10, A2: 5, B1: 2, ... }
    topUnknown: string[]; // list of most frequent unknown words
    topAdvanced: { word: string; level: string }[]; // frequent words at B2/C1/C2
};

function analyzeVocabulary(transformed: any): VocabularyAnalysis {
    const words: string[] = [];
    for (const seg of transformed.segments || []) {
        for (const w of seg.words || []) {
            const normalized = normalizeWord(w.word || '');
            if (normalized) words.push(normalized);
        }
    }

    const totalWords = words.length;
    const freq: Record<string, number> = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;

    const uniqueWords = Object.keys(freq).length;

    const distribution: Record<string, number> = {};
    let knownWords = 0;
    let unknownWords = 0;

    for (const word of Object.keys(freq)) {
        const level = cefrMap[word];
        if (level) {
            distribution[level] = (distribution[level] || 0) + freq[word];
            knownWords += freq[word];
        } else {
            unknownWords += freq[word];
        }
    }

    // Top unknown by frequency
    const topUnknown = Object.entries(freq)
        .filter(([w]) => !cefrMap[w])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map((e) => e[0]);

    // Top advanced words (B2, C1, C2)
    const advancedLevels = new Set(['B2', 'C1', 'C2']);
    const topAdvanced = Object.entries(freq)
        .map(([w, count]) => ({ w, count, level: cefrMap[w] }))
        .filter((x) => x.level && advancedLevels.has(x.level))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((x) => ({ word: x.w, level: x.level! }));

    return {
        totalWords,
        uniqueWords,
        knownWords,
        unknownWords,
        distribution,
        topUnknown,
        topAdvanced,
    };
}

export default { analyzeVocabulary, loadCefrMap };
