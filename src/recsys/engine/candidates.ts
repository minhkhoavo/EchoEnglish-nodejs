import { Candidate, RecContext, ResourceLike } from './types.js';
import {
    isActionableSkill,
    skillExamWeight,
    skillLabel,
} from '../features/skillTaxonomy.js';
import { SkillFeature } from '../features/featureModels.js';
import {
    cefrFit,
    cefrFromLevel,
    cefrFromToeic,
    Cefr,
    parseCefr,
} from './cefr.js';
import {
    estimateResourceMinutes,
    lowerAll,
    topicKeywordsForSkill,
    topicMatchLC,
} from './contentTags.js';

export const TARGET_MASTERY = 0.8;
const MIN_ATTEMPTS = 3;
const MAX_WEAK_SKILLS = 6;
const MAX_RESOURCE_CANDIDATES = 40;
const SECONDS_PER_CARD = 25;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function learnerCefr(ctx: RecContext): Cefr | undefined {
    const score = ctx.features?.performance.lastTestScore;
    if (ctx.personalization && typeof score === 'number')
        return cefrFromToeic(score);
    return cefrFromLevel(ctx.profile.level);
}

export type RecMode = 'personalized' | 'cold_start';

/** Personalised only with consent AND enough evidence on at least one skill. */
export function decideMode(ctx: RecContext): RecMode {
    if (!ctx.personalization || !ctx.features) return 'cold_start';
    // Only actionable skills count as evidence: `unknown` / `part:N` cannot be drilled.
    return ctx.features.skills.some(
        (s) => s.n >= MIN_ATTEMPTS && isActionableSkill(s.skillKey)
    )
        ? 'personalized'
        : 'cold_start';
}

export interface WeakSkill extends SkillFeature {
    need: number;
}

/** need = gap-to-target × exam weight × evidence. Higher = fixing it moves the score most. */
export function rankWeakSkills(skills: SkillFeature[]): WeakSkill[] {
    return skills
        .filter((s) => s.n >= MIN_ATTEMPTS && isActionableSkill(s.skillKey))
        .map((s) => {
            const gap =
                Math.max(0, TARGET_MASTERY - s.mastery) / TARGET_MASTERY;
            const weight =
                0.6 + 0.4 * Math.min(1, skillExamWeight(s.skillKey) / 0.25);
            return {
                ...s,
                need: clamp01(gap * weight * (0.5 + 0.5 * s.confidence)),
            };
        })
        .filter((s) => s.need > 0.05)
        .sort((a, b) => b.need - a.need || a.skillKey.localeCompare(b.skillKey))
        .slice(0, MAX_WEAK_SKILLS);
}

function srsCandidate(ctx: RecContext): Candidate | null {
    const f = ctx.features;
    if (!f || f.srs.due <= 0) return null;
    const count = Math.min(f.srs.due, 20);
    const retentionRisk =
        f.srs.avgRetrievability === null ? 0.3 : 1 - f.srs.avgRetrievability;
    const urgency = clamp01(
        0.6 * Math.min(1, f.srs.due / 20) + 0.4 * clamp01(retentionRisk * 3)
    );
    const away =
        f.activity.daysSinceActive !== null && f.activity.daysSinceActive >= 7;
    return {
        id: 'flashcard_review:due',
        type: 'flashcard_review',
        ref: 'due',
        title: `Review ${count} due flashcards`,
        estMinutes: Math.max(2, Math.ceil((count * SECONDS_PER_CARD) / 60)),
        signals: { srs: urgency },
        reason: away
            ? {
                  code: 'welcome_back',
                  params: { days: f.activity.daysSinceActive ?? 7, count },
              }
            : {
                  code: 'srs_due',
                  params: {
                      count,
                      minutes: Math.max(
                          2,
                          Math.ceil((count * SECONDS_PER_CARD) / 60)
                      ),
                  },
              },
        action: { screen: 'flashcard_review', count },
    };
}

