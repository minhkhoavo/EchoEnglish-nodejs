import { recsysConfig } from '../config.js';

export interface DqCheck {
    name: string;
    value: number;
    threshold: number;
    passed: boolean;
    severity: 'warn' | 'critical';
}

export interface DqInput {
    read: number;
    rejected: number;
    alreadyClean: number;
    questionEvents: number;
    unknownSkillEvents: number;
    /** Required-field nulls detected in silver output for this run. */
    nullRequiredFields: number;
    /** Age (minutes) of the oldest pending raw event after the run; 0 if none. */
    oldestPendingMinutes: number;
}

const rate = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Pure. Turns run statistics into explicit pass/fail checks (alerting reads these). */
export function evaluateDataQuality(
    i: DqInput,
    t: typeof recsysConfig.dq = recsysConfig.dq
): DqCheck[] {
    const checks: DqCheck[] = [
        {
            name: 'reject_rate',
            value: rate(i.rejected, i.read),
            threshold: t.maxRejectRate,
            severity: 'critical',
            passed: true,
        },
        {
            name: 'duplicate_rate',
            value: rate(i.alreadyClean, i.read),
            threshold: t.maxDuplicateRate,
            severity: 'warn',
            passed: true,
        },
        {
            name: 'unknown_skill_rate',
            value: rate(i.unknownSkillEvents, i.questionEvents),
            threshold: t.maxUnknownSkillRate,
            severity: 'warn',
            passed: true,
        },
        {
            name: 'null_required_fields',
            value: i.nullRequiredFields,
            threshold: 0,
            severity: 'critical',
            passed: true,
        },
        {
            name: 'freshness_lag_minutes',
            value: i.oldestPendingMinutes,
            threshold: t.maxFreshnessLagMinutes,
            severity: 'critical',
            passed: true,
        },
    ];
    for (const c of checks) c.passed = c.value <= c.threshold;
    return checks;
}

export const dqStatus = (checks: DqCheck[]): 'ok' | 'degraded' =>
    checks.every((c) => c.passed) ? 'ok' : 'degraded';
