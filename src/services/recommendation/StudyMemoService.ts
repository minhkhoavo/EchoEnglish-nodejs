import { Schema, Types } from 'mongoose';
import { Roadmap, StudyMemoType } from '../../models/roadmapModel.js';
import { Resource, ResourceTypeModel } from '../../models/resource.js';
import { User } from '../../models/userModel.js';
import {
    memoAnalysisAIService,
    MemoAnalysisResult,
    MemoMaterialInput,
} from '../../ai/service/memoAnalysisAIService.js';
import { ApiError } from '../../middleware/apiError.js';
import { ErrorMessage } from '../../enum/errorMessage.js';

interface MaterialRefInput {
    refType: 'file' | 'resource';
    refId: string;
}

// Material enriched with everything both the analyze prompt and the daily-plan
// injection need.
export interface ResolvedMaterial {
    refType: 'file' | 'resource';
    refId: Types.ObjectId;
    title: string;
    resourceType: string; // type used for StudyPlan resource ('article' | 'video' | ...)
    url?: string;
    description?: string;
    cefr?: string;
    domains: string[];
    summary?: string;
    content?: string; // actual text of the resource (for content-grounded lessons)
    labels?: { domain?: string; topic?: string[] };
}

interface AnalyzeMemoInput {
    materials: MaterialRefInput[];
    note?: string;
    scope: 'date' | 'week';
    targetDate?: string;
    targetWeekNumber?: number;
    preferredDays?: number;
}

interface ConfirmMemoInput extends AnalyzeMemoInput {
    suitability: { isSuitable: boolean; reason?: string; cefrFit?: string };
    dayPlan: Array<{ order: number; focus: string }>;
    supplementedWeaknesses?: Array<{
        skillKey: string;
        skillName: string;
        severity: 'critical' | 'high' | 'medium' | 'low';
        reason?: string;
    }>;
}

const SEVERITY_TO_ACCURACY: Record<string, number> = {
    critical: 20,
    high: 35,
    medium: 50,
    low: 65,
};

export class StudyMemoService {
    /**
     * Resolve material references (file/resource) into a normalized shape that is
     * reused by both the analyze prompt and the daily-plan injection.
     */
    async resolveMaterials(
        materials: MaterialRefInput[]
    ): Promise<ResolvedMaterial[]> {
        const resolved: ResolvedMaterial[] = [];

        for (const m of materials) {
            const resource = (await Resource.findById(
                m.refId
            ).lean()) as unknown as ResourceTypeModel | null;
            if (!resource) continue;
            const labels = (resource.labels || {}) as NonNullable<
                ResourceTypeModel['labels']
            >;
            resolved.push({
                refType: 'resource',
                refId: resource._id as Types.ObjectId,
                title: resource.title as string,
                resourceType: resource.type as string,
                url: resource.url as string,
                description: resource.summary as string,
                cefr: labels.cefr as string,
                domains: labels.domain ? [labels.domain as string] : [],
                summary: resource.summary as string,
                content: resource.content as string,
                labels: {
                    domain: labels.domain as string,
                    topic: (labels.topic as string[]) || [],
                },
            });
        }

        return resolved;
    }

