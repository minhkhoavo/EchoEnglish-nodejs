# EchoEnglish Personalised Recommendation Platform — Feature Document

| | |
| --- | --- |
| **Document status** | Living document, consolidated 2026-11-10 |
| **Product** | EchoEnglish — AI-assisted TOEIC / English learning for Vietnamese learners (Node.js, LangChain, MongoDB) |
| **Branch** | `feat/recommendation-platform` (about 48 commits ahead of `main`; **nothing has been pushed**, and a push to `main` deploys to production) |
| **Code** | `src/recsys/`, `analytics/dbt/`, `scripts/ops/`, `docker-compose.analytics.yml` |
| **Detailed sources** | `01-requirements.md` … `06-operations.md`, `TASKS.md`, `README.md` in this folder. This document consolidates them and does not replace them |
| **Decision authority** | All product and architecture decisions were delegated to engineering by the owner and are open to challenge |

---

## 1. Executive summary

### 1.1 What it is
A closed-loop personalisation platform. Every answer, review, reading session and speech attempt becomes a consented, idempotent event; a data pipeline turns events into learner features (skill mastery, forgetting estimates, habits); a deterministic, explainable recommender chooses the *next best actions*; and what the learner does with those suggestions flows back as new events that drive guardrails, experiments, KPIs and (in Phase 3) a learned ranker.

### 1.2 Why it exists
Today "what should I do next" comes from an LLM-generated weekly roadmap that does not learn from daily behaviour. Flashcards use a fixed Leitner ladder, resources are matched by label keywords, and no behavioural signal (dwell time, skips, review latency) is collected. Learners can stall without the product noticing, and the team cannot measure what drives score gain or retention.

### 1.3 Delivery status

| Stage | Scope | Status |
| --- | --- | --- |
| **MVP** (Phases 0–1) | Event contract and ingest, consent ledger, export/erase, bronze→silver→gold ETL with data-quality checks, mastery and forgetting model, explainable recommender, A/B bucketing, offline evaluation, KPI and health endpoints, CI, SHA-tagged deploy and rollback | **Built and tested.** Behind `RECSYS_ENABLED` (off until enabled) |
| **Phase 3 — Scale** | Stream to Redpanda, ClickHouse warehouse, dbt marts, KPI backend switch, feature store, learned ranker with automated retraining, content embeddings, code-level data residency | **Built and verified as far as this environment allows; dormant behind flags that default to off.** Four items cannot be closed without external inputs (§11) |
| **Phase 2 — Growth** | BullMQ + Redis, FSRS, GrowthBook, Terraform | **Not started** (design only). Phase 3 was built ahead of its own triggers at the owner's request |
| **Follow-ups** | Front-end consent UI, `DailySessionService` integration, drill endpoint, backfill, legal review | **Open** (`TASKS.md` T1.15–T1.26) |

### 1.4 Headline evidence

| Claim | Evidence | Caveat |
| --- | --- | --- |
| Pipeline is idempotent and replay-safe | Integration tests: replay, late arrivals, crash-before-ack | In-memory MongoDB |
| Personalisation beats random in simulation | `npm run recsys:eval`: control NDCG@5 **0.588** vs random 0.458; P@3 0.925 | **Synthetic ground truth** — validates plumbing and ordering, not real-world lift |
| Phase 3 works against real servers | Opt-in live tests: Redpanda v25.2.1, ClickHouse 25.8, `dbt build` 12/12, Mongo-vs-ClickHouse KPI parity, SASL/SCRAM over TLS, ClickHouse over HTTPS | Test CAs on localhost; dev VM only |
| Request path is fast | Recommendation p95 ≈ 18–22 ms against a 25 ms budget | Thin headroom; measured serially on a 2.9 GB dev VM |
| Erasure reaches every copy | Tombstones, Mongo delete, ClickHouse `DELETE`, retry sweep; tested and live-verified | Legal sufficiency needs counsel |
| Default suite is green | 25 suites, 260 tests passed on the last full run (`--maxWorkers=1`); the one suite changed since (HTTP, +1 test) re-run: 18/18 | The wider existing repository suite has never been confirmed green (memory-limited VM) |

### 1.5 What is *not* verified
* The learned ranker has only ever seen synthetic or simulated data. Every threshold is a judgement call.
* The Gemini embedding path has never produced a real embedding (§8.4: the key authenticates but the account has no credits).
* Production capacity, regional infrastructure, and the scheduled dbt workflow on GitHub.
* No recommendation has been shown to a real learner; real-world lift is unknown.

---

## 2. Problem, goals and scope

### 2.1 Goals
1. Make learning behaviour a compounding advantage: better next-step recommendations → faster TOEIC score gain → longer retention → more credit purchases at controlled AI cost.
2. Collect behavioural data **lawfully** (consent, minimisation, erasure) under Vietnam's PDPL (Law 91/2025/QH15) and Decree 356/2025.
3. Keep the request path cheap and deterministic: **no LLM call per recommendation**.
4. Add infrastructure only when a measured trigger fires.

### 2.2 Target KPIs (hypotheses, not promises)

| KPI | Baseline | 90-day target | Source |
| --- | --- | --- | --- |
| Activation (first learning action within 7 days) | to be measured | +10 pp | `kpiService.activation` |
| D7 retention | to be measured | +5 pp | cohort retention |
| Weekly study minutes per active learner | to be measured | +15 % | daily facts |
| Top-3 recommendation click-through | n/a | ≥ 25 % | `rec_click / rec_impression` |
| Median score gain per 8 weeks (≥ 2 tests) | to be measured | +30 TOEIC points | score history |
| AI cost per active learner per month | to be measured | ≤ 3 % of ARPU | `ai_usage` events |

