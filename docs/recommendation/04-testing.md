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
* Repo-wide `tsc` has 53 pre-existing errors (controllers); new code adds none (`scripts/ci/typecheck-recsys.sh`, which now type-checks src, the test tree and ops scripts in three passes — earlier it silently skipped tests and scripts).

## 6b. Phase 3 tests
| Layer | What it proves | Where |
| --- | --- | --- |
| Default suite (CI) | exporter cursor/lease/at-least-once, consent + tombstone gating, pseudonym guard, loader (invalid / foreign-region / erased), erase propagation + retry, feature-store point-in-time join (no future leakage), trainer (gates, position bias, user-level split), registry rules (caps, synthetic never servable, one DB read per TTL), serving (flag off ⇒ untouched, no reshuffling of control/srs_heavy, kill switch, registry failure degrades), harm guard, embeddings indexer/semantic/engine wiring, residency routing, KPI backend fallback, Kafka config | `__tests__/unit/recsys`, `__tests__/integration/recsys` — **238 tests in 23 suites** pass (final run; 234/22 passed in 3 consecutive 2-worker runs before the Kafka-config tests were added) |
| Performance (CI, serial step) | P1–P4 budgets, unchanged by Phase 3 (p50 14 ms / p95 17.9–21.7 ms across runs — the 25 ms budget has thin headroom on this VM, 711–720 events/s) | `integration/recsys/performance` |
| **Live, opt-in** | exporter → real Redpanda (topic created with `retention.ms=604800000`, verified with `rpk`); real ClickHouse schema, idempotent re-delivery, `FINAL` dedup, tombstone block, real `DELETE`; the full chain Mongo → exporter → Redpanda → loader → ClickHouse → erase; **KPI parity** Mongo vs ClickHouse+dbt on identical events (overview and experiment read-out; non-trivial values: 6/6 activation, D1/D7 retention, median score gain 60 with the partial test excluded; all five study-time branches — test duration, out-of-test question time, flashcard latency, resource dwell, pronunciation/writing duration — with fractional values so rounding is compared too) | `__tests__/live` — 5 tests, skipped unless `RECSYS_LIVE_KAFKA` / `RECSYS_LIVE_CLICKHOUSE` are set |
| Offline eval regression guard | control NDCG@5 0.588 / P@3 0.925 **byte-identical** to the pre-Phase-3 baseline after every engine commit | `npm run recsys:eval` |
| dbt | 12 models/tests pass against real ClickHouse | `scripts/ops/run-dbt.sh build` |

**Process-level smoke (manual, run once, not automated):** `recsys-loader.ts --init` created the tables; `recsys-loader.ts` as a real process consumed 6 exported events from Redpanda into ClickHouse and its consumer disconnected on SIGTERM; `recsys-embed.ts` (hash provider) embedded 2 resources, then skipped both on the second run. Not run as processes: `run-dbt.sh` inside CI, the cron registration in `scheduler.ts` (the exporter/retrain schedules are plain `node-cron` calls that were type-checked and exercised only through the services they call).

Bugs these tests caught that unit tests with mocks would not have: `CREATE DATABASE` failing because the client sent a non-existent default database; a `toString(day) AS day` alias shadowing the column in `WHERE`; GROUP BY row order differing between Mongo and ClickHouse (flaky parity test → deterministic ordering added); Mongoose dropping an empty `segments: {}` so serving threw and silently fell back for everyone; gradient descent failing to separate collinear position/popularity effects (replaced by IRLS).

**Phase 3 known gaps:** the trainer has only seen synthetic data; the Gemini embedding provider was never executed; TLS/SASL never tested against a secured broker; loader consumer-group rebalancing and throughput were not stress-tested; no ClickHouse capacity measurement; the earlier full-suite and k6 gaps above still stand. Three runs failed transiently under 2-worker load on the 2.9 GB VM (two performance budgets, then two unrelated suites) and **could not be reproduced** in five subsequent runs — suspected memory/CPU contention, not a confirmed cause.

## 7. How to run
```bash
npx jest __tests__/unit/recsys                    # fast, pure
npx jest __tests__/integration                    # real MongoDB (first run downloads mongod ~80 MB)
npm run recsys:eval                               # offline evaluation table
# live (opt-in, needs Docker; one container at a time on a 2.9 GB VM):
docker compose -f docker-compose.analytics.yml up -d redpanda clickhouse
RECSYS_LIVE_KAFKA=localhost:19092 RECSYS_LIVE_CLICKHOUSE=http://localhost:18123 npx jest __tests__/live --maxWorkers=1
docker compose -f docker-compose.analytics.yml down -v
bash scripts/ci/typecheck-recsys.sh               # typecheck guard
k6 run -e BASE_URL=... -e TOKENS_FILE=tokens.json loadtest/recsys.k6.js
```
Tip: on machines with ≤ 3 GB RAM use `--maxWorkers=2` and don't run other heavy jobs concurrently (workers get OOM-killed).
