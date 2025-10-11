import mongoose, { Types } from 'mongoose';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { toeicWritingScoringService } from '~/ai/service/toeicWritingScoringService.js';

type MongoDb = mongoose.mongo.Db;

export interface SubmitAndScoreInput {
    userId: string;
    toeicWritingTestId: string;
    answers: Record<number, string>;
}

interface TestQuestion {
    questionText?: string;
    image?: string;
    clean_title?: string;
    keywords?: string;
    directions?: string[];
    suggestions?: Array<{
        code: string;
        name: string;
        components: Array<{
            code: string;
            name: string;
            sample: string;
            outline: string;
        }>;
    }>;
    time_to_think?: number | null;
    limit_time?: number | null;
    timeToThink?: number | null;
    limitTime?: number | null;
    idea?: string | null;
    sample_answer?: string | null;
    sampleAnswer?: string | null;
}

interface TestPart {
    partTitle?: string;
    partName?: string;
    partDirection?: string;
    direction?: {
        text?: string;
    };
    questions?: TestQuestion[];
}

interface AttemptQuestion {
    questionNumber: number;
    promptText: string;
    promptImage: string | null;
    userAnswer: string | null; // ✅ Always a string (essays are sent as plain text)
    questionMetadata: {
        keywords?: string;
        directions?: string[];
        suggestions?: Array<{
            code: string;
            name: string;
            components: Array<{
                code: string;
                name: string;
                sample: string;
                outline: string;
            }>;
        }>;
        timeToThink?: number | null;
        limitTime?: number | null;
        idea?: string | null;
        sampleAnswer?: string | null;
    };
    result: {
        provider: string;
        scoredAt: Date;
        error?: string;
        // AI result fields are spread directly here (original_text, overall_assessment, detailed_breakdown, etc.)
    } | null;
}

interface AttemptPart {
    partIndex: number;
    partTitle: string;
    partDirection: string;
    questions: AttemptQuestion[];
}

interface AttemptDocument {
    userId: Types.ObjectId;
    toeicWritingTestId: Types.ObjectId;
    submissionTimestamp: Date;
    status:
        | 'in_progress'
        | 'completed'
        | 'scored'
        | 'partially_scored'
        | 'scoring_failed';
    totalScore: number;
    parts: AttemptPart[];
    createdAt: Date;
    updatedAt?: Date;
}

export default class WritingAttemptService {
    private async getDb(): Promise<MongoDb> {
        if (mongoose.connection.readyState !== 1) {
            throw new ApiError(ErrorMessage.INTERNAL_ERROR);
        }
        return mongoose.connection.db!;
    }

    private toObjectId(id: string): Types.ObjectId {
        try {
            return new Types.ObjectId(id);
        } catch {
            throw new ApiError(ErrorMessage.INVALID_ID);
        }
    }

    private getDefaultPartDirection(partIndex: number): string {
        switch (partIndex) {
            case 1:
                return 'Questions 1-5: Write a sentence based on a picture.';
            case 2:
                return 'Questions 6-7: Respond to a written request.';
            case 3:
                return 'Question 8: Write an opinion essay.';
            default:
                return `Part ${partIndex}`;
        }
    }

