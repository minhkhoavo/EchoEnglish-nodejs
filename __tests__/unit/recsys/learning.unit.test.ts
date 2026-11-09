import { auc, trainLogReg } from '~/recsys/learning/logreg.js';
import {
    SIGNAL_KEYS,
    positionFeature,
    toWeightSet,
    weightsFor,
    segmentFromQuestions,
} from '~/recsys/learning/model.js';
import {
    TrainingRow,
    Thresholds,
    isHoldout,
    trainRanker,
} from '~/recsys/learning/train.js';
import { rng } from '~/recsys/eval/simulator.js';

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const TH: Thresholds = {
    minRows: 2000,
    minPositives: 100,
    minAucLift: 0.01,
    minSegmentPositives: 150,
};

/** click ~ Bernoulli(sigmoid(f(signals, position))) with a seeded generator. */
function makeRows(
    n: number,
    p: (s: Record<string, number>, pos: number) => number,
    over: Partial<{ seed: number; popByPos: boolean }> = {}
): TrainingRow[] {
    const r = rng(over.seed ?? 11);
    return Array.from({ length: n }, (_, i) => {
        const position = Math.floor(r() * 5);
        const s: Record<string, number> = {
            need: r(),
            srs: r(),
            interest: r(),
            levelFit: r(),
            habit: r(),
            explore: r(),
            popularity: over.popByPos
                ? Math.min(1, Math.max(0, 1 - position / 5 + (r() - 0.5) * 0.2))
                : r(),
        };
        return {
            userId: `u${i % 400}`,
            recId: `r${i}`,
            signals: s,
            position,
            segment: i % 2 ? 'new' : 'established',
            clicked: r() < p(s, position),
        };
    });
}

describe('logistic regression', () => {
    it('recovers the direction and relative size of true coefficients', async () => {
        const r = rng(3);
        const rows = Array.from({ length: 4000 }, () => {
            const x = [r(), r(), r()];
            return {
                x,
                y: (r() < sigmoid(-1 + 3 * x[0] + 0.0 * x[1] - 2 * x[2])
                    ? 1
                    : 0) as 0 | 1,
            };
        });
        const m = await trainLogReg(rows);
        expect(m.w[0]).toBeGreaterThan(1);
        expect(Math.abs(m.w[1])).toBeLessThan(0.5);
        expect(m.w[2]).toBeLessThan(-0.5);
    });
    it('is deterministic', async () => {
        const rows = [
            { x: [0.1, 0.9], y: 1 as const },
            { x: [0.8, 0.2], y: 0 as const },
            { x: [0.4, 0.6], y: 1 as const },
        ];
        expect(await trainLogReg(rows)).toEqual(await trainLogReg(rows));
    });
    it('rejects on empty input', async () => {
        await expect(trainLogReg([])).rejects.toThrow();
    });
});

describe('training does not block the event loop (it runs inside the API process)', () => {
    it('lets timers fire while fitting 12k rows', async () => {
        const r = rng(21);
        const rows = Array.from({ length: 12_000 }, () => {
            const x = [r(), r(), r(), r(), r(), r(), r(), r(), r()];
            return {
                x,
                y: (r() < sigmoid(-1 + 2 * x[0] - x[1]) ? 1 : 0) as 0 | 1,
            };
        });
        let ticks = 0;
        const timer = setInterval(() => ticks++, 1);
        const t0 = Date.now();
        await trainLogReg(rows);
        clearInterval(timer);
        const elapsed = Date.now() - t0;
        // A fully blocked loop would let at most one tick through; require steady progress.
        expect(ticks).toBeGreaterThan(Math.min(20, elapsed / 50));
    }, 60_000);
});

describe('auc', () => {
    it('is 1 for a perfect, 0 for an inverted and 0.5 for tied scores; null for one class', () => {
        expect(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1);
        expect(auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1])).toBe(0);
        expect(auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1])).toBe(0.5);
        expect(auc([1, 2], [1, 1])).toBeNull();
    });
});