The first two weeks in production are **measurement only**; targets are re-set from real baselines.

### 2.3 Non-goals (this release)
Audio in the event stream; LLM re-ranking on the request path; replacing the existing roadmap and daily session; a learner-selectable data region; production multi-region infrastructure.

### 2.4 Assumptions to validate
1. Scale ≤ 10 000 MAU and ≤ 60 events per active learner-day (≈ 10 M events/month, ≈ 4 events/s average).
2. Resources carry `labels.{cefr,domain,topic}`; coverage of skill tags on served questions ≥ 90 %.
3. Web and mobile clients can show a consent screen and call `POST /events/batch` (front-end work in another repository).
4. Behavioural tracking is treated conservatively as sensitive; cross-border flows (Gemini, Azure Speech, Atlas region, Stripe) need a Transfer Impact Assessment. **Counsel must confirm** — the legal summaries relied on here are secondary sources.
5. English and Vietnamese explanation templates ship; Vietnamese copy needs native-speaker review.

---

## 3. Architecture

### 3.1 Principles
Extend, don't replace · signals first, models later · fail-safe by construction (emitting an event never breaks a learner action; one flag turns everything off) · no LLM on the request path · privacy by design · infrastructure only on a measured trigger.

### 3.2 System overview

```mermaid
flowchart LR
  subgraph Clients
    W[Web / Mobile app]
  end
  subgraph API[Node.js API - existing monolith]
    EP[POST /events/batch]
    SVC[Existing services: test submit, flashcards, credits, speech, AI calls]
    REC[GET /recommendations]
    ADM[/admin/recsys/*/]
    PRIV[/privacy/*/]
  end
  subgraph Mongo[(MongoDB - system of record)]
    B[(learning_events - bronze)]
    S[(learning_events_clean - silver)]
    G[(learner_daily_facts - gold)]
    F[(skill_mastery, learner_features)]
    C[(consents + ledger)]
  end
  SCH[[Scheduler: node-cron every 2 min, Mongo lease]]
  W -- behavioural events --> EP --> B
  SVC -- emit, fail-safe --> B
  B --> SCH --> S --> G --> F
  F --> REC
  W --> REC
  REC -- impressions --> B
  W -- click/complete/dismiss --> EP
  ADM --> G
  PRIV --> B & S & G & F & C
```

**Closed loop:** learn → events → ETL → features → recommend → impressions and outcomes → events. Guardrails, A/B tests and offline evaluation read the same data.

### 3.3 Data layers

| Layer | Collection | Mutable | Retention |
| --- | --- | --- | --- |
| Bronze (raw) | `learning_events` (unique `eventId`) | only `processing.*` | 400 days (`RECSYS_EVENT_RETENTION_DAYS`) |
| Silver (clean) | `learning_events_clean` | no (rebuildable) | 400 days |
| Gold | `learner_daily_facts` (unique `{userId, day}`) | replaced per recompute | until erasure |
| Features | `skill_mastery`, `learner_features` | yes | until erasure |
| Functional | `recsys_exposure` (what was shown or dismissed) | yes | 30 days |
| Privacy | `recsys_consents`, `recsys_consent_ledger` | state / append-only | account life / legal retention |
| Ops | `recsys_pipeline_runs`, `recsys_locks` | yes | 90 days suggested |

Existing collections (`flashcards`, `users.preferences`, `resources.labels`, `question_metadata`, `payments`) are **read, never written**.

**Measured sizing** (20 000 synthetic events, MongoDB 7.0.24): bronze ≈ 527 B/event, silver ≈ 462 B/event, gold ≈ 1.2 KB per learner-day (logical sizes). At 10 M events/month the two event layers grow ≈ 10 GB/month; with the 400-day TTL ≈ 130 GB steady state before compression. Setting retention to 120 days cuts this to ≈ 40 GB.

### 3.4 Key decisions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Regular MongoDB collection for raw events, not time-series | Time-series collections have no unique indexes, restricted updates, no transactions and no change streams; idempotent inserts need a unique `eventId` |
| D2 | In-process micro-batch worker with a Mongo lease and watermark | Retries and single-runner semantics without Redis |
| D3 | Deterministic hybrid recommender, template explanations, no LLM per request | Gemini free-tier quotas are small; latency and cost must stay flat |
| D4 | Keep Leitner scheduling; prioritise reviews by estimated retrievability; FSRS later (Phase 2) | FSRS needs review history; zero schema risk |
| D5 | In-house deterministic hash bucketing for experiments | Zero infrastructure at 2–3 concurrent tests |
| D6 | Consent ledger: three purposes, default off, versioned, withdrawable | PDPL requires verifiable, non-pre-set consent |
| D7 | Audio never enters the event stream — scores only | Voice is high-risk personal data |
| D8 | Data region is server-assigned (default `vn`), admin-changeable, not user-selectable | Avoids region shopping and extra stored personal data; assignment at signup becomes a one-line change when region two exists |

### 3.5 Infrastructure triggers (when to add what)

