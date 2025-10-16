import { StudyPlanType, StudyPlan } from '../../models/studyPlanModel.js';
import { Schema } from 'mongoose';
import { roadmapService } from './RoadmapService.js';

export class ProgressTrackingService {
    private readonly AUTO_COMPLETE_THRESHOLD = 5; // seconds
    calculatePlanItemProgress(planItem: StudyPlanType['planItems'][0]): void {
        const totalActivities =
            (planItem.resources?.length || 0) +
            (planItem.practiceDrills?.length || 0);

        if (totalActivities === 0) {
            planItem.progress = 0;
            return;
        }

        const completedActivities =
            (planItem.resources?.filter((r) => r.completed).length || 0) +
            (planItem.practiceDrills?.filter((d) => d.completed).length || 0);

        planItem.progress = Math.round(
            (completedActivities / totalActivities) * 100
        );

        // Auto update status based on progress
        if (planItem.progress === 100) {
            planItem.status = 'completed';
            if (!planItem.completedAt) {
                planItem.completedAt = new Date();
            }
        } else if (planItem.progress > 0 && planItem.status === 'pending') {
            planItem.status = 'in-progress';
            if (!planItem.startedAt) {
                planItem.startedAt = new Date();
            }
        }
    }

    calculateSessionProgress(session: StudyPlanType): void {
        const totalItems = session.planItems.length;

        if (totalItems === 0) {
            session.progress = 0;
            return;
        }

        const completedItems = session.planItems.filter(
            (item) => item.status === 'completed'
        ).length;

        session.progress = Math.round((completedItems / totalItems) * 100);

        // Auto update status based on progress
        if (session.progress === 100) {
            session.status = 'completed';
            if (!session.completedAt) {
                session.completedAt = new Date();
            }
        } else if (session.progress > 0 && session.status === 'upcoming') {
            session.status = 'in-progress';
            if (!session.startedAt) {
                session.startedAt = new Date();
            }
        }
    }

    updateProgressCascade(
        session: StudyPlanType,
        planItem: StudyPlanType['planItems'][0]
    ): void {
        // Step 1: Calculate plan item progress
        this.calculatePlanItemProgress(planItem);

        // Step 2: Calculate session progress (dựa trên tất cả plan items)
        this.calculateSessionProgress(session);
    }

    async autoScanAndUpdateProgress(
        session: StudyPlanType,
        autoCompleteSession: boolean = false
    ): Promise<void> {
        // Step 1: Scan all plan items
        for (const planItem of session.planItems) {
            this.calculatePlanItemProgress(planItem);
        }

        // Step 2: Scan session
        const wasCompleted = session.status === 'completed';
        this.calculateSessionProgress(session);

        // Step 3: Auto complete session and update roadmap if enabled
        if (
            autoCompleteSession &&
            !wasCompleted &&
            session.progress === 100 &&
            session.status === 'completed'
        ) {
            await this.updateRoadmapWhenSessionComplete(session);
        }
    }

    private async updateRoadmapWhenSessionComplete(
        session: StudyPlanType
    ): Promise<void> {
        try {
            const roadmap = await roadmapService.getActiveRoadmap(
                session.userId.toString()
            );

            let singleRoadmap: unknown;
            if (Array.isArray(roadmap)) {
                singleRoadmap = roadmap[0];
            } else {
                singleRoadmap = roadmap;
            }

            if ((singleRoadmap as { roadmapId?: string })?.roadmapId) {
                await roadmapService.completeDailySession(
                    (singleRoadmap as { roadmapId: string }).roadmapId,
                    session.weekNumber || 1,
                    session.dayNumber || 1
                );
            }
            console.log(
                `Roadmap auto-updated for user ${session.userId} after session ${session._id} completed.`
            );
        } catch (error) {
            console.error(
                'Failed to auto-update roadmap when session completed:',
                error
            );
        }
    }

