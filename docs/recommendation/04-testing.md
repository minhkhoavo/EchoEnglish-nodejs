# 04 · Testing

## 1. Strategy
Test pyramid, weighted toward **real-database integration tests** wherever Mongo semantics matter (unique indexes, upserts, TTL-independent behaviour, erasure). Pure logic (ranking, mastery, KPIs, DQ rules) is unit-tested exhaustively because it is deterministic. Integration tests use `mongodb-memory-server` (real `mongod` 7.0), so idempotency and index behaviour are tested against the real engine, not mocks.

| Layer | Files (`__tests__/…`) | Cases | What it proves |
| --- | --- | --- | --- |
| Unit – contract | `unit/recsys/eventTypes` | 10 | schema strictness, client allow-list, variant required on feedback events |
| Unit – ETL | `unit/recsys/etl` | 12 | local-day boundary (UTC+7), clamping, no double-counted study time, determinism, DQ rules |
| Unit – features | `unit/recsys/features` | 16 | mastery convergence/bounds/decay, `R(S,S)=0.9`, streak, trend, empty learner |
| Unit – engine | `unit/recsys/engine` | 34 | candidates, cold start, ranker, every guardrail, explanations (EN+VI, no `undefined`), hash-bucket split, end-to-end properties |
| Unit – eval | `unit/recsys/eval` | 10 | metrics on known lists, replay join, seeded simulation criteria |
| Unit – KPI | `unit/recsys/kpi` | 17 | activation/retention maturity, k-anonymity, score gain, unit economics, z-test |
| Unit – AI usage | `unit/recsys/aiUsage` | 10 | token extraction, rate config, attribution, never-throws |
| Unit – learning (P3) | `unit/recsys/learning` | 15 | IRLS logistic regression, AUC, weights conversion, trainer gates, training does not block the event loop |
| Unit – embeddings (P3) | `unit/recsys/embeddings` | 11 | hashing provider, vector codec and cosine, content hashing, engine integration |
| Unit – Kafka config (P3) | `unit/recsys/kafkaConfig` | 6 | TLS/SASL settings, private CA, refusals |
| Unit – Gemini wrapper (P3) | `unit/recsys/geminiProvider` | 7 | model/key selection, normalisation, error paths (client mocked) |
| Unit – hardening (P4) | `unit/recsys/hardening` | 28 | exploration slot, position bias from the random slot, outcome label, counterfactual replay, per-learner read-out and sample-ratio check, item difficulty, honest explanations and bilingual titles, retrieval hints, consent-keyed cache, alerts |
| Unit – Postman drift | `unit/recsys/postmanCollection` | 5 | collection and router agree both ways, every request asserts, environments carry no credentials or non-local URLs |
| Integration – ingest | `integration/recsys/eventIngest` | 7 | idempotency on real unique index, consent gate, stale/future, mixed batches, emit never throws |
| Integration – pipeline | `integration/recsys/pipeline` | 6 | bronze→silver→gold, replay idempotency, late events, rejects, lease contention |
| Integration – features | `integration/recsys/features` | 4 | cursor-based mastery updates, persisted feature set with real flashcards |
| Integration – HTTP | `integration/recsys/http` | 18 | consent API, auth/validation, spoofed `userId`, **closed loop** events→recs→impressions, anti-repetition, export+erase, admin RBAC |
| Integration – emitters | `integration/recsys/emitters` | 6 | skill tags from the embedded test definition (+ metadata fallback), full vs partial test scores, no-op when disabled |
| Integration – health | `integration/recsys/health` | 12 | ok/degraded/down logic; Phase 3 sections only when their flags are on |
| Integration – stream (P3) | `integration/recsys/streamExporter` | 7 | cursor and lease, at-least-once, consent and tombstone gating, pseudonym guard |
| Integration – warehouse (P3) | `integration/recsys/warehouse` | 6 | loader drops invalid / foreign-region / erased events, erase propagation and retry |
| Integration – KPI backend (P3) | `integration/recsys/kpiBackend` | 3 | Mongo ⇄ ClickHouse switch, explicit fallback with reason |
| Integration – feature store (P3) | `integration/recsys/featureStore` | 8 | registry, snapshots, point-in-time join (no future leakage), export and erase |
| Integration – retraining (P3) | `integration/recsys/retrain` | 21 | gates, registry rules, as-of join, label join across item types, serving layer, registry cache, harm guard |
| Integration – rehearsal (P3/P4) | `integration/recsys/retrainRehearsal` | 1 | whole loop on logs from the real recommender (§6b) |
| Integration – residency (P3) | `integration/recsys/residency` | 8 | region tag, routing and isolation, data-subject rights, admin endpoint |
| Integration – embeddings (P3) | `integration/recsys/embeddings` | 8 | indexer, semantic context, recommender end to end |
| Integration – hardening (P4) | `integration/recsys/hardening` | 11 | served-list log and attribution (a forged variant is ignored), exploration logged end to end, outcome labels from real events, experiment read-out, item-difficulty calibration, index-backed retrieval |
| Performance | `integration/recsys/performance` | 2 | latency and throughput budgets (§3), run on its own |
| **Total** | **29 suites** | **309** | 307 in the CI set + 2 performance |