    /**
     * Gộp 3 bước (start, submitAll, finish) thành 1 API duy nhất
     */
    public async submitAndScore({
        userId,
        toeicWritingTestId,
        answers,
    }: SubmitAndScoreInput): Promise<{ resultId: string }> {
        const db = await this.getDb();

        // Validate test exists
        if (
            typeof toeicWritingTestId !== 'string' ||
            !mongoose.Types.ObjectId.isValid(toeicWritingTestId)
        ) {
            throw new ApiError(ErrorMessage.INVALID_ID);
        }

        const testObjectId = this.toObjectId(toeicWritingTestId);
        const test = await db
            .collection('sw_tests')
            .findOne({ _id: testObjectId });

        if (!test) {
            throw new ApiError(ErrorMessage.TEST_NOT_FOUND);
        }

        // Build attempt structure with answers filled in
        const parts: AttemptPart[] = [];
        let questionCounter = 0;
        const testParts: TestPart[] = Array.isArray(test?.parts)
            ? test.parts
            : [];

        for (let i = 0; i < testParts.length; i++) {
            const part = testParts[i];
            const questions: AttemptQuestion[] = [];
            const rawQuestions: TestQuestion[] = Array.isArray(part.questions)
                ? part.questions
                : [];

            for (const q of rawQuestions) {
                questionCounter += 1;

                // ✅ Get user answer - now only accepts strings
                const rawAnswer = answers[questionCounter] || null;
                let userAnswer: string | null = null;

                if (rawAnswer) {
                    if (typeof rawAnswer === 'string') {
                        userAnswer = rawAnswer;
                    } else {
                        // Reject non-string answers
                        console.warn(
                            `[WritingAttempt] Invalid answer type for question ${questionCounter}: expected string, got ${typeof rawAnswer}`
                        );
                        userAnswer = null;
                    }
                }

                questions.push({
                    questionNumber: questionCounter,
                    promptText: q.questionText || q.clean_title || '',
                    promptImage: q.image || null,
                    userAnswer,
                    questionMetadata: {
                        keywords: q.keywords || q.clean_title,
                        directions: q.directions,
                        suggestions: q.suggestions,
                        timeToThink: q.time_to_think || q.timeToThink,
                        limitTime: q.limit_time || q.limitTime,
                        idea: q.idea,
                        sampleAnswer: q.sample_answer || q.sampleAnswer,
                    },
                    result: null,
                });
            }
            parts.push({
                partIndex: i + 1,
                partTitle: part.partTitle || part.partName || `Part ${i + 1}`,
                partDirection:
                    part.partDirection ||
                    part.direction?.text ||
                    this.getDefaultPartDirection(i + 1),
                questions,
            });
        }

        // Create attempt document with status = 'completed'
        const now = new Date();
        const attemptDoc: AttemptDocument = {
            userId: this.toObjectId(userId),
            toeicWritingTestId: testObjectId,
            submissionTimestamp: now,
            status: 'completed',
            totalScore: 0,
            parts,
            createdAt: now,
        };

        const result = await db
            .collection('toeic_writing_results')
            .insertOne(attemptDoc);

        const resultId = result.insertedId.toString();

        // Trigger background scoring (async - don't wait)
        this.scoreAllQuestions(resultId).catch((err) => {
            console.error('[WritingAttempt] Background scoring failed:', err);
        });

        return { resultId };
    }

