import mongoose from 'mongoose';
import {
    startMongo,
    stopMongo,
    clearDb,
    syncIndexes,
} from '../../helpers/mongo.js';
import { Resource } from '~/models/resource.js';
import { ContentEmbedding, loadEmbeddings } from '~/recsys/embeddings/store.js';
import {
    HashingEmbeddingProvider,
    EmbeddingProvider,
} from '~/recsys/embeddings/provider.js';
import { indexResources } from '~/recsys/embeddings/indexer.js';
import { buildSemanticContext } from '~/recsys/embeddings/semantic.js';
import { RecDeps, RecommenderService } from '~/recsys/engine/recommender.js';
import { features } from '../../helpers/recFixtures.js';

jest.setTimeout(180_000);
const P = new HashingEmbeddingProvider(256);
const oid = () => new mongoose.Types.ObjectId();

async function addResource(
    title: string,
    summary: string,
    topic: string[] = []
) {
    const _id = oid();
    await Resource.collection.insertOne({
        _id,
        title,
        summary,
        suitableForLearners: true,
        publishedAt: new Date(),
        labels: { cefr: 'B1', domain: 'travel', topic },
    });
    return _id.toString();
}

beforeAll(async () => {
    await startMongo();
    await syncIndexes(ContentEmbedding);
});
afterAll(stopMongo);
beforeEach(async () => {
    await clearDb();
    delete process.env.RECSYS_EMBEDDINGS_ENABLED;
});

describe('indexer', () => {
    it('embeds new resources, stores Float32 vectors that survive the Mongo round trip, and skips fresh ones', async () => {
        const a = await addResource(
            'Airport check-in dialogue',
            'Phrases for airline counters'
        );
        await addResource(
            'Hotel booking email',
            'Writing a polite reservation email'
        );
        const r1 = await indexResources(P);
        expect(r1).toMatchObject({
            scanned: 2,
            embedded: 2,
            skippedFresh: 0,
            failedBatches: 0,
        });
        expect(r1.estTokens).toBeGreaterThan(0);
        const vecs = await loadEmbeddings([a], P.name);
        expect(vecs.get(a)).toHaveLength(256);
        const [expected] = await P.embed([
            'Airport check-in dialogue. Phrases for airline counters. travel. B1',
        ]);
        expect(Array.from(vecs.get(a)!).slice(0, 8)).toEqual(
            Array.from(new Float32Array(expected)).slice(0, 8)
        );

        const r2 = await indexResources(P);
        expect(r2).toMatchObject({ embedded: 0, skippedFresh: 2 }); // cost is proportional to change
    });

    it('re-embeds only what changed, and everything when the provider changes', async () => {
        const a = await addResource('One', 'first');
        await addResource('Two', 'second');
        await indexResources(P);
        await Resource.collection.updateOne(
            { _id: new mongoose.Types.ObjectId(a) },
            { $set: { summary: 'changed text' } }
        );
        expect((await indexResources(P)).embedded).toBe(1);
        const other = new HashingEmbeddingProvider(128);
        expect((await indexResources(other)).embedded).toBe(2);
        // vectors are addressed by provider name: the old provider's vectors are not mixed in
        expect((await loadEmbeddings([a], P.name)).size).toBe(0);
        expect((await loadEmbeddings([a], other.name)).get(a)).toHaveLength(
            128
        );
    });

    it('respects the per-run cap and counts a failing batch without throwing', async () => {
        for (let i = 0; i < 5; i++) await addResource(`R${i}`, `s${i}`);
        expect((await indexResources(P, { maxPerRun: 3 })).embedded).toBe(3);
        const failing: EmbeddingProvider = {
            name: 'fail',
            embed: async () => {
                throw new Error('quota');
            },
        };
        const err = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const r = await indexResources(failing);
        err.mockRestore();
        expect(r).toMatchObject({ embedded: 0, failedBatches: 1 });
    });
});

