/* eslint-disable @typescript-eslint/no-explicit-any */
import { metricsCalculatorService } from '~/services/lr-analyze/metricsCalculatorService.js';

describe('MetricsCalculatorService', () => {
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleWarnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
    });

    describe('calculateTimeSpent', () => {
        it('should return 0 for empty timeline', () => {
            expect(
                (metricsCalculatorService as any).calculateTimeSpent([])
            ).toBe(0);
        });

        it('should sum durations if present', () => {
            const timeline = [
                { duration: 10 },
                { duration: 20 },
                { duration: 0 },
                { duration: null },
            ] as any;
            expect(
                (metricsCalculatorService as any).calculateTimeSpent(timeline)
            ).toBe(30);
        });
    });

    describe('calculateQuestionMetrics', () => {
        it('should calculate individual question metrics correctly', () => {
            const answers = [
                {
                    questionNumber: 1,
                    answerTimeline: [
                        { timestamp: 1000, answer: 'A' },
                        { timestamp: 2000, answer: 'B' },
                    ],
                },
                {
                    questionNumber: 2,
                    answerTimeline: [
                        { timestamp: 5000, answer: 'C' }, // single timeline element
                    ],
                },
                {
                    questionNumber: 3,
                    answerTimeline: [], // empty timeline
                },
            ];
            const result = (
                metricsCalculatorService as any
            ).calculateQuestionMetrics(answers);

            expect(result[0].timeToFirstAnswer).toBe(1000);
            expect(result[0].answerChanges).toBe(1);
            expect(result[0].totalTimeSpent).toBe(1000); // 2000 - 1000 = 1000 duration for first element, second is undefined (hits ?? 0)

            expect(result[1].timeToFirstAnswer).toBe(5000);
            expect(result[1].answerChanges).toBe(0);
            expect(result[1].totalTimeSpent).toBe(5000); // single element -> undefined duration -> fallback

            expect(result[2].timeToFirstAnswer).toBe(0);
            expect(result[2].answerChanges).toBe(0);
            expect(result[2].totalTimeSpent).toBe(0);
        });

        it('should fallback to last timestamp if no duration', () => {
            const timeline = [{ timestamp: 10 }, { timestamp: 50 }] as any;
            expect(
                (metricsCalculatorService as any).calculateTimeSpent(timeline)
            ).toBe(50);
        });
    });

    describe('calculateQuestionMetrics', () => {
        it('should correctly calculate metrics with timeline', () => {
            const answers = [
                {
                    questionNumber: 1,
                    selectedAnswer: 'B',
                    isCorrect: true,
                    correctAnswer: 'B',
                    answerTimeline: [
                        { timestamp: 10, answer: 'A' },
                        { timestamp: 30, answer: 'B' },
                    ],
                },
            ];

            const result = (
                metricsCalculatorService as any
            ).calculateQuestionMetrics(answers);
            expect(result).toHaveLength(1);
            expect(result[0].timeToFirstAnswer).toBe(10);
            expect(result[0].answerChanges).toBe(1);
            expect(result[0].totalTimeSpent).toBe(20); // 30 - 10 + 0
            expect(result[0].answerTimeline[0].duration).toBe(20);
            expect(result[0].answerTimeline[1].duration).toBeUndefined(); // Actually it's undefined, which becomes 0 in total
        });

        it('should correctly calculate metrics without timeline', () => {
            const answers = [
                {
                    questionNumber: 2,
                    selectedAnswer: 'A',
                    isCorrect: false,
                    correctAnswer: 'B',
                    // no timeline
                },
            ];

            const result = (
                metricsCalculatorService as any
            ).calculateQuestionMetrics(answers);
            expect(result[0].timeToFirstAnswer).toBe(0);
            expect(result[0].answerChanges).toBe(0);
            expect(result[0].totalTimeSpent).toBe(0);
        });
    });

    describe('calculatePartMetrics', () => {
        it('should calculate metrics for valid parts', () => {
            const answers = [
                { questionNumber: 1, totalTimeSpent: 10, answerChanges: 1 }, // part1
                { questionNumber: 2, totalTimeSpent: 20, answerChanges: 0 }, // part1
                { questionNumber: 3, totalTimeSpent: 50, answerChanges: 2 }, // part1
                { questionNumber: 4, totalTimeSpent: 5, answerChanges: 0 }, // part1
                {
                    questionNumber: 5,
                    totalTimeSpent: 0,
                    answerChanges: undefined,
                }, // part1 (hit fallbacks)
                {
                    questionNumber: 6,
                    totalTimeSpent: undefined,
                    answerChanges: 0,
                }, // part1 (hit fallbacks)
                { questionNumber: 10, totalTimeSpent: 30, answerChanges: 0 }, // part2
            ] as any[];

            const result = (
                metricsCalculatorService as any
            ).calculatePartMetrics(answers, ['part1', 'part2', 'partUnknown']);

            expect(result).toHaveLength(2);

            // part1 checks
            const part1 = result.find((r: any) => r.partName === 'part1');
            expect(part1.questionsCount).toBe(6);
            expect(part1.totalTime).toBe(85); // 10 + 20 + 50 + 5 + 0 + 0
            expect(part1.averageTimePerQuestion).toBe(85 / 6);
            expect(part1.answerChangeRate).toBeCloseTo(33.33, 1); // 2 out of 6 have changes
            expect(part1.slowestQuestions).toEqual([3, 2, 1]); // Top 3 slowest

            // part2 checks
            const part2 = result.find((r: any) => r.partName === 'part2');
            expect(part2.questionsCount).toBe(1);

            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[MetricsCalculator] Unknown part: partUnknown'
            );
        });

        it('should ignore parts with no answers', () => {
            const answers = [
                { questionNumber: 1, totalTimeSpent: 10, answerChanges: 1 },
            ] as any[];
            const result = (
                metricsCalculatorService as any
            ).calculatePartMetrics(answers, ['part1', 'part2']);
            expect(result).toHaveLength(1);
            expect(result[0].partName).toBe('part1');
        });
    });

    describe('calculateOverallMetrics', () => {
        it('should calculate overall metrics correctly', () => {
            const answers = [
                { totalTimeSpent: 10, answerChanges: 1 },
                { totalTimeSpent: 20, answerChanges: 2 },
                { totalTimeSpent: 0, answerChanges: 0 }, // hit fallback branches
                { totalTimeSpent: undefined, answerChanges: undefined }, // hit fallback branches
            ] as any[];
            const partMetrics = [
                { partName: 'part1', totalTime: 10 },
                { partName: 'part2', totalTime: 20 },
                { partName: 'part3', totalTime: 0 }, // hit totalTime 0 branch
            ] as any[];

            const result = (
                metricsCalculatorService as any
            ).calculateOverallMetrics(answers, partMetrics);

            expect(result.totalActiveTime).toBe(30);
            expect(result.averageTimePerQuestion).toBe(8);
            expect(result.totalAnswerChanges).toBe(3);

            expect(result.confidenceScore).toBe(75);

            expect(result.timeDistribution.get('part1')).toBe(33.33);
            expect(result.timeDistribution.get('part2')).toBe(66.67);
        });

        it('should handle zero answers correctly', () => {
            const result = (
                metricsCalculatorService as any
            ).calculateOverallMetrics([], []);
            expect(result.totalActiveTime).toBe(0);
            expect(result.averageTimePerQuestion).toBe(0);
            expect(result.totalAnswerChanges).toBe(0);
            expect(result.confidenceScore).toBe(100);
            expect(result.timeDistribution.size).toBe(0);
        });

        it('should handle negative confidence score by capping at 0', () => {
            const answers = [
                { totalTimeSpent: 10, answerChanges: 10 }, // max is 3, so changes > max -> negative confidence
            ] as any[];
            const result = (
                metricsCalculatorService as any
            ).calculateOverallMetrics(answers, []);
            expect(result.confidenceScore).toBe(0);
        });
    });

    describe('calculateHesitationAnalysis', () => {
        it('should identify top hesitation questions', () => {
            const answers = [
                {
                    questionNumber: 1,
                    answerChanges: 1,
                    timeToFirstAnswer: 5,
                    totalTimeSpent: 10,
                    selectedAnswer: 'A',
                    isCorrect: false,
                    answerTimeline: [{ answer: 'B' }, { answer: 'A' }],
                },
                {
                    questionNumber: 2,
                    answerChanges: 5,
                    timeToFirstAnswer: 5,
                    totalTimeSpent: 10,
                    selectedAnswer: 'B',
                    isCorrect: true,
                    answerTimeline: [
                        { answer: 'A' },
                        { answer: 'B' },
                        { answer: 'C' },
                    ],
                },
                {
                    questionNumber: 3,
                    answerChanges: 0,
                    timeToFirstAnswer: 5,
                    totalTimeSpent: 10,
                    selectedAnswer: 'C',
                    isCorrect: true,
                },
                {
                    questionNumber: 4,
                    answerChanges: 1,
                    timeToFirstAnswer: 0,
                    totalTimeSpent: undefined,
                    selectedAnswer: 'D',
                    isCorrect: false,
                    answerTimeline: undefined,
                }, // timeToFirstAnswer 0 covers 296 false branch
            ] as any[];

            const result = (
                metricsCalculatorService as any
            ).calculateHesitationAnalysis(answers);

            expect(result.topHesitationQuestions).toHaveLength(3); // Only questions with >0 changes
            expect(result.topHesitationQuestions[0].questionNumber).toBe(2); // Most changes first
            expect(result.topHesitationQuestions[0].changeHistory).toEqual([
                'A',
                'B',
                'C',
            ]);

            expect(result.averageChangesPerQuestion).toBe(1.75); // (1+5+0+1)/4 = 1.75
            expect(result.questionsWithMultipleChanges).toBe(1); // Only question 2 has >= 2 changes
        });

        it('should handle missing fields gracefully', () => {
            const answers = [
                { questionNumber: 1, answerChanges: 1 }, // missing timeline, etc
            ] as any[];
            const result = (
                metricsCalculatorService as any
            ).calculateHesitationAnalysis(answers);
            expect(result.topHesitationQuestions[0].changeHistory).toEqual([]);
        });

        it('should return zeros for empty answers', () => {
            const result = (
                metricsCalculatorService as any
            ).calculateHesitationAnalysis([]);
            expect(result.averageChangesPerQuestion).toBe(0);
            expect(result.questionsWithMultipleChanges).toBe(0);
        });
    });

    describe('calculateAnswerChangePatterns', () => {
        it('should correctly count pattern transitions', () => {
            const answers = [
                {
                    correctAnswer: 'A',
                    answerTimeline: [
                        { answer: 'A' }, // correct
                        { answer: 'B' }, // incorrect -> C to I = 1
                        { answer: 'C' }, // incorrect -> I to I = 1
                        { answer: 'A' }, // correct -> I to C = 1
                        { answer: 'A' }, // correct -> C to C = ignored
                    ],
                },
                {
                    correctAnswer: 'B',
                    answerTimeline: [
                        { answer: 'A' }, // no changes
                    ],
                },
            ] as any[];

            const result = (
                metricsCalculatorService as any
            ).calculateAnswerChangePatterns(answers);

            expect(result.correctToIncorrect).toBe(1);
            expect(result.incorrectToCorrect).toBe(1);
            expect(result.incorrectToIncorrect).toBe(1);
        });

        it('should skip if timeline is missing', () => {
            const result = (
                metricsCalculatorService as any
            ).calculateAnswerChangePatterns([{}] as any[]);
            expect(result.correctToIncorrect).toBe(0);
        });
    });

    describe('validateTimeline', () => {
        it('should return true for empty or undefined timeline', () => {
            expect(
                metricsCalculatorService.validateTimeline(undefined as any)
            ).toBe(true);
            expect(metricsCalculatorService.validateTimeline([])).toBe(true);
        });

        it('should return true for valid timeline', () => {
            const timeline = [
                { timestamp: 10, answer: 'A' },
                { timestamp: 20, answer: 'B' },
            ];
            expect(
                metricsCalculatorService.validateTimeline(timeline as any)
            ).toBe(true);
        });

        it('should return false if timestamps not in order', () => {
            const timeline = [
                { timestamp: 20, answer: 'A' },
                { timestamp: 10, answer: 'B' },
            ];
            expect(
                metricsCalculatorService.validateTimeline(timeline as any)
            ).toBe(false);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[MetricsCalculator] Timeline timestamps not in order'
            );
        });

        it('should return false if any timestamp is negative', () => {
            const timeline = [
                { timestamp: -5, answer: 'A' },
                { timestamp: 10, answer: 'B' },
            ];
            expect(
                metricsCalculatorService.validateTimeline(timeline as any)
            ).toBe(false);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[MetricsCalculator] Negative timestamp detected'
            );
        });
    });

    describe('calculateMetrics (public method)', () => {
        it('should call all internal calculators and return combined result', () => {
            const answers = [
                {
                    questionNumber: 1,
                    selectedAnswer: 'B',
                    isCorrect: true,
                    correctAnswer: 'B',
                    answerTimeline: [
                        { timestamp: 10, answer: 'A' },
                        { timestamp: 30, answer: 'B' },
                    ],
                },
            ];
            const parts = ['part1'];

            const result = metricsCalculatorService.calculateMetrics(
                answers,
                parts
            );

            expect(result.enrichedAnswers).toHaveLength(1);
            expect(result.partMetrics).toHaveLength(1);
            expect(result.overallMetrics).toBeDefined();
            expect(result.hesitationAnalysis).toBeDefined();
            expect(result.answerChangePatterns).toBeDefined();
        });
    });
});
