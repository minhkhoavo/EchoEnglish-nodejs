/**
 * Calibrates RECSYS_SEMANTIC_MIN for the configured embedding provider with a small hand-labelled
 * set (8 topics x 3 resources, written in the style of the catalogue's title/summary/labels).
 * It calls the REAL provider (about 24 short texts, one batch) and touches no database.
 *   GENAI_API_KEY=... npx tsx scripts/ops/recsys-embed-calibrate.ts
 *   RECSYS_EMBEDDINGS_PROVIDER=hash npx tsx scripts/ops/recsys-embed-calibrate.ts   # offline baseline
 * "Related" here means the same topic cluster: a proxy for relevance, NOT learner behaviour.
 * Re-run on a sample of the real catalogue before turning the `semantic` signal on.
 */
import { embeddingText } from '../../src/recsys/embeddings/indexer.js';
import { providerFromEnv } from '../../src/recsys/embeddings/provider.js';
import { cosine } from '../../src/recsys/embeddings/store.js';

type Item = { cluster: string; title: string; summary: string; domain: string };
const D = (cluster: string, domain: string, rows: Array<[string, string]>) =>
    rows.map(([title, summary]) => ({ cluster, domain, title, summary }));

const ITEMS: Item[] = [
    ...D('airport', 'travel', [
        [
            'Checking in at the airport',
            'Phrases for check-in desks, boarding passes and baggage limits.',
        ],
        [
            'Flight delays and gate changes',
            'Understanding departure announcements, delays and rebooking.',
        ],
        [
            'Going through customs',
            'Questions at passport control and what to declare on arrival.',
        ],
    ]),
    ...D('job_interview', 'human_resources', [
        [
            'Answering common interview questions',
            'Describe your strengths, experience and why you want the job.',
        ],
        [
            'Writing a resume and cover letter',
            'How to present work history and skills when applying for a position.',
        ],
        [
            'Negotiating salary and benefits',
            'Discussing compensation, contract terms and a job offer.',
        ],
    ]),
    ...D('finance', 'finance', [
        [
            'Reading a quarterly earnings report',
            'Revenue, profit margins and year-on-year growth explained.',
        ],
        [
            'Opening a business bank account',
            'Deposits, interest rates, loans and account fees.',
        ],
        [
            'Budget planning for the new fiscal year',
            'Forecasting expenses, investments and cash flow.',
        ],
    ]),
    ...D('health', 'healthcare', [
        [
            'Making a doctor appointment',
            'Describing symptoms, booking a visit and understanding prescriptions.',
        ],
        [
            'At the pharmacy',
            'Medicine instructions, dosage and side effects in plain English.',
        ],
        [
            'Hospital visit vocabulary',
            'Nurses, wards, test results and insurance paperwork.',
        ],
    ]),
    ...D('technology', 'technology', [
        [
            'Reporting a software bug',
            'Describing errors, steps to reproduce and release notes.',
        ],
        [
            'Cloud computing for beginners',
            'Servers, storage, uptime and cybersecurity basics.',
        ],
        [
            'Launching a mobile app',
            'Product roadmap, user feedback and app store updates.',
        ],
    ]),
    ...D('restaurant', 'hospitality', [
        [
            'Ordering food at a restaurant',
            'Menus, reservations, allergies and paying the bill.',
        ],
        [
            'Hotel booking and room service',
            'Reserving a room, check-out times and complaints.',
        ],
        [
            'Catering a company event',
            'Menus, dietary needs and serving schedules for banquets.',
        ],
    ]),
    ...D('office', 'office', [
        [
            'Scheduling a team meeting',
            'Agendas, rescheduling, minutes and follow-up emails.',
        ],
        [
            'Office supplies and equipment orders',
            'Requesting printers, stationery and maintenance.',
        ],
        [
            'Writing a professional email',
            'Polite requests, attachments and replying to colleagues.',
        ],
    ]),
    ...D('logistics', 'logistics', [
        [
            'Tracking a shipment',
            'Delivery dates, customs clearance and freight forwarding.',
        ],
        [
            'Warehouse inventory management',
            'Stock levels, packing lists and order fulfilment.',
        ],
        [
            'Handling a damaged delivery',
            'Reporting broken goods, refunds and replacement orders.',
        ],
    ]),
];

const provider = await providerFromEnv();
const texts = ITEMS.map((i) =>
    embeddingText({
        _id: undefined as never,
        title: i.title,
        summary: i.summary,
        labels: { domain: i.domain, cefr: 'B1', topic: [i.cluster] },
    })
);
const t0 = Date.now();
const vecs = await provider.embed(texts);
const ms = Date.now() - t0;

const related: number[] = [];
const unrelated: number[] = [];
for (let i = 0; i < ITEMS.length; i++)
    for (let j = i + 1; j < ITEMS.length; j++)
        (ITEMS[i].cluster === ITEMS[j].cluster ? related : unrelated).push(
            cosine(vecs[i], vecs[j])
        );

const q = (a: number[], p: number) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const r3 = (n: number) => Number(n.toFixed(3));
const summary = (a: number[]) => ({
    n: a.length,
    min: r3(q(a, 0)),
    p05: r3(q(a, 0.05)),
    p50: r3(q(a, 0.5)),
    p95: r3(q(a, 0.95)),
    max: r3(q(a, 1)),
});

// threshold with the best F1 for "related", scanned over observed values
let best = { t: 0, f1: -1, precision: 0, recall: 0 };
for (const t of [...related, ...unrelated].sort((a, b) => a - b)) {
    const tp = related.filter((x) => x >= t).length;
    const fp = unrelated.filter((x) => x >= t).length;
    const fn = related.length - tp;
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp / (tp + fn);
    const f1 =
        precision + recall
            ? (2 * precision * recall) / (precision + recall)
            : 0;
    if (f1 > best.f1) best = { t, f1, precision, recall };
}
const separable = q(related, 0.05) > q(unrelated, 0.95);

console.log(
    JSON.stringify(
        {
            provider: provider.name,
            dims: vecs[0].length,
            texts: texts.length,
            embedMs: ms,
            related: summary(related),
            unrelated: summary(unrelated),
            bestF1Threshold: {
                threshold: r3(best.t),
                f1: r3(best.f1),
                precision: r3(best.precision),
                recall: r3(best.recall),
            },
            currentDefault: 0.75,
            cleanlySeparated: separable,
        },
        null,
        2
    )
);