**Latest run (2026-11-23, this VM, `--maxWorkers=1`):** CI set (`npx jest __tests__/unit/recsys __tests__/integration --testPathIgnorePatterns performance`) **28 suites, 307 tests, all passing**; performance suite run separately, see §3; offline evaluation unchanged (§4). On GitHub, the recommendation job and the full existing suite are green for commit `bf5015a`. (The earlier figure of 35 suites / 647 tests included the existing suites for files this work touched.)

## 2. Data-quality tests
* Run-time DQ (`etl/dataQuality.ts`) — unit-tested thresholds and an integration test where a contract-violating raw row yields `rejected` + `degraded` while good rows still flow.
* Data contracts: strict zod envelope; props validated at ingest **and** re-validated at ETL (contract may evolve).
* Reconciliation: replay test asserts `learner_daily_facts` equals recompute from silver and that raw→silver counts match (`cleaned + alreadyClean + rejected = read`).

## 3. Performance & load — criteria and measurements

| ID | Criterion (pass/fail) | Measured (dev VM, 2 vCPU class, in-memory Mongo) |
| --- | --- | --- |
| P1 | Recommender compute p95 ≤ 25 ms (300 resource candidates, 200 learners, warm, best of 3 rounds) | Run alone (2026-11-23): p50 12.7 ms / p95 16.7 ms under Jest instrumentation; ≈ 6 ms mean in plain Node. **Over budget twice when the VM was busy:** 25.07 ms under concurrent load (Phase 4 work) and 25.29 ms straight after the full 28-suite run. The CI performance step passed |
| P2 | Ingest 5,000 events (batches of 100) ≤ 20 s | ≈ 6.2–6.8 s (≈ 735–805 events/s) |
| P3 | ETL 5,000 events ≤ 20 s | ≈ 7.0–10.6 s |
| P4 | Feature build, 50 touched users ≤ 30 s | ≈ 2.7–2.9 s |
| L1 | k6: `/recommendations` p95 < 300 ms, p99 < 800 ms; `/events/batch` p95 < 200 ms; error rate < 1% at 20 rps recs + 3 batches/s | **not executed** — `loadtest/recsys.k6.js` is ready; run on staging (T1.24) |

P1 has thin headroom on this VM: the budget is met when the test runs alone but not reliably when the machine is busy, so CI runs it as its own serial step. If it starts failing on CI, profile the request path before raising the budget (Phase 4 added the exploration pool and the served-list record to it).

Honest caveat: P2–P4 use an in-memory MongoDB on a shared VM; they validate algorithmic behaviour and catch regressions (a first run caught an O(R·W·K·T) hot loop that was then fixed), not production capacity. Capacity must be re-measured on staging with the real Atlas tier.

## 4. Offline recommendation evaluation (pass/fail in CI)
`eval.unit` simulation (300 learners, seed 42) must satisfy: control NDCG@5 ≥ random + 0.08; P@3 ≥ 0.85; list diversity ≥ 0.6; coverage ≤ 1; `srs_heavy` within 10% of control. Current: NDCG@5 0.588 vs 0.458 (random), P@3 0.925. `npm run recsys:eval` is also run in CI as a regression guard. **Synthetic ground truth — see 03 §7.9.**

## 5. Privacy tests
Default-off consent; ledger entry per change; behavioural events dropped without consent; spoofed `userId` rejected; export contains all derived collections; erase removes events/clean/facts/mastery/features, withdraws consent, retains ledger, and **does not touch other users**.

