import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
import { QuestionMetadata } from '~/models/questionMetadataModel.js';
import {
    emitTestSubmitted,
    emitFlashcardReviewed,
    emitCreditSpent,
    emitVocabCaptured,
    emitPronunciationScored,
} from '~/recsys/events/emitters.js';

jest.setTimeout(120_000);
const userId = new mongoose.Types.ObjectId().toString();
const testId = new mongoose.Types.ObjectId().toString();
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
    process.env.RECSYS_ENABLED = 'true';
    await startMongo();
    await syncIndexes(LearningEvent);
});
afterAll(stopMongo);
beforeEach(clearDb);

const meta = (
    n: number,
    part: string,
    skillTags: object,
    difficulty = 'intermediate'
) => ({
    questionId: `q${n}`,
    testId,
    part,
    questionNumber: n,
    contentTags: {
        difficulty,
        style: 'formal',
        domain: ['business'],
        genre: ['email'],
        setting: ['office'],
    },
    skillTags: { part, ...skillTags },
});

it('test submission → one skill-tagged question_answered per answer + one test_submitted', async () => {
    await QuestionMetadata.create([
        meta(101, '5', { grammarPoint: 'wordForm' }, 'advanced'),
        meta(102, '5', { grammarPoint: 'preposition' }),
        meta(32, '3', {
            skillCategory: 'INFERENCE',
            skillDetail: 'inferLocation',
        }),
    ]);
    await emitTestSubmitted({
        userId,
        testId,
        totalScore: 640,
        listeningScore: 330,
        readingScore: 310,
        durationSec: 5400,
        answers: [
            { questionNumber: 101, isCorrect: false },
            { questionNumber: 102, isCorrect: true },
            { questionNumber: 32, isCorrect: true },
            { questionNumber: 7, isCorrect: false }, // no metadata → unknown skill
        ],
    });
    const q = await LearningEvent.find({ type: 'question_answered' }).lean<
        Array<{
            props: {
                skillKey: string;
                correct: boolean;
                difficulty?: string;
                part?: number;
            };
        }>
    >();
    expect(q).toHaveLength(4);
    const byKey = Object.fromEntries(q.map((e) => [e.props.skillKey, e.props]));
    expect(byKey['p5.wordform']).toMatchObject({
        correct: false,
        difficulty: 'advanced',
        part: 5,
    });
    expect(byKey['p3.inference']).toMatchObject({ correct: true });
    expect(byKey.unknown.correct).toBe(false);
    const t = await LearningEvent.findOne({ type: 'test_submitted' }).lean<{
        props: Record<string, number>;
    }>();
    expect(t!.props).toMatchObject({
        totalScore: 640,
        correct: 2,
        total: 4,
        durationSec: 5400,
    });
});

it('never throws on bad input (invalid test id, empty answers)', async () => {
    await expect(
        emitTestSubmitted({ userId, testId: 'nope', answers: [] })
    ).resolves.toBeUndefined();
    await expect(
        emitTestSubmitted({
            userId: 'bad',
            testId,
            answers: [{ questionNumber: 1, isCorrect: true }],
        })
    ).resolves.toBeUndefined();
});

it('flashcard, credit, vocab and pronunciation emitters store valid service events', async () => {
    emitFlashcardReviewed({
        userId,
        flashcardId: 'a'.repeat(24),
        remembered: false,
        prevLevel: 3,
        newLevel: 1,
    });
    emitCreditSpent(userId, 'speech_assessment', 2);
    emitCreditSpent(userId, 'free_thing', 0); // zero credits → ignored
    emitVocabCaptured(userId, [
        { source: 'camera-detect' },
        { isAIGenerated: true },
        { isAIGenerated: true },
        {},
    ]);
    emitPronunciationScored(
        userId,
        [{ NBest: [{ PronunciationAssessment: { AccuracyScore: 82 } }] }],
        45
    );
    emitPronunciationScored(userId, []); // no scores → ignored
    await wait();
    const types =
        await LearningEvent.find().lean<
            Array<{ type: string; props: Record<string, unknown> }>
        >();
    const count = (t: string) => types.filter((e) => e.type === t).length;
    expect(count('flashcard_reviewed')).toBe(1);
    expect(count('credit_spent')).toBe(1);
    expect(count('pronunciation_scored')).toBe(1);
    const vocab = types
        .filter((e) => e.type === 'vocab_captured')
        .map((e) => `${e.props.source}:${e.props.termCount}`)
        .sort();
    expect(vocab).toEqual(['ai_generated:2', 'manual:1', 'object_detection:1']);
});

it('is a complete no-op when RECSYS_ENABLED is off', async () => {
    process.env.RECSYS_ENABLED = 'false';
    emitCreditSpent(userId, 'x', 5);
    await emitTestSubmitted({
        userId,
        testId,
        answers: [{ questionNumber: 1, isCorrect: true }],
    });
    await wait(100);
    expect(await LearningEvent.countDocuments()).toBe(0);
    process.env.RECSYS_ENABLED = 'true';
});
