import {
    IUserAnswer,
    IPartMetrics,
    IOverallMetrics,
    IAnswerTimeline,
} from '../../models/testResultModel.js';

const PART_QUESTION_RANGES: Record<string, [number, number]> = {
    part1: [1, 6],
    part2: [7, 31],
    part3: [32, 70],
    part4: [71, 100],
    part5: [101, 130],
    part6: [131, 146],
    part7: [147, 200],
};

interface SubmittedAnswer {
    questionNumber: number;
    selectedAnswer: string;
    isCorrect: boolean;
    correctAnswer: string;
    answerTimeline?: IAnswerTimeline[];
}

interface MetricsResult {
    enrichedAnswers: IUserAnswer[];
    partMetrics: IPartMetrics[];
    overallMetrics: IOverallMetrics;
}

class MetricsCalculatorService {
    /**
     * Calculate all metrics from raw timing data
     */
    calculateMetrics(
        userAnswers: SubmittedAnswer[],
        parts: string[]
    ): MetricsResult {
        // 1. Enrich each answer with calculated metrics
        const enrichedAnswers = this.calculateQuestionMetrics(userAnswers);

        // 2. Calculate metrics for each part
        const partMetrics = this.calculatePartMetrics(enrichedAnswers, parts);

        // 3. Calculate overall test metrics
        const overallMetrics = this.calculateOverallMetrics(
            enrichedAnswers,
            partMetrics
        );

        return { enrichedAnswers, partMetrics, overallMetrics };
    }

    /**
     * Calculate metrics for individual questions
     */
    private calculateQuestionMetrics(
        answers: SubmittedAnswer[]
    ): IUserAnswer[] {
        return answers.map((answer) => {
            const timeline = answer.answerTimeline || [];

            // Time to first answer
            const timeToFirstAnswer =
                timeline.length > 0 ? timeline[0].timestamp : 0;

            // Number of answer changes (timeline length - 1)
            const answerChanges = Math.max(0, timeline.length - 1);

            // Calculate total time spent
            // First, compute per-entry durations (time active until next change)
            const timelineWithDurations = timeline.map((t, i) => {
                const next = timeline[i + 1];
                const duration = next
                    ? Math.max(0, next.timestamp - t.timestamp)
                    : undefined;
                return {
                    ...t,
                    duration,
                };
            });

            // Use durations if available; otherwise fallback to last timestamp
            const totalTimeSpent = timelineWithDurations.length
                ? timelineWithDurations.reduce(
                      (sum, t) => sum + (t.duration ?? 0),
                      0
                  ) || this.calculateTimeSpent(timeline)
                : 0;

            return {
                questionNumber: answer.questionNumber,
                selectedAnswer: answer.selectedAnswer,
                isCorrect: answer.isCorrect,
                correctAnswer: answer.correctAnswer,
                // attach timeline augmented with duration where calculated
                answerTimeline:
                    timelineWithDurations as unknown as IAnswerTimeline[],
                timeToFirstAnswer,
                totalTimeSpent,
                answerChanges,
            };
        });
    }

    /**
     * Calculate time spent on a question based on timeline
     * Uses the timestamp of the last answer change
     */
    private calculateTimeSpent(timeline: IAnswerTimeline[]): number {
        if (timeline.length === 0) return 0;

        // Prefer sum of durations if present
        const sumDurations = timeline.reduce(
            (sum, t) => sum + (t.duration || 0),
            0
        );
        if (sumDurations > 0) return sumDurations;

        // Fallback: The last timestamp represents when they finalized this question
        return timeline[timeline.length - 1].timestamp;
    }

    /**
     * Calculate metrics for each part
     */
    private calculatePartMetrics(
        answers: IUserAnswer[],
        parts: string[]
    ): IPartMetrics[] {
        return parts
            .map((partName) => {
                const range = PART_QUESTION_RANGES[partName];
                if (!range) {
                    console.warn(
                        `[MetricsCalculator] Unknown part: ${partName}`
                    );
                    return null;
                }

                const [start, end] = range;
                const partAnswers = answers.filter(
                    (a) => a.questionNumber >= start && a.questionNumber <= end
                );

                if (partAnswers.length === 0) {
                    return null;
                }

                // Total time for this part
                const totalTime = partAnswers.reduce(
                    (sum, a) => sum + (a.totalTimeSpent || 0),
                    0
                );

                // Average time per question
                const averageTimePerQuestion = totalTime / partAnswers.length;

                // Answer change rate (percentage of questions with changes)
                const questionsWithChanges = partAnswers.filter(
                    (a) => (a.answerChanges || 0) > 0
                ).length;
                const answerChangeRate =
                    (questionsWithChanges / partAnswers.length) * 100;

                // Top 3 slowest questions
                const slowestQuestions = [...partAnswers]
                    .sort(
                        (a, b) =>
                            (b.totalTimeSpent || 0) - (a.totalTimeSpent || 0)
                    )
                    .slice(0, 3)
                    .map((a) => a.questionNumber);

                return {
                    partName,
                    questionsCount: partAnswers.length,
                    totalTime,
                    averageTimePerQuestion,
                    answerChangeRate,
                    slowestQuestions,
                };
            })
            .filter((metric): metric is IPartMetrics => metric !== null);
    }

    /**
     * Calculate overall test metrics
     */
    private calculateOverallMetrics(
        answers: IUserAnswer[],
        partMetrics: IPartMetrics[]
    ): IOverallMetrics {
        // Total active time (sum of all question times)
        const totalActiveTime = answers.reduce(
            (sum, a) => sum + (a.totalTimeSpent || 0),
            0
        );

        // Average time per question
        const averageTimePerQuestion =
            answers.length > 0 ? totalActiveTime / answers.length : 0;

        // Total answer changes
        const totalAnswerChanges = answers.reduce(
            (sum, a) => sum + (a.answerChanges || 0),
            0
        );

        // Confidence score: 100 = no changes, decreases with more changes
        // Formula: 100 - (total changes / max possible changes * 100)
        // Assuming max 3 changes per question is reasonable
        const maxPossibleChanges = answers.length * 3;
        const confidenceScore = Math.max(
            0,
            Math.round(100 - (totalAnswerChanges / maxPossibleChanges) * 100)
        );

        // Time distribution across parts
        const timeDistribution = new Map<string, number>();
        if (totalActiveTime > 0) {
            partMetrics.forEach((pm) => {
                const percentage = (pm.totalTime / totalActiveTime) * 100;
                timeDistribution.set(
                    pm.partName,
                    Math.round(percentage * 100) / 100
                );
            });
        }

        return {
            totalActiveTime,
            averageTimePerQuestion: Math.round(averageTimePerQuestion),
            totalAnswerChanges,
            confidenceScore,
            timeDistribution,
        };
    }

    /**
     * Validate that timeline data is reasonable
     */
    validateTimeline(timeline: IAnswerTimeline[]): boolean {
        if (!timeline || timeline.length === 0) return true;

        // Check timestamps are in ascending order
        for (let i = 1; i < timeline.length; i++) {
            if (timeline[i].timestamp < timeline[i - 1].timestamp) {
                console.warn(
                    '[MetricsCalculator] Timeline timestamps not in order'
                );
                return false;
            }
        }

        // Check all timestamps are positive
        if (timeline.some((t) => t.timestamp < 0)) {
            console.warn('[MetricsCalculator] Negative timestamp detected');
            return false;
        }

        return true;
    }
}

export const metricsCalculatorService = new MetricsCalculatorService();
export type { SubmittedAnswer, MetricsResult };
