import { Types } from 'mongoose';
import { eventService } from './eventService.js';
import type { EventType } from './eventTypes.js';
import { QuestionMetadata } from '../../models/questionMetadataModel.js';
import { deriveSkillKey, SkillTagsLike } from '../features/skillTaxonomy.js';
import { recsysConfig } from '../config.js';

/**
 * Typed, fail-safe emit helpers called from existing business code.
 * Every function: no-op when RECSYS_ENABLED is off, never throws, never blocks the caller
 * for more than the DB round-trips it needs (callers should not await them on hot paths).
 */

const safe = async (label: string, fn: () => Promise<void>): Promise<void> => {
    if (!recsysConfig.enabled()) return;
    try {
        await fn();
    } catch (err) {
        console.error(`[recsys] ${label} emit failed:`, (err as Error).message);
    }
};

export interface SubmittedAnswerLike {
    questionNumber: number;
    isCorrect: boolean;
}

export interface QuestionTagInfo {
    part?: string;
    skillTags?: SkillTagsLike;
    difficulty?: string;
}

interface DefQuestion {
    questionNumber?: number;
    skillTags?: (SkillTagsLike & { part?: string }) | null;
    contentTags?: { difficulty?: string } | null;
}
interface DefPart {
    partName?: string;
    questions?: DefQuestion[];
    questionGroups?: Array<{ questions?: DefQuestion[] }>;
}

const partFromName = (name?: string): string | undefined =>
    /(\d)/.exec(name ?? '')?.[1];

/**
 * Skill tags live EMBEDDED in the test definition (questions[].skillTags / contentTags) — the
 * same source the existing LR analysis (AnalysisEngineService) joins on `questionNumber`.
 * The separate `question_metadata` collection is only a fallback.
 */
export function extractQuestionTags(
    testDef: unknown
): Map<number, QuestionTagInfo> {
    const out = new Map<number, QuestionTagInfo>();
    const parts = (testDef as { parts?: DefPart[] } | null)?.parts;
    if (!Array.isArray(parts)) return out;
    const add = (q: DefQuestion, part: DefPart) => {
        if (typeof q.questionNumber !== 'number') return;
        out.set(q.questionNumber, {
            part: q.skillTags?.part ?? partFromName(part.partName),
            skillTags: q.skillTags ?? undefined,
            difficulty: q.contentTags?.difficulty,
        });
    };
    for (const part of parts) {
        for (const q of part.questions ?? []) add(q, part);
        for (const g of part.questionGroups ?? [])
            for (const q of g.questions ?? []) add(q, part);
    }
    return out;
}

/**
 * One `question_answered` per answer (skill-tagged) + one `test_submitted`.
 * Scores are attached ONLY for full tests (`full: true`): a Part-5-only practice has a
 * "TOEIC score" of ~150 that would corrupt learner CEFR and the score-gain KPI.
 */
export function emitTestSubmitted(input: {
    userId: string;
    testId: string;
    answers: SubmittedAnswerLike[];
    /** The test definition document (embedded skill/content tags). */
    testDefinition?: unknown;
    full: boolean;
    totalScore?: number;
    listeningScore?: number;
    readingScore?: number;
    /** Seconds. Callers must convert (test submit sends milliseconds). */
    durationSec?: number;
    occurredAt?: Date;
}): Promise<void> {
    return safe('test_submitted', async () => {
        const answers = input.answers.slice(0, 200);
        const tags = extractQuestionTags(input.testDefinition);

        // Fallback for questions whose definition carries no tags: question_metadata collection.
        const missing = answers
            .filter((a) => !tags.get(a.questionNumber)?.skillTags)
            .map((a) => a.questionNumber);
        if (missing.length > 0 && Types.ObjectId.isValid(input.testId)) {
            const meta = await QuestionMetadata.find({
                testId: new Types.ObjectId(input.testId),
                questionNumber: { $in: missing },
            })
                .select('questionNumber part skillTags contentTags.difficulty')
                .lean<
                    Array<{
                        questionNumber: number;
                        part: string;
                        skillTags?: SkillTagsLike;
                        contentTags?: { difficulty?: string };
                    }>
                >();
            for (const m of meta) {
                tags.set(m.questionNumber, {
                    part: m.part,
                    skillTags: m.skillTags,
                    difficulty: m.contentTags?.difficulty,
                });
            }
        }

        const at = input.occurredAt ?? new Date();
        const events: Array<{
            type: EventType;
            props: Record<string, unknown>;
            occurredAt?: Date;
        }> = answers.map((a) => {
            const t = tags.get(a.questionNumber);
            const part = t?.part ? Number(t.part) : undefined;
            return {
                type: 'question_answered',
                occurredAt: at,
                props: {
                    skillKey:
                        t?.skillTags || t?.part
                            ? deriveSkillKey(t?.part, t?.skillTags)
                            : 'unknown',
                    ...(part && part >= 1 && part <= 7 ? { part } : {}),
                    correct: a.isCorrect,
                    ...(t?.difficulty ? { difficulty: t.difficulty } : {}),
                    testId: input.testId,
                    questionNumber: a.questionNumber,
                    origin: 'test',
                },
            };
        });
        const correct = answers.filter((a) => a.isCorrect).length;
        events.push({
            type: 'test_submitted',
            occurredAt: at,
            props: {
                testId: input.testId,
                full: input.full,
                ...(input.full && input.totalScore !== undefined
                    ? { totalScore: input.totalScore }
                    : {}),
                ...(input.full && input.listeningScore !== undefined
                    ? { listeningScore: input.listeningScore }
                    : {}),
                ...(input.full && input.readingScore !== undefined
                    ? { readingScore: input.readingScore }
                    : {}),
                correct,
                total: Math.max(1, answers.length),
                ...(input.durationSec !== undefined
                    ? { durationSec: input.durationSec }
                    : {}),
            },
        });
        await eventService.emitManyAsync(input.userId, events);
    });
}