| Concern | MVP choice | Move when… | Moves to |
| --- | --- | --- | --- |
| Event store | MongoDB | > ~200 M rows, or KPI queries > 1 s p95, or analytics load hurts API p95 | ClickHouse (P3, built) |
| Job runner | `node-cron` + lease | Per-job retries, fan-out > 1 worker, > 3 job types | BullMQ + Redis (P2) |
| Stream | none | > 500 events/s sustained or multiple consumers | Redpanda (P3, built) |
| Ranker | weighted, deterministic | ≥ 100 k impressions with outcomes | learned ranker (P3, built) |
| Experiments | in-house | > 3 concurrent tests or non-engineers running tests | GrowthBook (P2) |
| SRS | Leitner + retrievability | ≥ 30 days of review logs | FSRS shadow → flag (P2) |

**None of these triggers has fired.** Hence Phase 3 stays dormant in production.

### 3.6 Architecture diagrams (draw.io)

Editable sources live in `docs/recommendation/diagrams/` (open the `.drawio` files in draw.io, the VS Code draw.io extension, or diagrams.net). Each was generated from a script (`build-*.mjs`, run with `drawio-ai run`), so a diagram can be regenerated after a code change instead of redrawn. All four pass the layout validator with no errors, warnings or advice. A PNG export was **not** produced because the draw.io desktop CLI is not installed in this environment; export from draw.io when needed.

| Diagram | File | Shows |
| --- | --- | --- |
| 1. System architecture (MVP closed loop) | `diagrams/01-architecture.drawio` | Clients and services → collect → bronze/silver/gold → features → recommend; scheduler; privacy, analytics and operations as cross-cutting bands |
| 2. Recommender request flow | `diagrams/02-recommender.drawio` | One `GET /recommendations`: request, cache, context load, candidates, ranking and guardrails, explanation, impressions |
| 3. Phase 3 (Scale) | `diagrams/03-phase3.drawio` | Exporter, Redpanda, loader, ClickHouse, dbt, KPI backend switch, and the learning loop (snapshots, training, registry, harm guard, embeddings) |
| 4. Erasure process (BPMN swimlane) | `diagrams/04-erasure.drawio` | `DELETE /privacy/data` across learner, API, MongoDB and stream/warehouse lanes, including the failed-delete retry path |

The Mermaid diagram in §3.2 is kept as an inline overview that renders on GitHub; the draw.io files are the detailed versions.

---

## 4. Data, consent and privacy

### 4.1 Event contract v1
Envelope: `eventId` (UUIDv4, idempotency key) · `schemaVersion` · `type` · `occurredAt` · `sessionId?` · `props`. The client **cannot** send `userId` (the server injects it from the JWT) or server-authoritative types.

| Type | Category | Key properties | Producer |
| --- | --- | --- | --- |
| `question_answered` | service | `skillKey, correct, difficulty?, origin, timeMs?` | server |
| `test_submitted` | service | `testId, full, totalScore*, correct, total, durationSec` (*full tests only) | server |
| `flashcard_reviewed` | service | `flashcardId, remembered, prevLevel, newLevel, latencyMs?` | server |
| `vocab_captured`, `pronunciation_scored` | service | counts; **scores only, never audio** | server |
| `credit_spent`, `ai_usage` | service | feature, credits / model, tokens, cost | server |
| `session_started/ended`, `resource_viewed` | behavioural | dwell, scroll depth, completion | client |
| `rec_impression/click/complete/dismiss` | behavioural | `recId, itemType, itemRef, variant, position/reason` (+ ranking `signals` on impressions, server-side only) | server / client |

Ingest rules: schema and per-type validation; batch ≤ 100; `occurredAt` within [−7 days, +5 minutes]; duplicate `eventId` ignored; behavioural events dropped without `analytics` consent; unordered bulk insert so one bad row never blocks a batch.

### 4.2 Consent
Three purposes — `analytics`, `personalization`, `research` (reserved) — **default off**, versioned (`CURRENT_POLICY_VERSION`), recorded in an append-only ledger with timestamp and channel. Behavioural events need `analytics`; personalised ranking needs `personalization`. Without consent the product still works: learners get cold-start lists, and the repetition guard runs from a small functional store that is service data, not analytics.

### 4.3 Data-subject rights
`GET /privacy/export` returns the learner's data (events, daily facts, mastery, features, recommendation state, feature snapshots, region, consent and history). `DELETE /privacy/data` erases it everywhere: Mongo layers, then downstream copies (§6.2). `POST /privacy/consent/withdraw` withdraws immediately. Endpoints execute at once and are rate-limited.

### 4.4 Threats and controls

| Threat | Control |
| --- | --- |
| Event spoofing, score tampering | `userId` only from JWT; client allow-list; strict envelope; 60 requests/min per user |
| Replay or flooding | Idempotent `eventId`; batch cap; stale/future window |
| Cross-user access | Every query scoped by `req.user.id`; erasure tested not to touch other users |
| Admin exposure | `hasAuthority(ADMIN)`; cohorts under 5 suppressed |
| PII in analytics | Aggregates only; no names, emails or free text in events |
| Harmful recommendations | Guardrails, dismiss feedback, kill switches |

**Legal mapping** (as summarised from secondary sources; counsel to confirm): consent is provable and not pre-set; purposes are granular; data-subject rights execute immediately; breach runbook exists; cross-border assessment, DPO assignment and processing register are **open organisational items**.

---

## 5. The recommendation engine