describe('weights conversion', () => {
    it('keeps only positive evidence, normalises to 1 and maps onto the engine signals', () => {
        const coef = SIGNAL_KEYS.map((_, i) =>
            i === 0 ? 2 : i === 1 ? 1 : -3
        );
        const w = toWeightSet(coef)!;
        expect(Object.keys(w)).toEqual([...SIGNAL_KEYS]);
        expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
        expect(w[SIGNAL_KEYS[0]]).toBeCloseTo(0.6667, 3);
        expect(w[SIGNAL_KEYS[2]]).toBe(0);
    });
    it('returns null when nothing positive was learned', () => {
        expect(toWeightSet(SIGNAL_KEYS.map(() => -1))).toBeNull();
        expect(toWeightSet(SIGNAL_KEYS.map(() => 0))).toBeNull();
    });
    it('tolerates a payload whose empty `segments` was dropped by a Mongo round trip', () => {
        const g = toWeightSet(SIGNAL_KEYS.map(() => 1))!;
        expect(
            weightsFor({ algo: 'logreg-v1', global: g } as never, 'established')
        ).toBe(g);
    });
    it('falls back to the global weights for a missing segment', () => {
        const g = toWeightSet(SIGNAL_KEYS.map(() => 1))!;
        expect(
            weightsFor({ algo: 'logreg-v1', global: g, segments: {} }, 'new')
        ).toBe(g);
    });
    it('segments learners by recent volume', () => {
        expect(segmentFromQuestions(5)).toBe('new');
        expect(segmentFromQuestions(null)).toBe('new');
        expect(segmentFromQuestions(20)).toBe('established');
    });
});

describe('trainRanker', () => {
    // truth is very different from control: only `explore` and `habit` matter
    const truth = (s: Record<string, number>) =>
        sigmoid(-2.2 + 4 * s.explore + 2.5 * s.habit);

    it('refuses to train on too little data (data gate runs before any fitting)', async () => {
        const rep = await trainRanker(makeRows(300, truth), TH);
        expect(rep.gatePassed).toBe(false);
        expect(rep.payload).toBeNull();
        expect(rep.reasons.join()).toMatch(/impressions/);
    });

    it('learns weights that beat control on held-out USERS and passes the gate', async () => {
        const rep = await trainRanker(
            makeRows(12000, (s) => truth(s)),
            TH
        );
        expect(rep.reasons).toEqual([]);
        expect(rep.gatePassed).toBe(true);
        expect(rep.metrics.lift!).toBeGreaterThan(0.05);
        const g = rep.payload!.global;
        expect(g.explore + g.habit).toBeGreaterThan(0.8);
        expect(g.need).toBeLessThan(0.1);
    });

    it('rejects a model that does not beat control (truth == control-like signals)', async () => {
        // clicks depend on `need`+`srs`, which control already weights heavily → lift below threshold
        const rep = await trainRanker(
            makeRows(12000, (s) => sigmoid(-2 + 3 * s.need + 2.2 * s.srs)),
            { ...TH, minAucLift: 0.05 }
        );
        expect(rep.gatePassed).toBe(false);
        expect(rep.reasons.join()).toMatch(/AUC lift/);
    });

    it('does not credit a signal that merely correlates with position (position bias)', async () => {
        // clicks depend on srs and (strongly) on position; popularity is high exactly where position is low
        const rows = makeRows(
            15000,
            (s, pos) => sigmoid(-0.5 + 3 * s.srs - 2.5 * positionFeature(pos)),
            { popByPos: true }
        );
        const g = (await trainRanker(rows, TH)).payload!.global;
        expect(g.srs).toBeGreaterThan(0.7);
        expect(g.popularity).toBeLessThan(0.12);
    });

    it('splits by user: nobody is in both train and holdout, and the split is stable', () => {
        for (let i = 0; i < 200; i++)
            expect(isHoldout(`u${i}`)).toBe(isHoldout(`u${i}`));
        const share =
            Array.from({ length: 5000 }, (_, i) =>
                isHoldout(`user-${i}`)
            ).filter(Boolean).length / 5000;
        expect(share).toBeGreaterThan(0.17);
        expect(share).toBeLessThan(0.23);
    });
});