function drillCandidates(weak: WeakSkill[], all: SkillFeature[]): Candidate[] {
    const out = new Map<string, Candidate>();
    for (const s of weak) {
        out.set(s.skillKey, {
            id: `skill_drill:${s.skillKey}`,
            type: 'skill_drill',
            ref: s.skillKey,
            title: `Practice: ${skillLabel(s.skillKey)}`,
            estMinutes: 10,
            skillKey: s.skillKey,
            signals: { need: s.need, explore: 1 - s.confidence },
            reason: {
                code: 'weak_skill',
                params: {
                    skill: skillLabel(s.skillKey),
                    pct: Math.round(s.mastery * 100),
                    n: s.n,
                },
            },
            action: {
                screen: 'skill_drill',
                skillKey: s.skillKey,
                questions: 10,
            },
        });
    }
    // exploration: thinly-evidenced skills where one drill would cut uncertainty the most
    for (const s of all) {
        if (!isActionableSkill(s.skillKey)) continue;
        if (out.has(s.skillKey) || s.n < 1 || s.confidence >= 0.5) continue;
        out.set(s.skillKey, {
            id: `skill_drill:${s.skillKey}`,
            type: 'skill_drill',
            ref: s.skillKey,
            title: `Practice: ${skillLabel(s.skillKey)}`,
            estMinutes: 8,
            skillKey: s.skillKey,
            signals: { explore: 1 - s.confidence },
            reason: {
                code: 'explore_skill',
                params: { skill: skillLabel(s.skillKey) },
            },
            action: {
                screen: 'skill_drill',
                skillKey: s.skillKey,
                questions: 8,
            },
        });
    }
    return [...out.values()];
}

function resourceCandidates(
    ctx: RecContext,
    weak: WeakSkill[],
    cefr: Cefr | undefined
): Candidate[] {
    const out: Candidate[] = [];
    // Hot loop (resources × weak skills): lower-case keywords once per skill, topics once per resource.
    const wanted = weak.map((w) => ({
        w,
        kw: lowerAll(topicKeywordsForSkill(w.skillKey)),
    }));
    const interestsLC = new Set(lowerAll(ctx.profile.interests));
    for (const r of ctx.resources) {
        if (r.suitableForLearners === false) continue;
        const id = r._id.toString();
        const rc = parseCefr(r.labels?.cefr);
        const fit = cefrFit(cefr, rc);
        const domain = r.labels?.domain?.toLowerCase();
        const interested = !!domain && interestsLC.has(domain);
        const topicsLC = lowerAll(r.labels?.topic);
        let bestNeed = 0;
        let bestSkill: WeakSkill | undefined;
        for (const { w, kw } of wanted) {
            const m = topicMatchLC(topicsLC, kw);
            if (m > 0 && w.need * m > bestNeed) {
                bestNeed = w.need * m;
                bestSkill = w;
            }
        }
        const pop = ctx.popularity.get(id) ?? 0;
        // Level fit alone is a weak reason: it only qualifies a resource in cold start
        // (no weak skills known). Otherwise we need a skill, interest or popularity signal.
        const levelOnlyOk = weak.length === 0 && fit === 1;
        if (!bestSkill && !interested && pop === 0 && !levelOnlyOk) continue;
        out.push({
            id: `resource:${id}`,
            type: 'resource',
            ref: id,
            title: r.title ?? 'Untitled resource',
            estMinutes: estimateResourceMinutes(r),
            skillKey: bestSkill?.skillKey,
            cefr: rc,
            signals: {
                need: bestNeed,
                interest: interested ? 1 : 0,
                levelFit: fit,
                popularity: pop,
            },
            reason: bestSkill
                ? {
                      code: 'weak_skill',
                      params: {
                          skill: skillLabel(bestSkill.skillKey),
                          pct: Math.round(bestSkill.mastery * 100),
                          n: bestSkill.n,
                      },
                  }
                : interested
                  ? {
                        code: 'interest_match',
                        params: {
                            domain: r.labels?.domain ?? '',
                            cefr: rc ?? '',
                        },
                    }
                  : pop > 0.3
                    ? {
                          code: 'popular_for_level',
                          params: { cefr: cefr ?? '' },
                      }
                    : { code: 'level_fit', params: { cefr: rc ?? cefr ?? '' } },
            action: { screen: 'resource', resourceId: id },
        });
    }
    return out
        .sort(
            (a, b) => sumSignals(b) - sumSignals(a) || a.id.localeCompare(b.id)
        )
        .slice(0, MAX_RESOURCE_CANDIDATES);
}
const sumSignals = (c: Candidate) =>
    Object.values(c.signals).reduce((a, b) => a + (b ?? 0), 0);

