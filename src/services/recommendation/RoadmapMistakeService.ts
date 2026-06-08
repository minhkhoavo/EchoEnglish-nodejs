import { Schema, Types } from 'mongoose';
import {
    Roadmap,
    MistakeQuestionType,
    RoadmapType,
    WeeklyFocusType,
} from '../../models/roadmapModel.js';

export interface MistakeData {
    questionId: Types.ObjectId | string;
    questionText: string;
    contentTags?: string[];
    skillTag?: string;
    partNumber?: number;
    difficulty?: string;
}

export class RoadmapMistakeService {
    private addMistakeToWeek(
        roadmap: RoadmapType,
        weekNumber: number,
        mistakeData: {
            questionId: Types.ObjectId;
            questionText: string;
            contentTags?: string[];
            skillTag?: string;
            partNumber?: number;
            difficulty?: string;
        }
    ) {
        const week = roadmap.weeklyFocuses.find(
            (w) => w.weekNumber === weekNumber
        );
        if (!week) return;

        if (!week.mistakes) {
            // @ts-expect-error Mongoose DocumentArray type issue
            week.mistakes = [];
        }

        const existingIndex = week.mistakes.findIndex(
            (m) => m.questionId.toString() === mistakeData.questionId.toString()
        );

        if (existingIndex !== -1) {
            const existingMistake = week.mistakes[existingIndex];
            existingMistake.mistakeCount += 1;
            existingMistake.addedDate = new Date();
            week.mistakes.splice(existingIndex, 1);
            week.mistakes.unshift(existingMistake);
        } else {
            week.mistakes.unshift({
                ...mistakeData,
                mistakeCount: 1,
                addedDate: new Date(),
            });
        }
    }

    async addMultipleMistakes(
        userId: Schema.Types.ObjectId | string,
        mistakes: MistakeData[]
    ): Promise<{ success: boolean; message: string; addedCount: number }> {
        const roadmap = await Roadmap.findOne({ userId, status: 'active' });
        if (!roadmap) throw new Error('No active roadmap found');

        const currentWeek = roadmap.currentWeek || 1;
        let addedCount = 0;

        for (const mistake of mistakes) {
            const questionId =
                typeof mistake.questionId === 'string'
                    ? new Types.ObjectId(mistake.questionId)
                    : mistake.questionId;

            this.addMistakeToWeek(roadmap, currentWeek, {
                ...mistake,
                questionId,
            });
            addedCount++;
        }

        await roadmap.save();
        return {
            success: true,
            message: `Added ${addedCount} mistakes to week ${currentWeek} stack`,
            addedCount,
        };
    }

    async removeMistake(
        userId: Schema.Types.ObjectId | string,
        questionId: Types.ObjectId | string,
        weekNumber?: number
    ): Promise<{ success: boolean; message: string }> {
        const roadmap = await Roadmap.findOne({ userId, status: 'active' });
        if (!roadmap) throw new Error('No active roadmap found');

        const targetWeek = weekNumber || roadmap.currentWeek || 1;
        const questionObjectId =
            typeof questionId === 'string'
                ? new Types.ObjectId(questionId)
                : questionId;

        const week = roadmap.weeklyFocuses.find(
            (w: WeeklyFocusType) => w.weekNumber === targetWeek
        );
        if (week && week.mistakes) {
            week.mistakes = week.mistakes.filter(
                (m: MistakeQuestionType) =>
                    m.questionId.toString() !== questionObjectId.toString()
            );
        }

        await roadmap.save();
        return {
            success: true,
            message: `Mistake removed from week ${targetWeek} stack`,
        };
    }

    async getMistakesForPractice(
        userId: Schema.Types.ObjectId | string,
        weekNumber?: number,
        limit: number = 40
    ): Promise<{
        success: boolean;
        mistakes: Array<{
            questionId: string;
            questionText: string;
            contentTags?: string[];
            skillTag?: string;
            partNumber?: number;
            difficulty?: string;
            mistakeCount: number;
        }>;
        weekNumber: number;
    }> {
        const roadmap = await Roadmap.findOne({ userId, status: 'active' });
        if (!roadmap) return { success: false, mistakes: [], weekNumber: 0 };

        const targetWeek = weekNumber || roadmap.currentWeek || 1;
        const week = roadmap.weeklyFocuses.find(
            (w: WeeklyFocusType) => w.weekNumber === targetWeek
        );
        const mistakes = week?.mistakes?.slice(0, limit) || [];

        return {
            success: true,
            mistakes: mistakes.map((mistake: MistakeQuestionType) => ({
                questionId: mistake.questionId.toString(),
                questionText: mistake.questionText,
                contentTags: mistake.contentTags,
                skillTag: mistake.skillTag || undefined,
                partNumber: mistake.partNumber || undefined,
                difficulty: mistake.difficulty || undefined,
                mistakeCount: mistake.mistakeCount,
            })),
            weekNumber: targetWeek,
        };
    }
}

export const roadmapMistakeService = new RoadmapMistakeService();