    /**
     * Step A — analyze whether the material(s) fit the learner, propose a
     * multi-day breakdown, and surface weaknesses to supplement. Nothing saved.
     */
    async analyzeMemo(
        userId: Schema.Types.ObjectId | string,
        input: AnalyzeMemoInput
    ): Promise<{
        analysis: MemoAnalysisResult;
        materials: ResolvedMaterial[];
    }> {
        const resolved = await this.resolveMaterials(input.materials);
        if (resolved.length === 0) {
            throw new ApiError(ErrorMessage.RESOURCE_NOT_FOUND);
        }

        const roadmap = (await Roadmap.findOne({ userId, status: 'active' })
            .select('studyTimePerDay currentLevel')
            .lean()) as unknown as {
            studyTimePerDay?: number;
            currentLevel?: string;
        } | null;

        const user = (await User.findById(userId)
            .select('competencyProfile')
            .lean()) as unknown as {
            competencyProfile?: CompetencyProfile;
        } | null;
        const profile = user?.competencyProfile;

        const weakSkills = profile?.skillMatrix
            ?.filter((s) => (s.currentAccuracy ?? 100) < 60)
            .sort(
                (a, b) =>
                    (a.currentAccuracy as number) -
                    (b.currentAccuracy as number)
            )
            .slice(0, 5)
            .map((s) => ({
                skill: s.skill,
                accuracy: s.currentAccuracy as number,
            }));

        const weakDomains = profile?.domainProficiency
            ?.filter((d) => (d.accuracy ?? 100) < 60)
            .sort((a, b) => (a.accuracy as number) - (b.accuracy as number))
            .slice(0, 5)
            .map((d) => ({ domain: d.domain, accuracy: d.accuracy as number }));

        const abilityNotes = profile?.aiInsights
            ?.slice(-5)
            .map((i) => `${i.title}: ${i.description}`);

        const materialsForPrompt: MemoMaterialInput[] = resolved.map((r) => ({
            title: r.title,
            type: r.refType,
            cefr: r.cefr,
            domains: r.domains,
            summary: r.summary,
        }));

        // Cap study days: a single resource should never stretch into a long
        // multi-day plan (one article over 4-5 days is unreasonable).
        const maxDays = resolved.length <= 1 ? 2 : 5;

        const analysis = await memoAnalysisAIService.analyzeMemo({
            note: input.note || '',
            studyTimePerDay: (roadmap?.studyTimePerDay as number) || 30,
            targetScope: input.scope,
            preferredDays: input.preferredDays || 0,
            maxDays,
            materials: materialsForPrompt,
            learnerProfile: {
                currentLevel:
                    (profile?.currentCEFRLevel as string) ||
                    (roadmap?.currentLevel as string) ||
                    'B1',
                weakSkills,
                weakDomains,
                abilityNotes,
            },
        });

        // Enforce the cap regardless of what the LLM returned.
        if (
            Array.isArray(analysis.dayPlan) &&
            analysis.dayPlan.length > maxDays
        ) {
            analysis.dayPlan = analysis.dayPlan.slice(0, maxDays);
        }
        analysis.suggestedTotalDays = Math.min(
            analysis.suggestedTotalDays || analysis.dayPlan?.length || 1,
            maxDays
        );

        return { analysis, materials: resolved };
    }

    /**
     * Step B — persist the confirmed memo into roadmap.studyMemos and supplement
     * the learner's competency profile with any newly surfaced weaknesses.
     */
    async confirmMemo(
        userId: Schema.Types.ObjectId | string,
        input: ConfirmMemoInput
    ): Promise<StudyMemoType> {
        const roadmap = await Roadmap.findOne({ userId, status: 'active' });
        if (!roadmap) {
            throw new ApiError(ErrorMessage.ROADMAP_NOT_FOUND);
        }

        const resolved = await this.resolveMaterials(input.materials);
        if (resolved.length === 0) {
            throw new ApiError(ErrorMessage.RESOURCE_NOT_FOUND);
        }

        const dayPlan = [...input.dayPlan]
            .sort((a, b) => a.order - b.order)
            .map((d, idx) => ({
                order: idx + 1,
                focus: d.focus,
                status: 'pending' as const,
            }));

        roadmap.studyMemos.push({
            materials: resolved.map((r) => ({
                refType: r.refType,
                refId: r.refId,
                title: r.title,
            })),
            note: input.note,
            scope: input.scope,
            targetDate:
                input.scope === 'date' && input.targetDate
                    ? new Date(input.targetDate)
                    : undefined,
            targetWeekNumber:
                input.scope === 'week' ? input.targetWeekNumber : undefined,
            suitability: {
                isSuitable: input.suitability.isSuitable,
                reason: input.suitability.reason,
                cefrFit: input.suitability.cefrFit,
            },
            totalDays: dayPlan.length,
            dayPlan,
            status: 'active',
        });

        await roadmap.save();

        // Supplement competency profile with newly surfaced weaknesses.
        if (
            input.supplementedWeaknesses &&
            input.supplementedWeaknesses.length > 0
        ) {
            await this.supplementCompetency(
                userId,
                input.supplementedWeaknesses
            );
        }

        return roadmap.studyMemos[
            roadmap.studyMemos.length - 1
        ] as StudyMemoType;
    }

