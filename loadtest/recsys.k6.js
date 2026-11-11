// k6 load test for the recommendation platform.
//   k6 run -e BASE_URL=https://staging.example.com -e TOKENS_FILE=tokens.json loadtest/recsys.k6.js
// tokens.json: ["<jwt-user-1>", "<jwt-user-2>", ...]  (pre-minted test users with analytics+personalization consent)
//
// NOT executed in the authoring environment (k6 is not installed there) – run it against staging
// before enabling RECSYS_ENABLED in production. Pass/fail criteria are the `thresholds` below.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const tokens = new SharedArray('tokens', () => JSON.parse(open(__ENV.TOKENS_FILE || './tokens.json')));
const BASE = __ENV.BASE_URL || 'http://localhost:4000';

export const options = {
    scenarios: {
        // Client behavioural events: ~50 events/s sustained (≈ 10k MAU peak hour) in batches of 20.
        ingest: {
            executor: 'constant-arrival-rate',
            rate: 3, timeUnit: '1s', duration: '5m', preAllocatedVUs: 20, maxVUs: 60,
            exec: 'ingest',
        },
        // Home-screen recommendation fetches.
        recommend: {
            executor: 'ramping-arrival-rate',
            startRate: 2, timeUnit: '1s', preAllocatedVUs: 20, maxVUs: 80,
            stages: [
                { target: 20, duration: '2m' },
                { target: 20, duration: '3m' },
                { target: 0, duration: '30s' },
            ],
            exec: 'recommend',
        },
    },
    thresholds: {
        'http_req_failed': ['rate<0.01'],
        'http_req_duration{scenario:recommend}': ['p(95)<300', 'p(99)<800'],
        'http_req_duration{scenario:ingest}': ['p(95)<200'],
        'checks': ['rate>0.99'],
    },
};

const headers = (t) => ({ headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
const pick = () => tokens[Math.floor(Math.random() * tokens.length)];

export function ingest() {
    const events = Array.from({ length: 20 }, () => ({
        eventId: uuidv4(), schemaVersion: 1, type: 'resource_viewed', occurredAt: new Date().toISOString(),
        props: { resourceId: 'a'.repeat(24), dwellSec: Math.floor(Math.random() * 300), completed: Math.random() > 0.6 },
    }));
    const res = http.post(`${BASE}/events/batch`, JSON.stringify({ events }), headers(pick()));
    check(res, { 'ingest 200': (r) => r.status === 200, 'no rejects': (r) => r.json('data.rejected.length') === 0 });
}

export function recommend() {
    const t = pick();
    const res = http.get(`${BASE}/recommendations?limit=5`, headers(t));
    const ok = check(res, {
        'recs 200': (r) => r.status === 200,
        'has items': (r) => (r.json('data.items') || []).length > 0,
    });
    if (ok && Math.random() < 0.3) {
        const d = res.json('data');
        http.post(`${BASE}/events/batch`, JSON.stringify({
            events: [{
                eventId: uuidv4(), schemaVersion: 1, type: 'rec_click', occurredAt: new Date().toISOString(),
                props: { recId: d.recId, itemType: d.items[0].type, itemRef: d.items[0].ref, variant: d.variant },
            }],
        }), headers(t));
    }
    sleep(1);
}
