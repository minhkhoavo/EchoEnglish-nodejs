import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { LearningEvent } from '~/recsys/events/eventModel.js';
import {
    CleanEvent,
    DailyFacts,
    PipelineRun,
    PipelineLock,
} from '~/recsys/etl/models.js';
import {
    SkillMastery,
    LearnerFeatures,
} from '~/recsys/features/featureModels.js';
import { featureBuilder } from '~/recsys/features/featureBuilder.js';
import { pipelineService } from '~/recsys/etl/pipeline.js';
import { eventService } from '~/recsys/events/eventService.js';
import { Flashcard } from '~/models/flashcardModel.js';

jest.setTimeout(120_000);
const uid = new mongoose.Types.ObjectId().toString();
const answer = (skillKey: string, correct: boolean) => ({
    type: 'question_answered' as const,
    props: { skillKey, correct, origin: 'drill', timeMs: 8000 },
});

beforeAll(async () => {
    process.env.RECSYS_ENABLED = 'true';
    await startMongo();
    await syncIndexes(
        LearningEvent,
        CleanEvent,
        DailyFacts,
        PipelineRun,
        PipelineLock,
        SkillMastery,
        LearnerFeatures
    );
});
afterAll(stopMongo);
beforeEach(clearDb);

it('updates mastery incrementally and never double-applies events (cursor)', async () => {
    await eventService.emitManyAsync(uid, [
        ...Array.from({ length: 6 }, () => answer('p5.wordform', false)),
        ...Array.from({ length: 6 }, () => answer('p3.inference', true)),
    ]);
    await pipelineService.runOnce();

    expect(await featureBuilder.updateMastery(uid)).toBe(12);
    const weak = await SkillMastery.findOne({
        userId: uid,
        skillKey: 'p5.wordform',
    }).lean<{ theta: number; n: number }>();
    const strong = await SkillMastery.findOne({
        userId: uid,
        skillKey: 'p3.inference',
    }).lean<{ theta: number }>();
    expect(weak!.n).toBe(6);
    expect(weak!.theta).toBeLessThan(0);
    expect(strong!.theta).toBeGreaterThan(0);

    // second call: nothing new → no change
    expect(await featureBuilder.updateMastery(uid)).toBe(0);
    const again = await SkillMastery.findOne({
        userId: uid,
        skillKey: 'p5.wordform',
    }).lean<{ n: number }>();
    expect(again!.n).toBe(6);

    // new event afterwards is applied once
    await eventService.emitManyAsync(uid, [answer('p5.wordform', true)]);
    await pipelineService.runOnce();
    expect(await featureBuilder.updateMastery(uid)).toBe(1);
});

it('build() persists a full feature set including SRS stats from flashcards', async () => {
    await eventService.emitManyAsync(uid, [
        answer('p5.wordform', true),
        answer('p5.wordform', false),
    ]);
    await pipelineService.runOnce({
        afterFacts: (ids) => featureBuilder.buildMany(ids),
    });

    const category = new mongoose.Types.ObjectId();
    await Flashcard.create([
        {
            front: 'a',
            back: 'b',
            category,
            difficulty: 'Easy',
            createBy: uid,
            level_memory: 0,
        },
        {
            front: 'c',
            back: 'd',
            category,
            difficulty: 'Easy',
            createBy: uid,
            level_memory: 2,
            lastReviewDate: new Date(Date.now() - 5 * 86_400_000),
            nextReviewDate: new Date(Date.now() - 2 * 86_400_000),
        },
    ]);
    const f = await featureBuilder.build(uid);
    expect(f.srs).toMatchObject({ total: 2, newCards: 1, due: 2 });
    expect(f.performance.questions30).toBe(2);
    const stored = await LearnerFeatures.findOne({ userId: uid }).lean<{
        pipelineVersion: string;
        skills: unknown[];
    }>();
    expect(stored!.pipelineVersion).toBeDefined();
    expect(stored!.skills).toHaveLength(1);
});
