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

// The real source of skill tags: questions EMBEDDED in the test definition, exactly as
// AnalysisEngineService reads them (joined by questionNumber). question_metadata is only a fallback.
const testDefinition = {
    parts: [
        {
            partName: 'Part 5',
            questions: [
                {
                    questionNumber: 101,
                    skillTags: { part: '5', grammarPoint: 'wordForm' },
                    contentTags: { difficulty: 'advanced' },
                },
                {
                    questionNumber: 102,
                    skillTags: { part: '5', grammarPoint: 'preposition' },
                    contentTags: { difficulty: 'intermediate' },
                },
            ],
        },
        {
            partName: 'Part 3',
            questionGroups: [
                {
                    questions: [
                        {
                            questionNumber: 32,
                            skillTags: {
                                part: '3',
                                skillCategory: 'INFERENCE',
                                skillDetail: 'inferLocation',
                            },
                        },
                    ],
                },
            ],
        },
        { partName: 'Part 7', questions: [{ questionNumber: 190 }] }, // untagged, but part is known from the name
    ],
};

it('full test → skill-tagged question_answered from the EMBEDDED definition + test_submitted with scores', async () => {
    await emitTestSubmitted({
        userId,
        testId,
        testDefinition,
        full: true,
        totalScore: 640,
        listeningScore: 330,
        readingScore: 310,
        durationSec: 5400,
        answers: [
            { questionNumber: 101, isCorrect: false },
            { questionNumber: 102, isCorrect: true },
            { questionNumber: 32, isCorrect: true },
            { questionNumber: 190, isCorrect: true },
            { questionNumber: 7, isCorrect: false }, // not in definition, no metadata → unknown
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
    expect(q).toHaveLength(5);
    const byKey = Object.fromEntries(q.map((e) => [e.props.skillKey, e.props]));
    expect(byKey['p5.wordform']).toMatchObject({
        correct: false,
        difficulty: 'advanced',
        part: 5,
    });
    expect(byKey['p5.preposition']).toMatchObject({ correct: true });
    expect(byKey['p3.inference']).toMatchObject({ correct: true, part: 3 });
    expect(byKey['part:7']).toMatchObject({ part: 7 }); // part known from partName, skill not → coarse key
    expect(byKey.unknown.correct).toBe(false);
    const t = await LearningEvent.findOne({ type: 'test_submitted' }).lean<{
        props: Record<string, number | boolean>;
    }>();
    expect(t!.props).toMatchObject({
        full: true,
        totalScore: 640,
        listeningScore: 330,
        readingScore: 310,
        correct: 3,
        total: 5,
        durationSec: 5400,
    });
});

it('PARTIAL test → no score fields at all (a Part-5 drill is not a 150-point TOEIC score)', async () => {
    await emitTestSubmitted({
        userId,
        testId,
        testDefinition,
        full: false,
        totalScore: 150,
        listeningScore: 5,
        readingScore: 145,
        answers: [{ questionNumber: 101, isCorrect: true }],
    });
    const t = await LearningEvent.findOne({ type: 'test_submitted' }).lean<{
        props: Record<string, unknown>;
    }>();
    expect(t!.props.full).toBe(false);
    expect(t!.props.totalScore).toBeUndefined();
    expect(t!.props.listeningScore).toBeUndefined();
    expect(t!.props.readingScore).toBeUndefined();
});

it('falls back to the question_metadata collection when the definition has no tags', async () => {
    await QuestionMetadata.create([meta(190, '7', { passageType: 'single' })]);
    await emitTestSubmitted({
        userId,
        testId,
        full: true,
        testDefinition: {
            parts: [
                { partName: 'Part 7', questions: [{ questionNumber: 190 }] },
            ],
        },
        answers: [{ questionNumber: 190, isCorrect: true }],
    });
    const q = await LearningEvent.findOne({ type: 'question_answered' }).lean<{
        props: { skillKey: string };
    }>();
    expect(q!.props.skillKey).toBe('p7.single');
});

it('never throws on bad input (invalid test id, empty answers)', async () => {
    await expect(
        emitTestSubmitted({ full: true, userId, testId: 'nope', answers: [] })
    ).resolves.toBeUndefined();
    await expect(
        emitTestSubmitted({
            full: true,
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
        full: true,
        userId,
        testId,
        answers: [{ questionNumber: 1, isCorrect: true }],
    });
    await wait(100);
    expect(await LearningEvent.countDocuments()).toBe(0);
    process.env.RECSYS_ENABLED = 'true';
});