    getSessionSummary(session: StudyPlanType): {
        sessionProgress: number;
        sessionStatus: string;
        totalPlanItems: number;
        completedPlanItems: number;
        planItemsSummary: Array<{
            title: string;
            progress: number;
            status: string;
            totalActivities: number;
            completedActivities: number;
        }>;
    } {
        return {
            sessionProgress: session.progress,
            sessionStatus: session.status,
            totalPlanItems: session.planItems.length,
            completedPlanItems: session.planItems.filter(
                (item) => item.status === 'completed'
            ).length,
            planItemsSummary: session.planItems.map((item) => ({
                title: item.title || 'Untitled',
                progress: item.progress || 0,
                status: item.status || 'pending',
                totalActivities:
                    (item.resources?.length || 0) +
                    (item.practiceDrills?.length || 0),
                completedActivities:
                    (item.resources?.filter((r) => r.completed).length || 0) +
                    (item.practiceDrills?.filter((d) => d.completed).length ||
                        0),
            })),
        };
    }

    async trackResourceView(
        sessionId: string,
        itemId: string,
        resourceId: string,
        timeSpent: number
    ): Promise<StudyPlanType> {
        const session = await StudyPlan.findById(sessionId);
        if (!session) {
            throw new Error('SESSION_NOT_FOUND');
        }

        const planItem = session.planItems.find(
            (item: StudyPlanType['planItems'][0]) =>
                item._id?.toString() === itemId
        );
        if (!planItem) {
            throw new Error('PLAN_ITEM_NOT_FOUND');
        }

        const resource = planItem.resources?.find(
            (r: StudyPlanType['planItems'][0]['resources'][0]) =>
                r._id?.toString() === resourceId
        );
        if (!resource) {
            throw new Error('RESOURCE_IN_ITEM_NOT_FOUND');
        }

        if (timeSpent >= this.AUTO_COMPLETE_THRESHOLD && !resource.completed) {
            resource.completed = true;
            resource.completedAt = new Date();
        }

        session.totalTimeSpent = (session.totalTimeSpent || 0) + timeSpent;
        await this.autoScanAndUpdateProgress(session, true); // Enable auto-complete

        await session.save();
        return session;
    }

    async completePracticeDrill(sessionId: string): Promise<StudyPlanType> {
        const session = await StudyPlan.findById(sessionId);
        if (!session) {
            throw new Error('SESSION_NOT_FOUND');
        }

        for (const planItem of session.planItems) {
            if (
                planItem.resourceType === 'practice_drill' &&
                planItem.practiceDrills?.length > 0
            ) {
                const drill = planItem.practiceDrills[0];
                drill.completed = true;
                drill.completedAt = new Date();
            }
        }

        await this.autoScanAndUpdateProgress(session, true); // Enable auto-complete

        await session.save();
        return session;
    }

    async completeDailySession(
        userId: Schema.Types.ObjectId | string,
        sessionId: string
    ): Promise<{
        success: boolean;
        unblocked: boolean;
        message: string;
        canProceed: boolean;
    }> {
        const session = await StudyPlan.findById(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        session.status = 'completed';
        session.progress = 100;
        await session.save();

        const roadmap = await roadmapService.getActiveRoadmap(userId);

        let singleRoadmap: unknown;
        if (Array.isArray(roadmap)) {
            singleRoadmap = roadmap[0];
        } else {
            singleRoadmap = roadmap;
        }

        if (!(singleRoadmap as { roadmapId?: string })?.roadmapId) {
            return {
                success: true,
                unblocked: false,
                message: 'Session completed but no active roadmap found',
                canProceed: true,
            };
        }

        const result = await roadmapService.completeDailySession(
            (singleRoadmap as { roadmapId: string }).roadmapId,
            session.weekNumber || 1,
            session.dayNumber || 1
        );

        return {
            success: true,
            unblocked: result.canProceed,
            message: result.canProceed
                ? 'Session completed and roadmap unblocked, you can proceed.'
                : 'Session completed but there are still critical days that need to be completed.',
            canProceed: result.canProceed,
        };
    }
}

export const progressTrackingService = new ProgressTrackingService();
