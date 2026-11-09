import { HashingEmbeddingProvider } from '~/recsys/embeddings/provider.js';
import {
    cosine,
    decodeVector,
    encodeVector,
} from '~/recsys/embeddings/store.js';
import { contentHash, embeddingText } from '~/recsys/embeddings/indexer.js';
import { generateCandidates } from '~/recsys/engine/candidates.js';
import { recsysConfig } from '~/recsys/config.js';
import { explain } from '~/recsys/engine/explain.js';
import { rankCandidates, VARIANTS } from '~/recsys/engine/ranker.js';
import { ctx, resource } from '../../helpers/recFixtures.js';
import { Types } from 'mongoose';

const SEMANTIC_MIN = recsysConfig.embeddings.semanticMin();

describe('hashing provider', () => {
    const p = new HashingEmbeddingProvider(256);
    it('is deterministic, unit-length and the right size', async () => {
        const [a] = await p.embed(['Business meeting vocabulary']);
        const [b] = await p.embed(['Business meeting vocabulary']);
        expect(a).toEqual(b);
        expect(a).toHaveLength(256);
        expect(Math.sqrt(a.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 5);
    });
    it('places texts with shared vocabulary closer than unrelated ones', async () => {
        const [x, y, z] = await p.embed([
            'office meeting agenda and business email vocabulary',
            'business email vocabulary for the office meeting',
            'cooking pasta with fresh tomatoes and basil',
        ]);
        expect(cosine(x, y)).toBeGreaterThan(cosine(x, z) + 0.2);
    });
    it('names itself with its dimension so a change invalidates cached vectors', () => {
        expect(new HashingEmbeddingProvider(128).name).not.toBe(p.name);
    });
});

describe('vector codec and cosine', () => {
    it('round-trips Float32 through a Buffer', () => {
        const v = [0.25, -0.5, 1, 0];
        expect(Array.from(decodeVector(encodeVector(v)))).toEqual(v);
    });
    it('cosine: identical=1, orthogonal=0, mismatched/empty/zero=0', () => {
        expect(cosine([1, 2], [1, 2])).toBeCloseTo(1);
        expect(cosine([1, 0], [0, 1])).toBe(0);
        expect(cosine([1], [1, 2])).toBe(0);
        expect(cosine([], [])).toBe(0);
        expect(cosine([0, 0], [1, 1])).toBe(0);
    });
});

describe('content hashing', () => {
    it('changes with text and with provider', () => {
        expect(contentHash('a', 'p1')).not.toBe(contentHash('b', 'p1'));
        expect(contentHash('a', 'p1')).not.toBe(contentHash('a', 'p2'));
        expect(contentHash('a', 'p1')).toBe(contentHash('a', 'p1'));
    });
    it('builds bounded text from title, summary and labels', () => {
        const t = embeddingText({
            _id: new Types.ObjectId(),
            title: 'T',
            summary: 'S',
            labels: { domain: 'business', cefr: 'B1', topic: ['grammar'] },
        });
        expect(t).toBe('T. S. business. B1. grammar');
        expect(
            embeddingText({
                _id: new Types.ObjectId(),
                title: 'x'.repeat(5000),
            })
        ).toHaveLength(2000);
    });
});

describe('engine integration', () => {
    const res = (id: string) =>
        resource(id, {
            labels: { cefr: 'B1', domain: 'travel', topic: ['holiday'] },
        });
    const base = () =>
        ctx({
            profile: {
                interests: [],
                studyMinutesPerDay: 30,
                level: 'intermediate',
            },
            resources: [res('a'.repeat(24)), res('b'.repeat(24))],
        });

    it('absent semantic context is an exact no-op (null === undefined)', () => {
        const a = generateCandidates({ ...base(), semantic: undefined });
        const b = generateCandidates({ ...base(), semantic: null });
        expect(b).toEqual(a);
        expect(a.every((c) => c.signals.semantic === undefined)).toBe(true);
    });

    it('a highly similar resource qualifies on similarity alone and is explained', () => {
        const c = {
            ...base(),
            semantic: {
                sim: new Map([['a'.repeat(24), SEMANTIC_MIN + 0.1]]),
                seedTitle: 'Airport English',
            },
        };
        const cand = generateCandidates(c).find(
            (x) => x.id === `resource:${'a'.repeat(24)}`
        );
        expect(cand?.signals.semantic).toBeGreaterThan(SEMANTIC_MIN);
        expect(cand?.reason.code).toBe('similar_to_completed');
        const ranked = rankCandidates(
            [cand!],
            VARIANTS.control,
            'personalized',
            { exposure: new Map(), now: new Date() }
        );
        const text = explain(ranked[0]);
        expect(text.text.en).toContain('Airport English');
        expect(text.text.vi).toContain('Airport English');
    });

    it('below the threshold the signal is attached but does not qualify the item by itself', () => {
        const c = {
            ...base(),
            semantic: { sim: new Map([['a'.repeat(24), 0.4]]) },
        };
        expect(
            generateCandidates(c).find(
                (x) => x.id === `resource:${'a'.repeat(24)}`
            )
        ).toBeUndefined();
    });

    it('every shipped variant gives semantic weight 0 (no behaviour change until a model learns it)', () => {
        for (const v of Object.values(VARIANTS))
            expect(v.weights.semantic).toBe(0);
    });
});