function habitCandidates(ctx: RecContext): Candidate[] {
    const f = ctx.features;
    const out: Candidate[] = [];
    const noTestEver =
        !f ||
        (f.daysSince.test === null && f.performance.lastTestScore === null);
    if (noTestEver) {
        out.push({
            id: 'mock_test:starter',
            type: 'mock_test',
            ref: 'starter',
            title: 'Take a short diagnostic test',
            estMinutes: 20,
            signals: { habit: 1 },
            boost: 0.5,
            reason: { code: 'starter_diagnostic', params: {} },
            action: { screen: 'test_list', mode: 'diagnostic' },
        });
    } else if (f && (f.daysSince.test === null || f.daysSince.test >= 21)) {
        const days = f.daysSince.test ?? 30;
        out.push({
            id: 'mock_test:progress',
            type: 'mock_test',
            ref: 'progress',
            title: 'Take a mini test to track progress',
            estMinutes: 25,
            signals: { habit: clamp01(days / 30) },
            reason: { code: 'habit_test', params: { days } },
            action: { screen: 'test_list', mode: 'progress' },
        });
    }
    if (
        f &&
        f.daysSince.pronunciation !== null &&
        f.daysSince.pronunciation >= 7
    ) {
        out.push({
            id: 'pronunciation_practice:daily',
            type: 'pronunciation_practice',
            ref: 'daily',
            title: 'Practise pronunciation',
            estMinutes: 5,
            signals: { habit: clamp01(f.daysSince.pronunciation / 21) },
            reason: {
                code: 'habit_pronunciation',
                params: { days: f.daysSince.pronunciation },
            },
            action: { screen: 'speech_practice' },
        });
    }
    if (f && f.daysSince.vocab !== null && f.daysSince.vocab >= 7) {
        out.push({
            id: 'vocab_capture:daily',
            type: 'vocab_capture',
            ref: 'daily',
            title: 'Capture new words around you',
            estMinutes: 5,
            signals: { habit: clamp01(f.daysSince.vocab / 21) },
            reason: {
                code: 'habit_vocab',
                params: { days: f.daysSince.vocab },
            },
            action: { screen: 'vocab_capture' },
        });
    }
    return out;
}

/**
 * Candidate generation. Without personalisation consent/data only SRS due-cards (the
 * learner's own deck), starter diagnostic, and interest/level/popularity resources are used.
 */
export function generateCandidates(ctx: RecContext): Candidate[] {
    const mode = decideMode(ctx);
    const cefr = learnerCefr(ctx);
    const out: Candidate[] = [];

    const srs = srsCandidate(ctx);
    if (srs) out.push(srs);

    if (mode === 'personalized' && ctx.features) {
        const weak = rankWeakSkills(ctx.features.skills);
        out.push(...drillCandidates(weak, ctx.features.skills));
        out.push(...resourceCandidates(ctx, weak, cefr));
        out.push(...habitCandidates(ctx));
    } else {
        out.push(...resourceCandidates(ctx, [], cefr));
        // habit nudges rely on behavioural features → only the starter diagnostic in cold start
        out.push(
            ...habitCandidates({
                ...ctx,
                features: ctx.personalization ? ctx.features : null,
            })
        );
    }
    return out;
}

export type { ResourceLike };
