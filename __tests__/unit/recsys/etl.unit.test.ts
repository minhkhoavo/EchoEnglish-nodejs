import { randomUUID } from 'node:crypto';
import {
    cleanEvent,
    localDayHour,
    normalizeSkillKey,
} from '~/recsys/etl/clean.js';
import { aggregateDay, AggEvent } from '~/recsys/etl/aggregate.js';
import { evaluateDataQuality, dqStatus } from '~/recsys/etl/dataQuality.js';

const raw = (
    type: string,
    props: Record<string, unknown>,
    at = new Date('2026-03-10T10:30:00Z')
) => ({
    _id: 'r1',
    eventId: randomUUID(),
    schemaVersion: 1,
    type,
    userId: 'u1',
    occurredAt: at,
    receivedAt: at,
    props,
});

describe('localDayHour (UTC+7)', () => {
    it('rolls the day forward after 17:00 UTC', () => {
        expect(localDayHour(new Date('2026-03-10T16:59:00Z'))).toEqual({
            day: '2026-03-10',
            hour: 23,
        });
        expect(localDayHour(new Date('2026-03-10T17:00:00Z'))).toEqual({
            day: '2026-03-11',
            hour: 0,
        });
    });
});

describe('cleanEvent', () => {
    it('normalises skill keys and stamps local day/hour', () => {
        const out = cleanEvent(
            raw('question_answered', {
                skillKey: '  P5 Word Form ',
                correct: true,
            })
        );
        expect(out.ok).toBe(true);
        if (out.ok) {
            expect(out.event.props.skillKey).toBe('p5_word_form');
            expect(out.event.day).toBe('2026-03-10');
            expect(out.event.hour).toBe(17);
        }
        expect(normalizeSkillKey('A  b')).toBe('a_b');
    });

    it('clamps absurd dwell time and records it in lineage', () => {
        const out = cleanEvent(
            raw('resource_viewed', {
                resourceId: 'a'.repeat(24),
                dwellSec: 999_999,
            })
        );
        expect(out.ok).toBe(true);
        if (out.ok) {
            expect(out.event.props.dwellSec).toBe(4 * 60 * 60);
            expect(out.event.clamped).toContain('dwellSec');
        }
    });

    it('rejects events that no longer satisfy the contract', () => {
        const out = cleanEvent(
            raw('pronunciation_scored', { accuracy: 'high' })
        );
        expect(out).toMatchObject({ ok: false });
    });
});

describe('aggregateDay', () => {
    const ev = (
        type: string,
        props: Record<string, unknown>,
        hour = 9,
        min = 0
    ): AggEvent => ({
        type,
        hour,
        occurredAt: new Date(Date.UTC(2026, 2, 10, hour, min)),
        props,
    });

    it('does not double count test time: in-test question timeMs is excluded', () => {
        const f = aggregateDay('u1', '2026-03-10', [
            ev('question_answered', {
                skillKey: 'a',
                correct: true,
                timeMs: 30_000,
                origin: 'test',
            }),
            ev('question_answered', {
                skillKey: 'a',
                correct: false,
                timeMs: 20_000,
                origin: 'drill',
            }),
            ev('test_submitted', {
                durationSec: 600,
                totalScore: 600,
                correct: 1,
                total: 2,
            }),
        ]);
        expect(f.studySeconds).toBe(620);
        expect(f.questionsAnswered).toBe(2);
        expect(f.questionsCorrect).toBe(1);
        expect(f.bySkill).toEqual([{ skillKey: 'a', n: 2, c: 1 }]);
        expect(f.lastTestScore).toBe(600);
    });

    it('a partial-part test (full:false) never sets lastTestScore, a full one does', () => {
        const partial = aggregateDay('u1', 'd', [
            ev('test_submitted', {
                durationSec: 600,
                totalScore: 150,
                correct: 20,
                total: 30,
                full: false,
            }),
        ]);
        expect(partial.lastTestScore).toBeUndefined();
        expect(partial.testsSubmitted).toBe(1);
        const full = aggregateDay('u1', 'd', [
            ev('test_submitted', {
                durationSec: 600,
                totalScore: 640,
                correct: 120,
                total: 200,
                full: true,
            }),
        ]);
        expect(full.lastTestScore).toBe(640);
    });

    it('session_ended is not study time; sessions are counted from session_started', () => {
        const f = aggregateDay('u1', 'd', [
            ev('session_started', {}),
            ev('session_ended', { durationSec: 3600 }),
        ]);
        expect(f.studySeconds).toBe(0);
        expect(f.sessions).toBe(1);
        expect(f.learningActions).toBe(0);
    });

    it('sums credits, AI cost and tokens; builds hour histogram for learning actions only', () => {
        const f = aggregateDay('u1', 'd', [
            ev('credit_spent', { feature: 'x', credits: 3 }),
            ev('ai_usage', {
                feature: 'x',
                model: 'm',
                promptTokens: 100,
                completionTokens: 50,
                costUsd: 0.0012,
            }),
            ev('ai_usage', {
                feature: 'x',
                model: 'm',
                promptTokens: 10,
                completionTokens: 5,
                costUsd: 0.0003,
            }),
            ev('flashcard_reviewed', { remembered: true, latencyMs: 4000 }, 20),
            ev(
                'flashcard_reviewed',
                { remembered: false, latencyMs: 6000 },
                20
            ),
        ]);
        expect(f.creditsSpent).toBe(3);
        expect(f.aiCostUsd).toBeCloseTo(0.0015, 6);
        expect(f.aiTokens).toBe(165);
        expect(f.flashcardsRemembered).toBe(1);
        expect(f.activeHours[20]).toBe(2);
        expect(f.studySeconds).toBe(10);
    });

    it('is deterministic and order independent', () => {
        const a = [
            ev('question_answered', {
                skillKey: 'b',
                correct: true,
                origin: 'drill',
            }),
            ev('question_answered', {
                skillKey: 'a',
                correct: false,
                origin: 'drill',
            }),
        ];
        expect(aggregateDay('u', 'd', a)).toEqual(
            aggregateDay('u', 'd', [...a].reverse())
        );
    });
});

describe('evaluateDataQuality', () => {
    const ok = {
        read: 100,
        rejected: 1,
        alreadyClean: 0,
        questionEvents: 50,
        unknownSkillEvents: 1,
        nullRequiredFields: 0,
        oldestPendingMinutes: 0,
    };
    it('passes a healthy run', () => {
        expect(dqStatus(evaluateDataQuality(ok))).toBe('ok');
    });
    it('flags high reject rate, unknown skills and stale pipeline', () => {
        const checks = evaluateDataQuality({
            ...ok,
            rejected: 20,
            unknownSkillEvents: 40,
            oldestPendingMinutes: 120,
        });
        const failed = checks.filter((c) => !c.passed).map((c) => c.name);
        expect(failed).toEqual(
            expect.arrayContaining([
                'reject_rate',
                'unknown_skill_rate',
                'freshness_lag_minutes',
            ])
        );
        expect(dqStatus(checks)).toBe('degraded');
    });
    it('handles empty runs without NaN', () => {
        const checks = evaluateDataQuality({
            ...ok,
            read: 0,
            rejected: 0,
            questionEvents: 0,
            unknownSkillEvents: 0,
        });
        expect(checks.every((c) => Number.isFinite(c.value))).toBe(true);
    });
});