describe('semantic context', () => {
    it('is the similarity to what the learner finished, excluding the seeds themselves', async () => {
        const seed = await addResource(
            'Airport check-in dialogue',
            'airline counter check-in baggage boarding pass',
            ['travel']
        );
        const near = await addResource(
            'Boarding pass and baggage vocabulary',
            'airline check-in counter baggage boarding',
            ['travel']
        );
        const far = await addResource(
            'Cooking pasta',
            'fresh tomatoes basil olive oil kitchen',
            ['food']
        );
        await indexResources(P);
        const docs =
            await Resource.find().lean<
                Array<{ _id: mongoose.Types.ObjectId; title: string }>
            >();
        const exposure = new Map([
            [
                `resource:${seed}`,
                { shown7d: 1, clicked: true, completedAt: new Date() },
            ],
        ]);
        const ctx = await buildSemanticContext(docs as never, exposure, P.name);
        expect(ctx!.sim.has(seed)).toBe(false);
        expect(ctx!.sim.get(near)!).toBeGreaterThan(ctx!.sim.get(far) ?? 0);
        expect(ctx!.seedTitle).toBe('Airport check-in dialogue');
    });
    it('is null without seeds or without indexed vectors (engine then behaves as before)', async () => {
        const a = await addResource('X', 'y');
        const docs = await Resource.find().lean();
        expect(
            await buildSemanticContext(docs as never, new Map(), P.name)
        ).toBeNull();
        const exp = new Map([
            [
                `resource:${a}`,
                { shown7d: 0, clicked: false, completedAt: new Date() },
            ],
        ]);
        expect(
            await buildSemanticContext(docs as never, exp, P.name)
        ).toBeNull(); // nothing indexed
    });
});

describe('recommender end to end', () => {
    const run = async (flag: boolean, deps: Partial<RecDeps> = {}) => {
        if (flag) process.env.RECSYS_EMBEDDINGS_ENABLED = 'true';
        process.env.RECSYS_EMBEDDINGS_PROVIDER = 'hash';
        process.env.RECSYS_SEMANTIC_MIN = '0.5'; // lexical hashing has a lower similarity scale than a real model
        const docs =
            await Resource.find().lean<
                Array<{ _id: mongoose.Types.ObjectId; title: string }>
            >();
        const seedDoc = docs.find((d) => d.title.startsWith('Airport'))!;
        const base: RecDeps = {
            loadFeatures: async () => features(),
            loadProfile: async () => ({
                interests: [],
                studyMinutesPerDay: 60,
                level: 'intermediate',
            }),
            loadResources: async () => docs as never,
            loadExposure: async () =>
                new Map([
                    [
                        `resource:${seedDoc._id}`,
                        { shown7d: 1, clicked: true, completedAt: new Date() },
                    ],
                ]),
            loadPopularity: async () => new Map(),
            hasPersonalizationConsent: async () => true,
            ...deps,
        };
        const { mongoDeps } = await import('~/recsys/engine/recommender.js');
        const svc = new RecommenderService({
            ...base,
            loadSemantic: deps.loadSemantic ?? mongoDeps.loadSemantic,
        });
        svc.clearCache();
        return svc.recommend(new mongoose.Types.ObjectId().toString(), {
            limit: 10,
            refresh: true,
            logImpressions: false,
        });
    };
    beforeEach(async () => {
        await addResource(
            'Airport check-in dialogue',
            'airline counter check-in baggage boarding pass',
            ['travel']
        );
        await addResource(
            'Boarding pass and baggage vocabulary',
            'airline check-in counter baggage boarding pass',
            ['travel']
        );
        await indexResources(P);
    });
    afterEach(() => {
        delete process.env.RECSYS_EMBEDDINGS_PROVIDER;
        delete process.env.RECSYS_SEMANTIC_MIN;
    });

    it('flag off: no semantic recommendations at all', async () => {
        const r = await run(false);
        expect(
            r.items.some((i) => i.reason.code === 'similar_to_completed')
        ).toBe(false);
    });
    it('flag on: a similar unseen resource is recommended with an explanation', async () => {
        const r = await run(true);
        const item = r.items.find(
            (i) => i.reason.code === 'similar_to_completed'
        );
        expect(item?.title).toMatch(/Boarding pass/);
        expect(item?.reason.text.en).toContain('Airport check-in dialogue');
    });
    it('an embedding failure never fails the request', async () => {
        const err = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const r = await run(true, {
            loadSemantic: async () => {
                throw new Error('boom');
            },
        });
        err.mockRestore();
        expect(r.items.length).toBeGreaterThan(0);
    });
});
