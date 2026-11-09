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

/** One `question_answered` per answer (skill-tagged from QuestionMetadata) + one `test_submitted`. */
export function emitTestSubmitted(input: {
    userId: string;
    testId: string;
    answers: SubmittedAnswerLike[];
    totalScore?: number;
    listeningScore?: number;
    readingScore?: number;
    durationSec?: number;
    occurredAt?: Date;
}): Promise<void> {
    return safe('test_submitted', async () => {
        const answers = input.answers.slice(0, 200);
        const meta = Types.ObjectId.isValid(input.testId)
            ? await QuestionMetadata.find({
                  testId: new Types.ObjectId(input.testId),
                  questionNumber: { $in: answers.map((a) => a.questionNumber) },
              })
                  .select(
                      'questionNumber part skillTags contentTags.difficulty'
                  )
                  .lean<
                      Array<{
                          questionNumber: number;
                          part: string;
                          skillTags?: SkillTagsLike;
                          contentTags?: { difficulty?: string };
                      }>
                  >()
            : [];
        const byNumber = new Map(meta.map((m) => [m.questionNumber, m]));
        const at = input.occurredAt ?? new Date();
        const events: Array<{
            type: EventType;
            props: Record<string, unknown>;
            occurredAt?: Date;
        }> = answers.map((a) => {
            const m = byNumber.get(a.questionNumber);
            const part = m ? Number(m.part) : undefined;
            return {
                type: 'question_answered',
                occurredAt: at,
                props: {
                    skillKey: m
                        ? deriveSkillKey(m.part, m.skillTags)
                        : 'unknown',
                    ...(part ? { part } : {}),
                    correct: a.isCorrect,
                    ...(m?.contentTags?.difficulty
                        ? { difficulty: m.contentTags.difficulty }
                        : {}),
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
                ...(input.totalScore !== undefined
                    ? { totalScore: input.totalScore }
                    : {}),
                ...(input.listeningScore !== undefined
                    ? { listeningScore: input.listeningScore }
                    : {}),
                ...(input.readingScore !== undefined
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