    private async supplementCompetency(
        userId: Schema.Types.ObjectId | string,
        weaknesses: Array<{
            skillKey: string;
            skillName: string;
            severity: 'critical' | 'high' | 'medium' | 'low';
            reason?: string;
        }>
    ): Promise<void> {
        const user = await User.findById(userId).select('competencyProfile');
        if (!user) return;

        if (!user.competencyProfile) {
            user.competencyProfile = {};
        }
        const profile = user.competencyProfile;
        profile.skillMatrix = profile.skillMatrix || [];
        profile.aiInsights = profile.aiInsights || [];

        for (const w of weaknesses) {
            const existing = profile.skillMatrix.find(
                (s: { skill: string }) => s.skill === w.skillKey
            );
            if (!existing) {
                profile.skillMatrix.push({
                    skill: w.skillKey,
                    currentAccuracy: SEVERITY_TO_ACCURACY[w.severity] ?? 50,
                    proficiency: 'weak',
                    totalQuestions: 0,
                    correctAnswers: 0,
                    accuracyHistory: [],
                });
            }

            // Record an ability note so future LLM passes understand this gap.
            profile.aiInsights.push({
                title: `Weakness from your material: ${w.skillName}`,
                description:
                    w.reason ||
                    `Detected from a study material you added (${w.severity} severity).`,
                actionText: `Practice ${w.skillName}`,
                priority:
                    w.severity === 'critical' || w.severity === 'high'
                        ? 'high'
                        : w.severity === 'medium'
                          ? 'medium'
                          : 'low',
                createdAt: new Date(),
            });
        }

        profile.lastUpdated = new Date();
        user.markModified('competencyProfile');
        await user.save();
    }

    /**
     * Find the active memo that applies today and the next study day to deliver.
     * `roadmap` is expected to be a lean roadmap object.
     */
    getActiveMemoForToday(
        roadmap: {
            studyMemos?: StudyMemoType[];
            activeWeekNumber?: number;
        },
        today: Date
    ): { memo: StudyMemoType; dayItem: StudyMemoType['dayPlan'][0] } | null {
        const memos = roadmap.studyMemos || [];
        const activeWeek = roadmap.activeWeekNumber || 1;

        for (const memo of memos) {
            if (memo.status !== 'active') continue;

            // 'date' scope is a START date: the multi-day breakdown is delivered
            // from targetDate onwards (one pending day per study day) until done.
            const matchesToday =
                memo.scope === 'date'
                    ? memo.targetDate
                        ? this.startOfDay(new Date(memo.targetDate)) <=
                          this.startOfDay(today)
                        : false
                    : memo.targetWeekNumber === activeWeek;

            if (!matchesToday) continue;

            const dayItem = memo.dayPlan.find((d) => d.status !== 'done');
            if (dayItem) {
                return { memo, dayItem };
            }
        }

        return null;
    }

    private startOfDay(d: Date): number {
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        return x.getTime();
    }

    /**
     * Mark the delivered day as in-progress so regeneration stays on the same
     * day and completion can advance it deterministically.
     */
    async markDayInProgress(
        roadmapId: string,
        memoId: Types.ObjectId | string,
        dayId: Types.ObjectId | string
    ): Promise<void> {
        await Roadmap.updateOne(
            { roadmapId },
            {
                $set: {
                    'studyMemos.$[memo].dayPlan.$[day].status': 'in-progress',
                },
            },
            {
                arrayFilters: [
                    { 'memo._id': new Types.ObjectId(memoId.toString()) },
                    {
                        'day._id': new Types.ObjectId(dayId.toString()),
                        'day.status': 'pending',
                    },
                ],
            }
        );
    }

    /**
     * On daily-session completion, advance any memo whose current day was
     * in-progress today; mark the memo completed once all days are done.
     */
    async markActiveMemoDayDone(
        userId: Schema.Types.ObjectId | string
    ): Promise<void> {
        const roadmap = await Roadmap.findOne({ userId, status: 'active' });
        if (!roadmap || !roadmap.studyMemos?.length) return;

        let changed = false;
        for (const memo of roadmap.studyMemos) {
            if (memo.status !== 'active') continue;
            const inProgress = memo.dayPlan.find(
                (d: { status: string }) => d.status === 'in-progress'
            );
            if (inProgress) {
                inProgress.status = 'done';
                changed = true;
            }
            if (
                memo.dayPlan.every(
                    (d: { status: string }) => d.status === 'done'
                )
            ) {
                memo.status = 'completed';
                changed = true;
            }
        }

        if (changed) {
            roadmap.markModified('studyMemos');
            await roadmap.save();
        }
    }

    async deleteMemo(
        userId: Schema.Types.ObjectId | string,
        memoId: string
    ): Promise<void> {
        const result = await Roadmap.updateOne(
            { userId, status: 'active' },
            { $pull: { studyMemos: { _id: new Types.ObjectId(memoId) } } }
        );
        if (result.matchedCount === 0) {
            throw new ApiError(ErrorMessage.ROADMAP_NOT_FOUND);
        }
    }
}

interface CompetencyProfile {
    currentCEFRLevel?: string;
    skillMatrix?: Array<{ skill: string; currentAccuracy?: number }>;
    domainProficiency?: Array<{ domain: string; accuracy?: number }>;
    aiInsights?: Array<{ title: string; description: string }>;
}

export const studyMemoService = new StudyMemoService();
