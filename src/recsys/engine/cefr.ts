/** CEFR helpers. TOEIC L&R → CEFR uses the ETS published score bands (A2 225, B1 550, B2 785, C1 945). */
export const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type Cefr = (typeof CEFR_ORDER)[number];

export function cefrFromToeic(score: number): Cefr {
    if (score >= 945) return 'C1';
    if (score >= 785) return 'B2';
    if (score >= 550) return 'B1';
    if (score >= 225) return 'A2';
    return 'A1';
}

const LEVEL_TO_CEFR: Record<string, Cefr> = {
    beginner: 'A2',
    intermediate: 'B1',
    upper_intermediate: 'B2',
    advanced: 'C1',
};

export function cefrFromLevel(level?: string): Cefr | undefined {
    return level ? LEVEL_TO_CEFR[level] : undefined;
}

/** Accepts "B1", "b1+", "CEFR B2", "Intermediate (B1-B2)" → first CEFR token. */
export function parseCefr(label?: string | null): Cefr | undefined {
    const m = /\b([ABC][12])\b/i.exec(label ?? '');
    return m ? (m[1].toUpperCase() as Cefr) : undefined;
}

export const cefrIndex = (c: Cefr): number => CEFR_ORDER.indexOf(c);

/** 1 = same level, 0.5 = one step away, 0 = two or more steps away. */
export function cefrFit(
    learner: Cefr | undefined,
    content: Cefr | undefined
): number {
    if (!learner || !content) return 0.5; // unknown → neutral
    return Math.max(
        0,
        1 - Math.abs(cefrIndex(learner) - cefrIndex(content)) / 2
    );
}
