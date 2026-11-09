import { skillPart } from '../features/skillTaxonomy.js';
import { ResourceLike } from './types.js';

/**
 * Content tagging: how a learner skill maps onto resource labels.
 * Resources are tagged at ingestion (labels.cefr/domain/topic, already produced by the
 * resource-labelling prompt); this module only interprets those tags.
 */
const LEAF_TOPICS: Record<string, string[]> = {
    gist: ['listening comprehension', 'main idea', 'gist', 'overall purpose'],
    detail: [
        'detail comprehension',
        'specific information',
        'listening for details',
    ],
    inference: ['inference', 'implication', 'reasoning'],
    specific_action: ['next action', 'follow-up', 'instructions'],
    crossreference: ['reading comprehension', 'multiple passages'],
    single: ['reading comprehension'],
    double: ['reading comprehension'],
    triple: ['reading comprehension'],
    whquestion: ['question response', 'listening comprehension'],
    wordform: ['grammar', 'word form'],
    verbtensemood: ['grammar', 'tenses'],
    preposition: ['grammar', 'prepositions'],
    conjunction: ['grammar', 'conjunctions'],
    pronoun: ['grammar', 'pronouns'],
    vocab_collocation: ['vocabulary', 'collocation'],
    vocab_wordchoice: ['vocabulary'],
    vocab_phrasalverb: ['vocabulary', 'phrasal verbs'],
};
const PART_TOPICS: Record<number, string[]> = {
    1: ['picture description', 'listening comprehension'],
    2: ['question response', 'listening comprehension'],
    3: ['conversation', 'listening comprehension'],
    4: ['talk', 'listening comprehension'],
    5: ['grammar', 'vocabulary'],
    6: ['grammar', 'reading comprehension'],
    7: ['reading comprehension'],
};

export function topicKeywordsForSkill(skillKey: string): string[] {
    const leaf = skillKey.includes('.')
        ? skillKey.split('.').slice(1).join('.')
        : '';
    const direct = LEAF_TOPICS[leaf];
    if (direct) return direct;
    const part = skillPart(skillKey);
    return part ? (PART_TOPICS[part] ?? []) : [];
}

/** Lower-case once; callers in hot loops should cache the result per resource / skill. */
export const lowerAll = (xs: readonly string[] | undefined): string[] =>
    (xs ?? []).map((x) => x.toLowerCase());

/** Core matcher on pre-lowercased inputs (no allocations in the loop). */
export function topicMatchLC(topicsLC: string[], keywordsLC: string[]): number {
    if (keywordsLC.length === 0 || topicsLC.length === 0) return 0;
    let hits = 0;
    for (const k of keywordsLC) {
        for (const t of topicsLC) {
            if (t.includes(k) || k.includes(t)) {
                hits++;
                break;
            }
        }
    }
    return Math.min(1, hits / Math.min(2, keywordsLC.length));
}

/** 0..1: share of the wanted keywords present in the resource's topics (case-insensitive). */
export function topicMatch(resource: ResourceLike, keywords: string[]): number {
    return topicMatchLC(lowerAll(resource.labels?.topic), lowerAll(keywords));
}

export function domainMatch(
    resource: ResourceLike,
    interests: string[]
): boolean {
    const d = resource.labels?.domain?.toLowerCase();
    return !!d && interests.some((i) => i.toLowerCase() === d);
}

/** Rough reading/listening time for planning: youtube ≈ 10 min, article/rss ≈ 7, xapi ≈ 15. */
export function estimateResourceMinutes(r: ResourceLike): number {
    switch (r.type) {
        case 'youtube':
            return 10;
        case 'xapi':
            return 15;
        default:
            return 7;
    }
}
