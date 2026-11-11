import { DailyFactsData, SkillCount } from './models.js';

export interface AggEvent {
    type: string;
    hour: number;
    occurredAt: Date;
    props: Record<string, unknown>;
}

const n = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;

/** Event types that count as a real learning action (used for activation/retention). */
const LEARNING_ACTIONS = new Set([
    'question_answered',
    'test_submitted',
    'flashcard_reviewed',
    'vocab_captured',
    'pronunciation_scored',
    'writing_scored',
]);

/**
 * Pure aggregation: all clean events of ONE user-day → one facts row.
 *
 * Study-time rule (avoid double counting):
 *   + test_submitted.durationSec           (covers all in-test questions)
 *   + question_answered.timeMs             ONLY when origin != 'test'
 *   + resource_viewed.dwellSec
 *   + pronunciation_scored/writing_scored.durationSec
 *   + flashcard_reviewed.latencyMs
 *   session_ended.durationSec is app-open time, NOT study time; it is only used for `sessions`.
 */
export function aggregateDay(
    userId: string,
    day: string,
    events: AggEvent[]
): DailyFactsData {
    const f: DailyFactsData = {
        userId,
        day,
        studySeconds: 0,
        sessions: 0,
        questionsAnswered: 0,
        questionsCorrect: 0,
        bySkill: [],
        flashcardsReviewed: 0,
        flashcardsRemembered: 0,
        vocabCaptured: 0,
        resourcesViewed: 0,
        resourcesCompleted: 0,
        pronunciationAttempts: 0,
        pronunciationAccuracySum: 0,
        writingAttempts: 0,
        testsSubmitted: 0,
        creditsSpent: 0,
        aiCostUsd: 0,
        aiTokens: 0,
        recImpressions: 0,
        recClicks: 0,
        recCompletes: 0,
        recDismisses: 0,
        activeHours: new Array(24).fill(0),
        learningActions: 0,
    };
    const skills = new Map<string, SkillCount>();
    let lastTest: { at: number; score: number } | undefined;

    for (const e of events) {
        const p = e.props;
        if (LEARNING_ACTIONS.has(e.type)) {
            f.learningActions++;
            if (e.hour >= 0 && e.hour < 24) f.activeHours[e.hour]++;
        }
        switch (e.type) {
            case 'session_started':
                f.sessions++;
                break;
            case 'question_answered': {
                f.questionsAnswered++;
                const correct = p.correct === true;
                if (correct) f.questionsCorrect++;
                if (p.origin !== 'test') f.studySeconds += n(p.timeMs) / 1000;
                const key =
                    typeof p.skillKey === 'string' ? p.skillKey : 'unknown';
                const s = skills.get(key) ?? { skillKey: key, n: 0, c: 0 };
                s.n++;
                if (correct) s.c++;
                skills.set(key, s);
                break;
            }
            case 'test_submitted':
                f.testsSubmitted++;
                f.studySeconds += n(p.durationSec);
                if (typeof p.totalScore === 'number' && p.full !== false) {
                    const at = e.occurredAt.getTime();
                    if (!lastTest || at >= lastTest.at)
                        lastTest = { at, score: p.totalScore };
                }
                break;
            case 'flashcard_reviewed':
                f.flashcardsReviewed++;
                if (p.remembered === true) f.flashcardsRemembered++;
                f.studySeconds += n(p.latencyMs) / 1000;
                break;
            case 'vocab_captured':
                f.vocabCaptured += n(p.termCount) || 1;
                break;
            case 'resource_viewed':
                f.resourcesViewed++;
                if (p.completed === true) f.resourcesCompleted++;
                f.studySeconds += n(p.dwellSec);
                break;
            case 'pronunciation_scored':
                f.pronunciationAttempts++;
                f.pronunciationAccuracySum += n(p.accuracy);
                f.studySeconds += n(p.durationSec);
                break;
            case 'writing_scored':
                f.writingAttempts++;
                f.studySeconds += n(p.durationSec);
                break;
            case 'credit_spent':
                f.creditsSpent += n(p.credits);
                break;
            case 'ai_usage':
                f.aiCostUsd += n(p.costUsd);
                f.aiTokens += n(p.promptTokens) + n(p.completionTokens);
                break;
            case 'rec_impression':
                f.recImpressions++;
                break;
            case 'rec_click':
                f.recClicks++;
                break;
            case 'rec_complete':
                f.recCompletes++;
                break;
            case 'rec_dismiss':
                f.recDismisses++;
                break;
            default:
                break;
        }
    }
    f.bySkill = [...skills.values()].sort((a, b) =>
        a.skillKey.localeCompare(b.skillKey)
    );
    if (lastTest) f.lastTestScore = lastTest.score;
    f.studySeconds = Math.round(f.studySeconds);
    f.aiCostUsd = Number(f.aiCostUsd.toFixed(6));
    return f;
}
