/**
 * Skill taxonomy used by mastery tracking and recommendations.
 * Derived from QuestionMetadata.skillTags so tests, drills and content share one vocabulary.
 * Granularity is deliberately coarse for P3/P4 (category) to avoid sparse per-skill data.
 */

export interface SkillTagsLike {
    skills?: string[];
    questionForm?: string;
    skillCategory?: string;
    skillDetail?: string;
    grammarPoint?: string;
    vocabPoint?: string;
    tagType?: string;
    passageType?: string;
    requiresCrossReference?: boolean;
}

export function deriveSkillKey(
    part: string | number | undefined,
    tags: SkillTagsLike | undefined
): string {
    const p = String(part ?? '').trim();
    const t = tags ?? {};
    const lc = (s?: string) => (s ? s.toLowerCase() : undefined);
    let leaf: string | undefined;
    switch (p) {
        case '1':
            leaf = t.skills?.[0];
            break;
        case '2':
            leaf = t.questionForm;
            break;
        case '3':
        case '4':
            leaf = lc(t.skillCategory);
            break;
        case '5':
            leaf =
                t.grammarPoint ??
                (t.vocabPoint ? `vocab_${t.vocabPoint}` : undefined);
            break;
        case '6':
            leaf = t.tagType;
            break;
        case '7':
            leaf = t.requiresCrossReference ? 'crossReference' : t.passageType;
            break;
        default:
            return p ? `part:${p}` : 'unknown';
    }
    return leaf ? `p${p}.${leaf.toLowerCase()}` : `part:${p}`;
}

/** Approximate number of scored questions per part (TOEIC L&R, 200 total). */
const PART_QUESTIONS: Record<number, number> = {
    1: 6,
    2: 25,
    3: 39,
    4: 30,
    5: 30,
    6: 16,
    7: 54,
};

export function skillPart(skillKey: string): number | undefined {
    const m = /^p(\d)\./.exec(skillKey) ?? /^part:(\d)$/.exec(skillKey);
    return m ? Number(m[1]) : undefined;
}

/** Share of the exam this skill's part represents → how much fixing it moves the score. */
export function skillExamWeight(skillKey: string): number {
    const part = skillPart(skillKey);
    return part ? (PART_QUESTIONS[part] ?? 20) / 200 : 0.05;
}

export const isListeningPart = (part?: number): boolean =>
    part !== undefined && part >= 1 && part <= 4;

export function skillLabel(skillKey: string): string {
    const part = skillPart(skillKey);
    const leaf = skillKey.includes('.')
        ? skillKey.split('.').slice(1).join(' ')
        : 'general';
    const words = leaf
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase();
    return part ? `Part ${part} · ${words}` : words;
}