## 6. Known gaps (be explicit)
* **Not executed here:** k6 load test; deploy/rollback scripts against a real VPS (written, shell-reviewed only). CI workflows **have** run on GitHub since the branch was pushed (PR #43): see below.
* No real-user validation of reason copy, consent wording, or recommendation usefulness (README §4/§6).
* Real-data replay evaluation requires production logs.
* Full existing suite status: **green on GitHub CI** (`ci.yml / full-suite`, commit `bf5015a`, both the push and the pull-request run). It still cannot be run on the 2.9 GB dev VM (jest workers get OOM-killed), so local evidence is limited to the suites for touched files. The `owasp-scan` and `trivy-scan` jobs fail on the branch; they are security scans of the whole repository and out of scope for this work.
* Repo-wide `tsc` has 53 pre-existing errors (controllers); new code adds none (`scripts/ci/typecheck-recsys.sh`, which now type-checks src, the test tree and ops scripts in three passes — earlier it silently skipped tests and scripts).

## 6b. Phase 3 tests
| Layer | What it proves | Where |
| --- | --- | --- |
| Default suite (CI) | exporter cursor/lease/at-least-once, consent + tombstone gating, pseudonym guard, loader (invalid / foreign-region / erased), erase propagation + retry, feature-store point-in-time join (no future leakage), trainer (gates, position bias, user-level split), registry rules (caps, synthetic never servable, one DB read per TTL), serving (flag off ⇒ untouched, no reshuffling of control/srs_heavy, kill switch, registry failure degrades), harm guard, embeddings indexer/semantic/engine wiring, residency routing, KPI backend fallback, Kafka config | `__tests__/unit/recsys`, `__tests__/integration/recsys` — part of the 307 tests in §1 (at the end of Phase 3 it was 260 tests in 25 suites), passing in the single-worker run (`--maxWorkers=1`; on this 2.9 GB VM a 2-worker run later exhausted memory and had to be stopped, and earlier 2-worker runs had intermittent failures: see below) |
| Retraining **rehearsal** | the whole loop on logs produced by the real recommender + event path: impressions with signals → simulated clicks **and completions** (Phase 4 trains on outcome labels) → as-of feature snapshots → `retrainService.run()` → registry (6 000 impressions, 2 653 clicks; AUC 0.942 vs 0.889 control, lift 0.053; challenger 5 %). Behaviour is **simulated** — plumbing evidence, not evidence about real learners. Found a real label-join bug | `integration/recsys/retrainRehearsal` |
| Gemini wrapper (client mocked) | model/key selection, normalisation, error paths — **not** the real API | `unit/recsys/geminiProvider` |
| Performance (CI, serial step) | P1–P4 budgets, unchanged by Phase 3 (p50 14 ms / p95 17.9–21.7 ms across runs — the 25 ms budget has thin headroom on this VM, 711–720 events/s); for Phase 4 numbers see §3 | `integration/recsys/performance` |
| **Live, opt-in** | exporter → real Redpanda (topic created with `retention.ms=604800000`, verified with `rpk`); real ClickHouse schema, idempotent re-delivery, `FINAL` dedup, tombstone block, real `DELETE`; the full chain Mongo → exporter → Redpanda → loader → ClickHouse → erase; **KPI parity** Mongo vs ClickHouse+dbt on identical events (overview and experiment read-out; non-trivial values: 6/6 activation, D1/D7 retention, median score gain 60 with the partial test excluded; all five study-time branches — test duration, out-of-test question time, flashcard latency, resource dwell, pronunciation/writing duration — with fractional values so rounding is compared too) | `__tests__/live` — 5 tests, skipped unless `RECSYS_LIVE_KAFKA` / `RECSYS_LIVE_CLICKHOUSE` are set |
| **Live ClickHouse over HTTPS, opt-in** | private-CA TLS works; refused without the CA; unreadable CA file throws | `__tests__/live/clickhouseTls.live.test.ts` (`RECSYS_LIVE_CLICKHOUSE_TLS`, `RECSYS_LIVE_CLICKHOUSE_CA`) |
| **Live secured broker, opt-in** | SASL/SCRAM-SHA-256 over TLS with a private CA: export + read-back by a second authenticated client; refusal of a wrong password, of a plaintext client and of an untrusted CA | `__tests__/live/kafkaSecure.live.test.ts` (`RECSYS_LIVE_KAFKA_SECURE`, `RECSYS_LIVE_KAFKA_CA`, `…_USER`, `…_PASS`) |
| Offline eval regression guard | control NDCG@5 0.588 / P@3 0.925 **byte-identical** to the pre-Phase-3 baseline after every engine commit | `npm run recsys:eval` |
| dbt | 12 models/tests pass against real ClickHouse | `scripts/ops/run-dbt.sh build` |

**Process-level smoke (manual, run once, not automated):** `recsys-loader.ts --init` created the tables; `recsys-loader.ts` as a real process consumed 6 exported events from Redpanda into ClickHouse and its consumer disconnected on SIGTERM; `recsys-embed.ts` (hash provider) embedded 2 resources, then skipped both on the second run. Not run as processes: `run-dbt.sh` inside CI, the cron registration in `scheduler.ts` (the exporter/retrain schedules are plain `node-cron` calls that were type-checked and exercised only through the services they call).

Bugs these tests caught that unit tests with mocks would not have: `CREATE DATABASE` failing because the client sent a non-existent default database; a `toString(day) AS day` alias shadowing the column in `WHERE`; GROUP BY row order differing between Mongo and ClickHouse (flaky parity test → deterministic ordering added); Mongoose dropping an empty `segments: {}` so serving threw and silently fell back for everyone; gradient descent failing to separate collinear position/popularity effects (replaced by IRLS).

**Phase 3 known gaps:** the trainer has only seen synthetic data; the Gemini embedding provider was never executed (no API key available); consumer-group rebalancing and multi-hour runs were not exercised; throughput was measured on the dev VM only (03 §12.8); the earlier full-suite and k6 gaps above still stand. **Intermittent failures seen on the 2.9 GB dev VM, honestly listed:** (a) the two performance budgets failed twice when other work was running at the same time — once under a 2-worker run, once because I had started another command; both passed when run alone, which is why CI now runs them serially; (b) the mastery cursor test (`features.int`, "late event with an OLD receivedAt") failed twice in roughly a dozen 2-worker runs — once together with the stream-exporter suite — and never in 40 isolated repetitions; **root cause not established** (a wall-clock step affecting ObjectId ordering is a hypothesis, see 03 §12.3); the test now uses an explicit later `_id`; (c) a new event-loop responsiveness test exceeded jest's 5 s default under contention (fixed: smaller input, explicit timeout). The last 2-worker run was fully green; treat the suite as *usually* stable on this VM, not proven flake-free.

## 6c. Phase 4 tests
| What | Where |
| --- | --- |
| Exploration slot (seeding, pool, propensity), position-bias estimate and IPW, outcome label window, counterfactual estimator, per-learner Welch t-test and sample-ratio check, item difficulty, explanation wording, consent-keyed cache, alert rate limit | `unit/recsys/hardening` (28) |
| The same features through the real services and HTTP routes: served-list log and feedback attribution (including a forged `variant`), exploration logged end to end, outcome labels built from real events, experiment read-out, item-difficulty calibration, index-backed retrieval | `integration/recsys/hardening` (11) |
| Request flow over HTTP against the sandbox: 19 walkthrough checks and 35 Postman requests / 70 assertions (newman) | `npm run recsys:sandbox -- --walkthrough`; Postman collection (§7) |

`__tests__/setup.ts` sets `RECSYS_EXPLORE_PCT=0` so lists are deterministic; tests that exercise exploration set it themselves.

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
Tip: on machines with ≤ 3 GB RAM use `--maxWorkers=1` and don't run other heavy jobs concurrently (workers get OOM-killed; CI uses 2 workers on larger runners).

```bash
npm run recsys:sandbox -- --walkthrough           # 19 HTTP checks over throwaway data
npm run recsys:sandbox                            # then, in another terminal:
npx -y newman@6.2.1 run docs/recommendation/postman/recsys.postman_collection.json \
  -e docs/recommendation/postman/recsys-sandbox.postman_environment.json   # 35 requests, 70 assertions
```

**Manual (non-unit) checks:** `npm run recsys:sandbox -- --walkthrough` drives the real HTTP routes and services over throwaway data and prints 19 PASS/FAIL checks; `npm run recsys:sandbox` serves the same API for curl and for the Postman collection in `postman/` (35 requests, 70 assertions; also runnable with newman). `__tests__/unit/recsys/postmanCollection.unit.test.ts` fails when the collection and the router disagree. See `FEATURE-DOCUMENT.md` §9 for the full list and `DEVELOPER-GUIDE.md` for how to use them.
