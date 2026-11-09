/* Offline evaluation report. Usage: npm run recsys:eval [-- --learners 500 --seed 42] */
import {
    evaluateRanker,
    makeLearners,
    randomRanker,
    rankerFromVariant,
} from './simulator.js';

const arg = (name: string, d: number) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? Number(process.argv[i + 1]) : d;
};

const learners = makeLearners(arg('learners', 500), arg('seed', 42));
const rows = [
    evaluateRanker('random', randomRanker(), learners),
    evaluateRanker(
        'popularity_only',
        rankerFromVariant('popularity_only'),
        learners
    ),
    evaluateRanker('control', rankerFromVariant('control'), learners),
    evaluateRanker('srs_heavy', rankerFromVariant('srs_heavy'), learners),
];
console.table(
    rows.map((r) => ({
        ranker: r.ranker,
        'NDCG@5': r.ndcgAt5.toFixed(3),
        'P@3': r.precisionAt3.toFixed(3),
        diversity: r.diversity.toFixed(2),
        coverage: r.coverage.toFixed(2),
    }))
);
console.log(
    `(synthetic learners=${learners.length}; ground truth is simulated — validate with real replay)`
);