### 5.1 Learner model
* **Skill mastery** — Elo / 1-PL ability θ per (learner, skill); `P(correct)=σ(θ−b)`; learning rate decays with attempts; θ decays toward 0 when unpracticed (τ = 60 days); confidence = 1−e^(−n/10). Skill keys (`p5.wordform`, `p3.inference` …) come from tags **embedded in test definitions**. Untagged answers become `part:N`/`unknown`: kept for analytics, never recommended.
* **Forgetting curve** — `R(t,S) = (1 + F·t/S)^(−d)` with FSRS-4.5 constants and `S` from the Leitner interval. Reviews are prioritised by retrievability; Leitner fields stay the source of truth.
* **Learner features** — activity, performance, SRS state, timing (best study hours), habits, engagement, per-skill view.

### 5.2 Candidates, ranking, guardrails

| Stage | Behaviour |
| --- | --- |
| Candidates | One SRS review block (≤ 20 cards); `skill_drill` for weak skills (≥ 3 attempts, mastery < 0.8) and thinly evidenced skills; resources matched by topic tags, interests, CEFR fit, popularity; habit nudges (mini test ≥ 21 days, pronunciation, vocab); **starter diagnostic** when no test exists |
| Ranker | `score = Σ wᵢ·signalᵢ + boost − recencyPenalty − completedRecently`. Variants `control` and `srs_heavy`; deterministic tie-break |
| Cold start | No personalisation consent or no skill with ≥ 3 attempts: interests/level/popularity weights, starter diagnostic pinned, no drills |
| Guardrails | Dismissed items 14 days; frequency cap (3 impressions / 7 days without a click); completion cooldowns; CEFR gap ≤ 1; ≤ 2 per type and per skill; diversity floor; time budget (1.25 × learner's daily minutes, keep ≥ 3) |
| Explanation | Every item has a reason code, evidence parameters and EN + VI text from templates, e.g. "Your accuracy on Part 5 · word form is about 45 % over 20 questions — the biggest opportunity to gain points." |

*Observation from the manual walkthrough (§9):* a learner who has practised but never taken a test gets the boosted 20-minute starter diagnostic first, which can consume most of a 30-minute budget and crowd out drills. This follows the current rules; whether it is desirable should be checked on real data.

### 5.3 Feedback loop and experiments
Impressions are written when a list is generated; clients report `click/complete/dismiss` through `POST /recommendations/feedback`. Events carry `variant` and `mode`. Experiment assignment is `sha256(experiment:user)` bucketing with kill switch `RECSYS_FORCE_VARIANT`; read-outs are per variant × mode with a two-proportion z-test. Each test must be pre-registered (metric, MDE, sample size, stop rule). Reference sizes at α = 0.05, power 0.8: CTR 20 % → 22 % needs ≈ 6.5 k impressions per arm; D7 retention 25 % → 28 % needs ≈ 3.3 k users per arm.

### 5.4 Offline evaluation
Metrics P@k, recall@k, NDCG@k, MRR, coverage, diversity; a replay evaluator joins logged impressions and outcomes; a seeded simulator scores rankers against hidden ground truth. Result (500 learners, seed 42): random 0.458 / control **0.588** / srs_heavy 0.538 NDCG@5. **This is synthetic ground truth.**

### 5.5 Known limitation
`skill_drill` items carry a proposed action payload `{screen:'skill_drill', skillKey, questions}` for which **no backend route exists yet** (T1.25). Until then they say *what* to practise but are not one-tap links.

### 5.6 Request lifecycle and serving rules (as implemented)
1. **Auth and rate limit.** Per-user limits: `/recommendations` 30/min, `/recommendations/feedback` 120/min, `/events/batch` 60/min, consent changes 20/min, export 5/h, erase 3/h, retrain 5/h.
2. **Cache.** Responses are cached per user and limit for 120 s; `refresh=true` bypasses the cache. The cache is per process and bounded to 5 000 lists (expired first, then oldest).
3. **Context.** Features (rebuilt on read when older than 6 h, because the ETL only rebuilds them when the learner produces events), profile, up to 300 resources (recent plus the learner's interest domains), the 30-day exposure map, 30-day popularity, and optionally semantic similarity.
4. **Variant.** `RECSYS_FORCE_VARIANT`, if set, wins. Otherwise the learner is served the **learned** model only when *all* hold: retraining flag on, a model is `active`, it was trained on `production` data (synthetic models can never serve), and the learner's hash bucket in `rec_learned_layer_v1` is below the model's `allocationPct`. Any other case (or a registry failure) falls back to the `control`/`srs_heavy` assignment.
5. **Selection.** Candidates → weighted score → guardrails → explanation. Ranking signals are logged with impressions for training and are never returned to clients.
6. **Side effects.** Impressions are always written to the functional exposure store; a `rec_impression` event is written only with analytics consent. Both are fire-and-forget and cannot fail the response.

---

## 6. Phase 3 — Scale (dormant behind flags)

### 6.1 Components

| Component | Purpose | Flag | Verification |
| --- | --- | --- | --- |
| Stream exporter | Mongo silver → topic `echo.learning_events.v1.<region>` (Redpanda v25.2.1; `@confluentinc/kafka-javascript`) | `RECSYS_STREAM_ENABLED` | Live |
| ClickHouse loader | Separate process (`npm run recsys:loader`); ReplacingMergeTree on `event_id`; erase and retry sweep | `RECSYS_CLICKHOUSE_ENABLED` | Live |
| dbt marts | `stg_events` view, `learner_daily_facts` table, tests (`analytics/dbt/`) | — | `dbt build` 12/12 |
| KPI backend switch | Mongo ⇄ ClickHouse with explicit fallback and `fallbackReason` | `RECSYS_ANALYTICS_BACKEND` | Live parity |
| Feature store | 15 versioned features; append-only point-in-time snapshots; as-of join never returns a later snapshot | `RECSYS_FEATURE_SNAPSHOTS` | Tests |
| Learned ranker | IRLS ridge logistic regression, position as a training-only covariate, user-level 80/20 split, gates, per-segment weights, registry | `RECSYS_RETRAIN_ENABLED` | Tests, **synthetic data only** |
| Content embeddings | Offline indexer (`npm run recsys:embed`), `semantic` signal | `RECSYS_EMBEDDINGS_ENABLED` | Hash provider only |
| Data residency (code) | Region tag, region-scoped topic, consumer group and pseudonym, loader refuses foreign-region messages | `RECSYS_REGIONS` | Tests |

### 6.2 Data flow and privacy controls

```
Mongo bronze → silver (existing ETL) ─► StreamExporter (cron 1 min, lease, cursor on silver _id)
   consent + tombstone gate, region lookup, HMAC pseudonym ─► topic  (bounded retention)
                                           │
                WarehouseLoader (own process, one per region)
   parse → drop invalid / foreign-region / erased → insert (dedup on event_id)
                                           ▼
               ClickHouse events ─dbt─► stg_events ─► learner_daily_facts ─► KpiService
```

Delivery is **at-least-once**: the exporter advances its cursor only after the broker acknowledges; the loader commits offsets only after the insert; duplicates collapse on `event_id`. A broker or warehouse outage cannot affect the API.

* **Pseudonymised, not anonymous.** `u = HMAC-SHA256(secret, "<region>:<userId>")[:32]`; exports **fail closed** without `RECSYS_PSEUDONYM_SALT` (≥ 16 characters). Region-scoped, so records cannot be joined across regions.
* **Consent at export time.** Withdrawal stops future exports; removal of history is by erasure.
* **Erasure reaches every copy.** Tombstones in every known region first, then Mongo, then a synchronous ClickHouse `DELETE`. Tombstones have **no TTL**. Exporter and loader refuse events at or before a tombstone; a sweep retries failed deletes (`warehousePending`). The API reports `downstream.warehouse = deleted | failed | not_enabled` truthfully.
* **Bounded retention.** Topics are created with `retention.ms` (168 h default), verified on a real broker.
* **Transport.** Dev overlay is plaintext; real brokers use TLS + SASL (SCRAM). Verified live with a private CA; wrong password, plaintext client and untrusted CA are refused. ClickHouse over HTTPS likewise.
* **Clock assumption.** Cursors resume from `_id` ordering; run NTP on every instance.

### 6.3 Learned ranker and retraining
Logged impressions (with ranking `signals`, `position`, `recId`) are joined to clicks by `(recId, itemType, itemRef)`, enriched with as-of feature snapshots, and trained under gates: minimum impressions and clicks, holdout ≥ 50 clicks, AUC lift over `control` ≥ `RECSYS_RETRAIN_MIN_AUC_LIFT`. The result is converted into an ordinary `WeightSet` (negative weights to 0, normalised; position coefficient dropped) — **no engine change**, and offline evaluation output stays byte-identical to the pre-Phase-3 baseline.

Serving uses its own hash layer (`rec_learned_layer_v1`) so existing assignments are not reshuffled. **Auto-activation is capped at 5 %; only an admin can raise it, to at most 50 %.** Models trained on synthetic data are `rejected` and can never be activated. A daily guard auto-retires a live model whose click-through is significantly worse than control (z ≤ −1.96 with ≥ 1 000 impressions). Automatic actions can shrink exposure; only a human can grow it.

Training runs in the API process, cooperatively: it yields to the event loop, uses at most the newest 200 000 impressions, and was measured at ≈ 2.6 s for 100 000 rows with a longest stall ≈ 0.5 s on the dev VM.

### 6.4 Embeddings
Resources are embedded from title, summary and trusted labels; unchanged content is skipped by hash; a per-run cap bounds cost. At serving time a learner's recently completed resources form a centroid; candidates get `signals.semantic` (cosine similarity). The signal has **weight 0 in every shipped variant**, so it changes nothing until a learned model weights it. `RECSYS_SEMANTIC_MIN` (0.75) is **uncalibrated and model-specific**.

### 6.5 Sizing (dev VM, not production)

| Measure | Result |
| --- | --- |
| Exporter (Mongo → Redpanda) | ≈ 3 800 events/s |
| End to end (Redpanda → ClickHouse) | ≈ 930 events/s |
| ClickHouse storage | 84 B/event compressed |
| MongoDB silver storage | 232 B/event incl. indexes (props-dependent) |
| Expected production load | ≈ 4 events/s average |

Not measured: query latency at scale, consumer-group rebalances, multi-hour runs, network latency to managed services.

---

## 7. Analytics, KPIs and monitoring

* **KPIs** (`GET /admin/recsys/kpis?windowDays=`): DAU/WAU/MAU, stickiness, activation, retention cohorts, study minutes, score gain, credit spend and unit economics, recommendation CTR/completion/dismiss by variant and mode. Cohorts under 5 are suppressed. The response states which backend produced the numbers and any fallback reason.
* **Experiments** (`GET /admin/recsys/experiments`): per variant × mode read-out with significance test.
* **Pipeline** (`GET /admin/recsys/pipeline`): last 20 runs with counts and data-quality results.
* **Health** (`GET /admin/recsys/health`, and `npm run recsys:health` with exit code 0/1/2): `ok / degraded / down` with reasons. Phase 3 adds exporter backlog and error, warehouse erasures pending > 10 minutes, and the live model. *This route was documented and implemented in the controller but never registered; it was found and fixed during the verification described in §8 (commit `54c6562`).*

Data-quality checks per ETL run: reject rate ≤ 5 % (critical), duplicate rate ≤ 20 %, unknown-skill rate ≤ 30 %, null required fields = 0 (critical), freshness lag ≤ 30 minutes (critical). Every silver and gold row carries `pipelineVersion` and `runId`, so any number can be traced back to raw events.

**Alert rules** (`06-operations.md` §2): pipeline down (P1), data quality degraded, freshness lag, recommendation health, AI cost spike, privacy endpoint failures (P1), event-volume anomaly. **Not yet wired:** loader consumer-group lag, persistent `fallbackReason`, `auto-retired` model alerts.

---

## 8. Quality and verification

### 8.1 Test strategy
Unit (contract, mastery, retention, ranker, guardrails, explainability, learning, embeddings, Kafka config) · integration against in-memory MongoDB (ingest, pipeline, features, HTTP, privacy, health, stream, warehouse, KPI backend, feature store, retraining, residency) · data-quality tests · performance budgets (run serially) · offline evaluation as a regression guard · opt-in **live** tests (`__tests__/live`, gated by environment variables) for Redpanda, ClickHouse, secured broker and ClickHouse over HTTPS.

Current state: **25 suites / 260 tests passed** on the last full default run (`npx jest … --maxWorkers=1`); lint and the three-pass type guard `scripts/ci/typecheck-recsys.sh` clean; offline evaluation identical to baseline. One test was added afterwards (health route) and its suite re-run: 18/18.

### 8.2 Defects found by verification (all fixed)
| Defect | How found |
| --- | --- |
| Model-registry cache stored a far-future expiry | Review; regression test |
| Training blocked the event loop ≈ 15 s at 500 k rows | Measurement; now yields, capped at 200 k |
| Mongoose dropped empty `segments: {}` so serving silently fell back | Test; `minimize:false` |
| Click join ambiguity (same `itemRef` across item types) | Rehearsal on the real emission path |
| Confluent client rejects object-form `ssl` | Live secured-broker test |
| ClickHouse `CREATE DATABASE`, alias shadowing, unordered GROUP BY | Live runs |
| **`GET /admin/recsys/health` never routed** | Manual verification review (this session) |
| **Gemini failures hidden**: the LangChain client swallows the HTTP error and returns empty vectors | First real API call (this session); the provider now reports it clearly |

### 8.3 Known test-stability note
A mastery test (`features.int`) failed intermittently under two-worker load; the root cause was **not established** (a clock-step hypothesis is unproven). It now sets an explicit `_id`. Heavy suites should run with `--maxWorkers=1` on small machines.

### 8.4 Real Gemini embedding attempt (2026-11-10)
The key was read from the running `echo-english` container into the environment of a single command and never printed. The key authenticates, but Google returned **HTTP 402 "prepayment credits are depleted"** on a direct `embedContent` call. No embeddings were produced, so the real provider remains unverified and the threshold uncalibrated. The offline hash baseline was run for reference: related-pair cosine median 0.31, unrelated 0.10, best separation near 0.25 (F1 0.81) — far below the 0.75 default, which is why the `semantic` weight stays at 0. Once credits are restored: `GENAI_API_KEY=… npx tsx scripts/ops/recsys-embed-calibrate.ts`.

---

## 9. How to check it yourself (without unit tests)

| # | Method | Command | What you see | Needs |
| --- | --- | --- | --- | --- |
| 1 | **Guided walkthrough** over the real HTTP routes and services | `npm run recsys:sandbox -- --walkthrough` | 19 PASS/FAIL checks: auth, consent gating, cold start, ETL, personalised list with explanations, feedback, admin refusal, health, KPIs, model registry, retrain dry-run, region validation, export, erase | Nothing (in-memory MongoDB, seeded catalogue) |
| 2 | **Interactive sandbox** — try it with curl or Postman | `npm run recsys:sandbox` | Prints a learner id and ready-to-paste `curl` commands (consent → practice → tick → recommendations → health → KPIs → export → erase). Auth is a header stub: `x-demo-user`, `x-demo-role` | Nothing |
| 3 | Offline evaluation report | `npm run recsys:eval` | Ranker comparison table | Nothing |
| 4 | Health probe against a real database | `MONGO_URI=… npm run recsys:health` | JSON report, exit code 0/1/2 | A MongoDB |
| 5 | Phase 3 live stack | `docker compose -f docker-compose.analytics.yml up -d`, then the opt-in live tests (`RECSYS_LIVE_KAFKA`, `RECSYS_LIVE_CLICKHOUSE` …) and `npm run recsys:loader` | Real events through Redpanda into ClickHouse; KPI parity | Docker, ~1.5 GB free RAM |
| 6 | dbt marts | `DBT_CH_HOST=… scripts/ops/run-dbt.sh build` | 12/12 model and test results | ClickHouse |
| 7 | Throughput benchmark | `npm run recsys:bench -- 150000 5000` (throwaway databases only) | events/s and bytes/event | Mongo, Redpanda, ClickHouse |
| 8 | Embedding job and calibration | `npm run recsys:embed`; `npx tsx scripts/ops/recsys-embed-calibrate.ts` | Cost report; similarity distributions and suggested threshold | `GENAI_API_KEY` **with credits** |
| 9 | Retraining on real logs | `POST /admin/recsys/models/retrain {"dryRun":true}` | Gate report: counts, AUC lift, reasons | ≥ 20 000 personalised impressions |
| 10 | Scheduled dbt workflow | GitHub → Actions → *analytics-dbt* → Run workflow | Hourly dbt run | `RECSYS_DBT_ENABLED=true`, `DBT_CH_*` secrets |

The sandbox never reads `MONGO_URI`; pointing it at a database requires the explicit `RECSYS_SANDBOX_MONGO_URI`, and it writes demo data.

---

## 10. Operations

### 10.1 Configuration reference (selected; full list in `.env.example`)

| Variable | Default | Effect |
| --- | --- | --- |
| `RECSYS_ENABLED` | `false` | Master switch: events, scheduler, recommendations |
| `RECSYS_EVENT_RETENTION_DAYS` | 400 | TTL for bronze and silver |
| `RECSYS_PIPELINE_BATCH` | 2000 | ETL batch size |
| `RECSYS_FORCE_VARIANT` | empty | Kill switch for experiments (e.g. `control`) |
| `RECSYS_PSEUDONYM_SALT` | empty | Required (≥ 16 chars, secret) for any export |
| `RECSYS_STREAM_ENABLED` / `_BROKERS` / `_TLS` / `_SASL_*` / `_RETENTION_HOURS` | off / – / off / – / 168 | Stream exporter |
| `RECSYS_CLICKHOUSE_*` | off | Warehouse loader (URL, DB, credentials, CA file, retention) |
| `RECSYS_ANALYTICS_BACKEND` | `mongo` | KPI source (`clickhouse` only after a week of parity checks) |
| `RECSYS_FEATURE_SNAPSHOTS` | `false` | Point-in-time snapshots (TTL 120 days) |
| `RECSYS_RETRAIN_ENABLED` and `_MIN_IMPRESSIONS` (20 000), `_MIN_CLICKS` (500), `_MIN_AUC_LIFT` (0.01), `RECSYS_CHALLENGER_PCT` (5) | off | Retraining and challenger exposure |
| `RECSYS_EMBEDDINGS_ENABLED` / `_PROVIDER` / `RECSYS_SEMANTIC_MIN` | off / `gemini` / 0.75 | Embeddings |
| `RECSYS_REGIONS` / `RECSYS_DEFAULT_REGION` / `RECSYS_LOADER_REGION` | `vn` | Residency |

### 10.2 Scheduled jobs (`src/recsys/scheduler.ts`)

| Job | Schedule | Gate | Notes |
| --- | --- | --- | --- |
| ETL tick (clean → aggregate → features) | every 2 min | `RECSYS_ENABLED` | Mongo lease; safe on every instance |
| Stream exporter | every minute | `RECSYS_STREAM_ENABLED` | Own lease and cursor; broker failure never affects the API |
| Retraining | Saturday 20:00 UTC | `RECSYS_RETRAIN_ENABLED` | Gated; auto-activates at ≤ 5 % only |
| Harm guard | daily 20:30 UTC | `RECSYS_RETRAIN_ENABLED` | Retires a significantly worse live model |
| Warehouse loader | continuous, **separate process** | `npm run recsys:loader` | One per region; keep a supervisor |
| dbt build | hourly (GitHub workflow) | `RECSYS_DBT_ENABLED` repo variable | Inert until configured; never run on GitHub yet |

### 10.3 API reference

| Route | Role | Purpose |
| --- | --- | --- |
| `POST /events/batch` | user | Ingest ≤ 100 client events |
| `GET`, `PUT /privacy/consent`; `POST /privacy/consent/withdraw` | user | Read, set, withdraw consent |
| `GET /privacy/export`; `DELETE /privacy/data` | user | Data-subject access and erasure |
| `GET /recommendations?limit=&refresh=` | user | Explained next-best actions |
| `POST /recommendations/feedback` | user | click / complete / dismiss; `itemType` must be a recommender item type, `itemRef` ≤ 80 chars |
| `GET /admin/recsys/{kpis,experiments,pipeline,health}` | admin | Analytics and health |
| `GET /admin/recsys/models`; `POST …/models/retrain`, `…/:version/activate`, `…/:version/retire` | admin | Model registry |
| `PUT /admin/recsys/learners/:userId/region` | admin | Residency assignment |

### 10.4 Rollout (each step reversible)
1. Deploy with `RECSYS_ENABLED=false`; smoke-test existing flows.
2. Enable on one instance; watch `/admin/recsys/health` for an hour; then all instances.
3. Follow shadow → 10 % → 100 % (`02-plan.md` §4); first two weeks measurement only.
4. Phase 3 steps, in order, only when a trigger has fired: secret salt → snapshots → stream and loader → dbt → KPI cut-over → embeddings → retraining (`05-deployment.md` §5b).

### 10.5 Rollback matrix

| Failure | Action |
| --- | --- |
| Bad release | `scripts/deploy/rollback.sh <sha>` (automatic on failed health probe) |
| Platform misbehaving | `RECSYS_ENABLED=false` and restart; the recommendations route still answers (cold start) |
| Bad ranking variant | `RECSYS_FORCE_VARIANT=control` |
| Buggy ETL | Fix, bump `pipelineVersion`, rebuild from silver (gold is replace-not-increment) |
| Exporter misbehaving | `RECSYS_STREAM_ENABLED=false`; the cursor is kept |
| Warehouse down | Nothing: KPIs answer from Mongo and say so; failed erasures retry |
| Bad learned model | `POST …/retire`, or force `control`; the guard also auto-retires on significant harm |

### 10.6 Runbooks
Pipeline stalled · data-quality degraded · bad recommendations · privacy incident · data-subject request · stream not flowing · loader lag · erase reported `failed` · KPI fallback · retraining · embedding job — see `06-operations.md` §4 and §4b. Operating cadence: weekly KPI review, per-experiment pre-registration and write-up, monthly offline re-evaluation and TTL review, quarterly weight tuning and trigger review.

---

## 11. Risks, open items and roadmap

### 11.1 Open items that need external input

| Item | What blocks it | Next action when unblocked |
| --- | --- | --- |
| **T3.12** Real embeddings and threshold calibration | Gemini account has no credits (HTTP 402); real catalogue not available here | Top up billing; run `recsys-embed-calibrate.ts`, then `recsys:embed` on a catalogue sample |
| **T3.13** First retrain on real learners | No production impressions; needs the consent UI (T1.16) | `POST …/retrain {"dryRun":true}` once ≥ 20 000 personalised impressions exist |
| **T3.15** Scheduled dbt workflow | Never executed on GitHub | Set `RECSYS_DBT_ENABLED=true` and `DBT_CH_*`, run via workflow_dispatch |
| **T3.16** Regional infrastructure | No second region or cloud provider chosen | Follow the written runbook (`03-architecture.md` §12.7) |

### 11.2 Product and engineering follow-ups (not Phase 3)
Integrate recommendations into `DailySessionService` behind an A/B (T1.15) · front-end consent UI and event batching (T1.16) · backfill of historical answers (T1.17) · per-feature AI cost tagging (T1.18) · drill endpoint for `skill_drill` (T1.25, blocking one-tap drills) · fix the existing `labels.domain` upper/lower-case bug in `findAvailableResources` (T1.20) · make `ci.yml` a required check once the full suite is confirmed green (T1.22) · staging environment and k6 run (T1.24) · legal review of the PDPL mapping, cross-border assessment, consent copy and ledger retention (T1.23).

### 11.3 Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Cold start / sparse data gives weak recommendations | High | Medium | Preference and popularity fallback; exploration bonus; guardrails |
| Default-off consent starves the model | Medium | Medium | Value-exchange consent copy; non-personalised fallback; measure opt-in rate |
| Legal misreading of PDPL / Decree 356 | Medium | High | Counsel review before launch; data-minimising design; tested erasure |
| Event emission slows or breaks learner actions | Low | High | Fire-and-forget emit that never throws; tested |
| Analytics load on MongoDB | Medium | Medium | Bounded windows, read from facts; ClickHouse at trigger |
| Taxonomy gaps | Medium | Medium | `part:N` fallback; data-quality check |
| Repetitive or poor suggestions erode trust | Medium | High | Guardrails, dismiss feedback, weekly review of top items |
| Thresholds tuned on synthetic data are wrong for real learners | High | Medium | Dry-run first; ≤ 5 % challenger; auto-retire guard; retune on real data |

### 11.4 Roadmap
**Next:** ship consent UI and events from clients → collect two weeks of baselines → enable the MVP on one instance → shadow period and replay evaluation → first A/B. **Then (when triggers fire):** Phase 2 (BullMQ, FSRS shadow, GrowthBook, Terraform) and activation of the Phase 3 chain in the documented order.

---

## Appendix A — Code map

```
src/recsys/
  config.ts · scheduler.ts
  events/      eventTypes · eventModel · eventService · emitters · aiUsageTracker
  privacy/     consentModel · consentService · dataSubjectService
  etl/         models · clean · aggregate · dataQuality · pipeline
  features/    skillTaxonomy · mastery · retention · featureModels · featureBuilder
  engine/      types · cefr · contentTags · candidates · ranker · guardrails · explain · experiments · recommender
  eval/        metrics · replay · simulator · cli
  analytics/   kpi · kpiService · healthService · sources
  http/        routes · recsysController
  stream/      pseudonym · wire · erasure · regions · kafkaConfig · producer · exporter        (Phase 3)
  warehouse/   schema · clickhouse · loader · erasure · consumer                                (Phase 3)
  featurestore/ registry · snapshotModel · store                                               (Phase 3)
  learning/    logreg · model · train · dataset · registry · retrain                           (Phase 3)
  embeddings/  provider · store · indexer · semantic                                           (Phase 3)
analytics/dbt/                     staging and mart models, tests, pinned container
scripts/ops/  recsys-sandbox · recsys-health · recsys-loader · recsys-embed · recsys-embed-calibrate · recsys-bench · run-dbt.sh
scripts/ci/   typecheck-recsys.sh
docker-compose.analytics.yml       Redpanda v25.2.1 and ClickHouse 25.8 (pinned, memory-capped)
```

## Appendix B — Glossary
**Bronze / silver / gold** raw, cleaned and aggregated data layers · **Cold start** list for a learner with no consent or too little evidence · **Elo / 1-PL** ability model used for skill mastery · **IRLS** iteratively reweighted least squares, the logistic-regression solver · **Leitner** fixed-interval flashcard system in use · **FSRS** a trainable spaced-repetition model (Phase 2) · **Pseudonym** HMAC of region and user id used in the warehouse · **Tombstone** record that a learner was erased, blocking later exports · **WeightSet** the set of ranking weights; a learned model is expressed as one · **MDE** minimum detectable effect.