    private async scoreAllQuestions(attemptId: string) {
        const db = await this.getDb();
        const attemptObjectId = this.toObjectId(attemptId);

        const attempt = (await db
            .collection('toeic_writing_results')
            .findOne({ _id: attemptObjectId })) as AttemptDocument | null;

        if (!attempt) return;

        let totalOverallScore = 0;
        let scoredQuestionsCount = 0;
        let failedQuestionsCount = 0;
        let totalQuestionsWithAnswers = 0;

        // Collect all questions that need scoring
        const scoringTasks: Array<{
            question: AttemptQuestion;
            context: {
                partType: 1 | 2 | 3;
                questionPrompt: string;
                imageUrl?: string | null;
                keywords?: string;
                directions?: string[];
                suggestions?: Array<{
                    code: string;
                    name: string;
                    components: Array<{
                        code: string;
                        name: string;
                        sample: string;
                        outline: string;
                    }>;
                }>;
                userAnswer: string; // ✅ Always a string
            };
        }> = [];

        for (const part of attempt.parts) {
            for (const question of part.questions) {
                if (!question.userAnswer) continue;
                totalQuestionsWithAnswers += 1;

                const partType = part.partIndex as 1 | 2 | 3;

                // ✅ userAnswer is always a string now
                const userAnswerText = question.userAnswer;

                const context = {
                    partType,
                    questionPrompt: question.promptText,
                    imageUrl: question.promptImage,
                    keywords: question.questionMetadata.keywords,
                    directions: question.questionMetadata.directions,
                    suggestions: question.questionMetadata.suggestions,
                    userAnswer: userAnswerText,
                };

                scoringTasks.push({ question, context });
            }
        }

        console.log(
            `[WritingAttempt] Starting parallel scoring for ${scoringTasks.length} questions...`
        );

        // Score all questions in parallel
        const scoringResults = await Promise.allSettled(
            scoringTasks.map(async ({ question, context }) => {
                try {
                    console.log(
                        `[WritingAttempt] Scoring question ${question.questionNumber}...`
                    );
                    const aiResult =
                        await toeicWritingScoringService.scoreWriting(context);

                    return { question, aiResult, success: true };
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    const errorStack =
                        error instanceof Error ? error.stack : '';
                    console.error(
                        `[WritingAttempt] Scoring failed for question ${question.questionNumber}:`,
                        '\nError:',
                        errorMessage,
                        '\nStack:',
                        errorStack,
                        '\nContext:',
                        JSON.stringify(context, null, 2)
                    );
                    return {
                        question,
                        error: errorMessage,
                        errorStack,
                        success: false,
                    };
                }
            })
        );

        // Process results and save to database
        for (const result of scoringResults) {
            if (result.status === 'fulfilled') {
                const { question, aiResult, success } = result.value;

                if (success && aiResult) {
                    // Process upgraded_text: convert \n to <br> for HTML rendering
                    const processedResult = { ...aiResult };
                    if (
                        processedResult.upgraded_text &&
                        typeof processedResult.upgraded_text === 'string'
                    ) {
                        // Replace literal \n characters and actual newlines with <br>
                        processedResult.upgraded_text =
                            processedResult.upgraded_text
                                .replace(/\\n/g, '<br>')
                                .replace(/\n/g, '<br>');
                    }

                    // Save successful result
                    await db.collection('toeic_writing_results').updateOne(
                        {
                            _id: attemptObjectId,
                            'parts.questions.questionNumber':
                                question.questionNumber,
                        },
                        {
                            $set: {
                                'parts.$[part].questions.$[question].result': {
                                    provider: 'toeicWritingScoringService',
                                    scoredAt: new Date(),
                                    ...processedResult,
                                },
                            },
                        },
                        {
                            arrayFilters: [
                                {
                                    'part.questions.questionNumber':
                                        question.questionNumber,
                                },
                                {
                                    'question.questionNumber':
                                        question.questionNumber,
                                },
                            ],
                        }
                    );

                    // Accumulate overall score
                    const overallScore = (
                        aiResult?.overall_assessment as {
                            overallScore?: number;
                        }
                    )?.overallScore;
                    if (typeof overallScore === 'number') {
                        totalOverallScore += overallScore;
                        scoredQuestionsCount += 1;
                    }
                } else {
                    // Save error result
                    failedQuestionsCount += 1;
                    await db.collection('toeic_writing_results').updateOne(
                        {
                            _id: attemptObjectId,
                            'parts.questions.questionNumber':
                                question.questionNumber,
                        },
                        {
                            $set: {
                                'parts.$[part].questions.$[question].result': {
                                    provider: 'toeicWritingScoringService',
                                    scoredAt: new Date(),
                                    error:
                                        aiResult?.error ||
                                        'Unknown scoring error',
                                    errorStack: aiResult?.errorStack,
                                },
                            },
                        },
                        {
                            arrayFilters: [
                                {
                                    'part.questions.questionNumber':
                                        question.questionNumber,
                                },
                                {
                                    'question.questionNumber':
                                        question.questionNumber,
                                },
                            ],
                        }
                    );
                }
            } else {
                // Promise rejected
                failedQuestionsCount += 1;
                console.error(
                    `[WritingAttempt] Promise rejected for question:`,
                    result.reason
                );
            }
        }

        // Calculate final total score (0-200)
        // Formula: (totalOverallScore / 28) * 200
        const maxPossibleScore = 28; // 5 câu Part 1 (3 điểm) + 2 câu Part 2 (4 điểm) + 1 câu Part 3 (5 điểm) = 15 + 8 + 5 = 28
        const finalScore =
            scoredQuestionsCount > 0
                ? Math.round((totalOverallScore / maxPossibleScore) * 200)
                : 0;
        const boundedScore = Math.max(0, Math.min(200, finalScore));

        // Determine final status based on scoring results
        let finalStatus: 'scored' | 'partially_scored' | 'scoring_failed';
        if (failedQuestionsCount === 0) {
            finalStatus = 'scored'; // All questions scored successfully
        } else if (scoredQuestionsCount === 0) {
            finalStatus = 'scoring_failed'; // All questions failed
        } else {
            finalStatus = 'partially_scored'; // Some questions scored, some failed
        }

        console.log(
            `[WritingAttempt] Scoring completed: ${scoredQuestionsCount}/${totalQuestionsWithAnswers} questions scored, ${failedQuestionsCount} failed. Total Score: ${totalOverallScore}/${maxPossibleScore} -> ${boundedScore}/200. Status: ${finalStatus}`
        );

        // Update total score and status
        await db.collection('toeic_writing_results').updateOne(
            { _id: attemptObjectId },
            {
                $set: {
                    totalScore: Math.round(boundedScore / 5) * 5,
                    status: finalStatus,
                    updatedAt: new Date(),
                },
            }
        );
    }
}

export const writingAttemptService = new WritingAttemptService();
