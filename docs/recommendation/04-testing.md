# 04 · Testing

## 1. Strategy
Test pyramid, weighted toward **real-database integration tests** wherever Mongo semantics matter (unique indexes, upserts, TTL-independent behaviour, erasure). Pure logic (ranking, mastery, KPIs, DQ rules) is unit-tested exhaustively because it is deterministic. Integration tests use `mongodb-memory-server` (real `mongod` 7.0), so idempotency and index behaviour are tested against the real engine, not mocks.

| Layer | Files (`__tests__/…`) | Cases | What it proves |
| --- | --- | --- | --- |
| Unit – contract | `unit/recsys/eventTypes` | 8 | schema strictness, client allow-list, variant required on feedback events |
| Unit – ETL | `unit/recsys/etl` | 12 | local-day boundary (UTC+7), clamping, no double-counted study time, determinism, DQ rules |
| Unit – features | `unit/recsys/features` | 16 | mastery convergence/bounds/decay, `R(S,S)=0.9`, streak, trend, empty learner |
| Unit – engine | `unit/recsys/engine` | 33 | candidates, cold start, ranker, every guardrail, explanations (EN+VI, no `undefined`), hash-bucket split, end-to-end properties |
| Unit – eval | `unit/recsys/eval` | 10 | metrics on known lists, replay join, seeded simulation criteria |
| Unit – KPI | `unit/recsys/kpi` | 17 | activation/retention maturity, k-anonymity, score gain, unit economics, z-test |
| Unit – AI usage | `unit/recsys/aiUsage` | 10 | token extraction, rate config, attribution, never-throws |
| Integration – ingest | `integration/recsys/eventIngest` | 7 | idempotency on real unique index, consent gate, stale/future, mixed batches, emit never throws |
| Integration – pipeline | `integration/recsys/pipeline` | 6 | bronze→silver→gold, replay idempotency, late events, rejects, lease contention |
| Integration – features | `integration/recsys/features` | 3 | cursor-based mastery updates, persisted feature set with real flashcards |
| Integration – HTTP | `integration/recsys/http` | 14 | consent API, auth/validation, spoofed `userId`, **closed loop** events→recs→impressions, anti-repetition, export+erase, admin RBAC |
| Integration – emitters | `integration/recsys/emitters` | 6 | skill tags from the embedded test definition (+ metadata fallback), full vs partial test scores, no-op when disabled |
| Integration – health | `integration/recsys/health` | 5 | ok/degraded/down logic |
| Performance | `integration/recsys/performance` | 2 | latency and throughput budgets (§3) |
| **Total new** | | **149** | (+4 emission-contract tests added to the existing `testResultService` suite) |

**Latest run:** platform suites + every existing suite for files I touched (`flashcardService`, `testResultService`, `payment/*`, `authMiddleware`, `googleGenAIClient`, `recommendation/*`) = **35 suites, 647 tests, all passing**.

## 2. Data-quality tests
* Run-time DQ (`etl/dataQuality.ts`) — unit-tested thresholds and an integration test where a contract-violating raw row yields `rejected` + `degraded` while good rows still flow.
* Data contracts: strict zod envelope; props validated at ingest **and** re-validated at ETL (contract may evolve).
* Reconciliation: replay test asserts `learner_daily_facts` equals recompute from silver and that raw→silver counts match (`cleaned + alreadyClean + rejected = read`).

## 3. Performance & load — criteria and measurements

| ID | Criterion (pass/fail) | Measured (dev VM, 2 vCPU class, in-memory Mongo) |
| --- | --- | --- |
| P1 | Recommender compute p95 ≤ 25 ms (300 resource candidates, 200 learners, warm, best of 3 rounds) | p50 12–14 ms / p95 16–20 ms under Jest instrumentation; ≈ 6 ms mean in plain Node |
| P2 | Ingest 5,000 events (batches of 100) ≤ 20 s | ≈ 7.2 s (≈ 700 events/s) |
| P3 | ETL 5,000 events ≤ 20 s | ≈ 7.6 s |
| P4 | Feature build, 50 touched users ≤ 30 s | ≈ 2.9 s |
| L1 | k6: `/recommendations` p95 < 300 ms, p99 < 800 ms; `/events/batch` p95 < 200 ms; error rate < 1% at 20 rps recs + 3 batches/s | **not executed** — `loadtest/recsys.k6.js` is ready; run on staging (T1.24) |

Honest caveat: P2–P4 use an in-memory MongoDB on a shared VM; they validate algorithmic behaviour and catch regressions (a first run caught an O(R·W·K·T) hot loop that was then fixed), not production capacity. Capacity must be re-measured on staging with the real Atlas tier.

## 4. Offline recommendation evaluation (pass/fail in CI)
`eval.unit` simulation (300 learners, seed 42) must satisfy: control NDCG@5 ≥ random + 0.08; P@3 ≥ 0.85; list diversity ≥ 0.6; coverage ≤ 1; `srs_heavy` within 10% of control. Current: NDCG@5 0.588 vs 0.458 (random), P@3 0.925. `npm run recsys:eval` is also run in CI as a regression guard. **Synthetic ground truth — see 03 §7.9.**

## 5. Privacy tests
Default-off consent; ledger entry per change; behavioural events dropped without consent; spoofed `userId` rejected; export contains all derived collections; erase removes events/clean/facts/mastery/features, withdraws consent, retains ledger, and **does not touch other users**.

## 6. Known gaps (be explicit)
* **Not executed here:** k6 load test; CI workflows on GitHub; deploy/rollback scripts against a real VPS (written, shell-reviewed only).
* No real-user validation of reason copy, consent wording, or recommendation usefulness (README §4/§6).
* Real-data replay evaluation requires production logs.
* Full existing suite status: **not completed.** The first attempt had a jest worker SIGKILLed by the OS and the second run was stopped by the harness for low memory (2.9 GB VM). Only the suites for files I touched were run (all green, 647 tests); `DailySessionService` passed (28/28) when re-run in isolation. Run the full suite on CI (`ci.yml / full-suite`) or a larger machine before making CI a required check.
* Repo-wide `tsc` has 53 pre-existing errors (controllers); new code adds none (`scripts/ci/typecheck-recsys.sh`).

## 7. How to run
```bash
npx jest __tests__/unit/recsys                    # fast, pure
npx jest __tests__/integration                    # real MongoDB (first run downloads mongod ~80 MB)
npm run recsys:eval                               # offline evaluation table
bash scripts/ci/typecheck-recsys.sh               # typecheck guard
k6 run -e BASE_URL=... -e TOKENS_FILE=tokens.json loadtest/recsys.k6.js
```
Tip: on machines with ≤ 3 GB RAM use `--maxWorkers=2` and don't run other heavy jobs concurrently (workers get OOM-killed).