export function emitFlashcardReviewed(input: {
    userId: string;
    flashcardId: string;
    remembered: boolean;
    prevLevel: number;
    newLevel: number;
}): void {
    if (!recsysConfig.enabled()) return;
    eventService.emit(input.userId, 'flashcard_reviewed', {
        flashcardId: input.flashcardId,
        remembered: input.remembered,
        prevLevel: input.prevLevel,
        newLevel: input.newLevel,
    });
}

export function emitCreditSpent(
    userId: string,
    feature: string,
    credits: number
): void {
    if (!recsysConfig.enabled() || !(credits > 0)) return;
    eventService.emit(userId, 'credit_spent', { feature, credits });
}

export function emitVocabCaptured(
    userId: string,
    flashcards: Array<{ source?: string; isAIGenerated?: boolean }>
): void {
    if (!recsysConfig.enabled() || flashcards.length === 0) return;
    const kind = (f: { source?: string; isAIGenerated?: boolean }) =>
        /detect|camera|object/i.test(f.source ?? '')
            ? 'object_detection'
            : f.isAIGenerated
              ? 'ai_generated'
              : 'manual';
    const counts = new Map<string, number>();
    for (const f of flashcards)
        counts.set(kind(f), (counts.get(kind(f)) ?? 0) + 1);
    for (const [source, termCount] of counts) {
        eventService.emit(userId, 'vocab_captured', {
            source,
            termCount: Math.min(500, termCount),
        });
    }
}

const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const mean = (xs: number[]): number | undefined =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;

/** Average Azure pronunciation-assessment scores across segments. Scores only – no audio, no text. */
export function summariseAzureScores(parsed: unknown[]): {
    accuracy?: number;
    fluency?: number;
    completeness?: number;
    prosody?: number;
} {
    const pick = (key: string) =>
        mean(
            (parsed ?? [])
                .map((seg) => {
                    const nbest = (
                        seg as { NBest?: Array<Record<string, unknown>> }
                    )?.NBest?.[0];
                    const pa = (nbest?.PronunciationAssessment ?? nbest) as
                        Record<string, unknown> | undefined;
                    return num(pa?.[key]);
                })
                .filter((x): x is number => x !== undefined)
        );
    const clamp = (x?: number) =>
        x === undefined ? undefined : Math.min(100, Math.max(0, x));
    return {
        accuracy: clamp(pick('AccuracyScore')),
        fluency: clamp(pick('FluencyScore')),
        completeness: clamp(pick('CompletenessScore')),
        prosody: clamp(pick('ProsodyScore')),
    };
}

export function emitPronunciationScored(
    userId: string,
    parsed: unknown[],
    durationSec?: number
): void {
    if (!recsysConfig.enabled()) return;
    const s = summariseAzureScores(parsed);
    if (s.accuracy === undefined) return;
    eventService.emit(userId, 'pronunciation_scored', {
        accuracy: s.accuracy,
        ...(s.fluency !== undefined ? { fluency: s.fluency } : {}),
        ...(s.completeness !== undefined
            ? { completeness: s.completeness }
            : {}),
        ...(s.prosody !== undefined ? { prosody: s.prosody } : {}),
        ...(durationSec !== undefined ? { durationSec } : {}),
    });
}
