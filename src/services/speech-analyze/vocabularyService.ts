import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import {
    extractTranscript,
    normalizeWord,
    PerformanceLevel,
    cefrMap,
} from '../../utils/vocabularyUtils.js';

export type VocabularyAnalysis = {
    totalWords: number;
    uniqueWords: number;
    knownWords: number;
    unknownWords: number;
    distribution: Record<string, number>; // e.g., { A1: 10, A2: 5, B1: 2, ... }
    topAdvanced: { word: string; level: string }[]; // frequent words at B2/C1/C2
};

export type ParaphraseSuggestion = {
    original: string;
    paraphrase: string;
    technique: string;
};

export type TopPerformance = {
    category: string;
    description: string;
    score: number;
    level: PerformanceLevel;
};

export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export type SuggestedWord = {
    word: string;
    cefrLevel: CEFRLevel;
    definition: string;
    example: string;
    category: string;
};

export type VocabularyField = {
    paraphraseSuggestions: ParaphraseSuggestion[];
    topPerformances: TopPerformance[];
    suggestedWords: SuggestedWord[];
};

class VocabularyService {
    analyzeVocabulary(transformed: unknown): VocabularyAnalysis {
        const words: string[] = [];
        for (const seg of ((transformed as Record<string, unknown>)
            .segments as Array<Record<string, unknown>>) || []) {
            for (const w of (seg.words as Array<Record<string, unknown>>) ||
                []) {
                const normalized = normalizeWord((w.word as string) || '');
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
            topAdvanced,
        };
    }

    async buildVocabularyField(transformed: unknown): Promise<VocabularyField> {
        const transcript = extractTranscript(transformed);
        const stats = this.analyzeVocabulary(transformed);

        const template = await promptManagerService.getTemplate(
            'vocabulary_analysis'
        );

        const input = {
            transcript,
            stats_json: JSON.stringify(stats, null, 2),
        };

        const formatted =
            await PromptTemplate.fromTemplate(template).format(input);
        const model = googleGenAIClient.getModel();
        const parser = new JsonOutputParser();

        try {
            const chain = model.pipe(parser);
            return (await chain.invoke(formatted)) as VocabularyField;
        } catch (err) {
            console.error(
                '[VocabularyService] AI failed, using fallback:',
                err
            );
            return {
                paraphraseSuggestions: [],
                topPerformances: [],
                suggestedWords: [],
            };
        }
    }
}

export default new VocabularyService();
