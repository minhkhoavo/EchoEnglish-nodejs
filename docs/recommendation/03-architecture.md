# 03 · Architecture & Design

## 1. Principles
1. **Extend, don't replace.** The existing roadmap/daily-session (`src/services/recommendation/*`) keeps working; the new `src/recsys/` platform adds signals, mastery and a ranked "next best actions" API beside it.
2. **Signals first, models later.** Collect clean, consented, idempotent events now; learned models need data that does not exist yet.
3. **Fail-safe by construction.** Emitting a signal never breaks a learner action; one flag turns everything off.
4. **No LLM on the request path** (quota, latency, cost). LLMs stay where they add unique value (analysis, plan text).
5. **Privacy by design.** Default-off consent, minimisation (scores/ids only), per-user erasure that is a handful of indexed deletes.
6. **Introduce infrastructure only when a measurable trigger fires** (§10).

## 2. System overview

```mermaid
flowchart LR
  subgraph Clients
    W[Web / Mobile app]
  end
  subgraph API[Node.js API (existing monolith)]
    EP[POST /events/batch]
    SVC[Existing services\n test submit · flashcard review\n credits · speech · AI calls]
    REC[GET /recommendations]
    ADM[/admin/recsys/*/]
    PRIV[/privacy/*/]
  end
  subgraph Mongo[(MongoDB)]
    B[(learning_events\nbronze)]
    S[(learning_events_clean\nsilver)]
    G[(learner_daily_facts\ngold)]
    F[(skill_mastery · learner_features)]
    C[(consents + ledger)]
    R[(pipeline_runs · locks)]
  end
  SCH[[Scheduler\n node-cron every 2 min\n Mongo lease]]
  W -- behavioural events --> EP
  SVC -- emit() fail-safe --> B
  EP --> B
  SCH --> S --> G --> F
  B --> SCH
  F --> REC
  W --> REC
  REC -- impressions --> B
  W -- click/complete/dismiss --> EP
  ADM --> G
  PRIV --> B & S & G & F & C
```

**Closed loop:** learn → events → ETL → features → recommend → impressions/outcomes → events (guardrails + A/B + offline eval read the same data).

## 3. Data model

| Layer | Collection | Key / indexes | Mutable? | Retention |
| --- | --- | --- | --- | --- |
| Bronze (raw) | `learning_events` | unique `eventId`; `{userId, occurredAt}`; `{processing.status, receivedAt}`; `{type, occurredAt}`; TTL on `receivedAt` | only `processing.*` | 400 d (`RECSYS_EVENT_RETENTION_DAYS`) |
| Silver (clean) | `learning_events_clean` | unique `eventId`; `{userId, day}`; TTL | no (rebuildable) | 400 d |
| Gold | `learner_daily_facts` | unique `{userId, day}`; `{day}` | replaced per recompute | until erasure (aggregate, recommend 24 mo) |
| Features | `skill_mastery` | unique `{userId, skillKey}` | yes | until erasure |
| Features | `learner_features` | unique `userId` | yes | until erasure |
| Functional | `recsys_exposure` | unique `{userId, itemId}`; TTL `expireAt` (30 d after last touch) | yes | 30 d |
| Privacy | `recsys_consents` / `recsys_consent_ledger` | unique `userId` / `{userId}` | state / append-only | state: life of account; ledger: legal retention (counsel) |
| Ops | `recsys_pipeline_runs`, `recsys_locks` | `runId`; `_id='etl'` lease | yes | keep 90 d (add TTL when needed) |

Why a regular collection for raw events (not Mongo time-series): the current MongoDB manual lists no unique indexes, updates limited to the `metaField`, no transactional writes and no change streams for time-series collections ([MongoDB limitations](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-limitations/)); we need idempotent inserts and in-place ETL status.

Existing collections are **read, never written** by the platform: `flashcards` (due cards / retrievability), `users.preferences`, `resources.labels`, `question_metadata` (skill tags), `payments` (revenue KPI).

**Measured sizing** (20,000 synthetic events through the real pipeline, MongoDB 7.0.24): bronze ≈ **527 B/event** (436 B doc + indexes), silver ≈ **462 B/event**, gold ≈ **1.2 KB per learner-day** (uncompressed logical sizes; WiredTiger compression will reduce on-disk size — not measured). At the assumed 10M events/month the two event layers grow ≈ **10 GB/month**; with the default 400-day TTL that is ≈ 130 GB steady state before compression. **Cost lever:** `RECSYS_EVENT_RETENTION_DAYS=120` (silver/gold already hold what the recommender needs) cuts this to ≈ 40 GB; decide with the product owner how long raw events are needed for replay/audit.

## 4. Event contract v1 (`src/recsys/events/eventTypes.ts`)

Envelope: `eventId` (UUIDv4, idempotency key) · `schemaVersion` · `type` · `occurredAt` · `sessionId?` · `props`. The client **cannot** send `userId` (strict envelope; server injects from JWT) or server-authoritative types.

| Type | Category | Key props | Producer |
| --- | --- | --- | --- |
| `question_answered` | service | `skillKey, correct, difficulty?, origin, timeMs?` | server (test submit) |
| `test_submitted` | service | `testId, full, totalScore*, listening/reading*, correct, total, durationSec` (*only when `full`) | server |
| `flashcard_reviewed` | service | `flashcardId, remembered, prevLevel, newLevel, latencyMs?` | server |
| `vocab_captured` | service | `source (object_detection\|manual\|ai_generated…), termCount` | server |
| `pronunciation_scored` | service | `accuracy, fluency?, completeness?, prosody?` — **scores only, no audio** | server |
| `credit_spent` / `ai_usage` | service | `feature, credits` / `model, tokens, costUsd` | server |
| `session_started/ended`, `resource_viewed` | behavioural | `dwellSec, scrollDepth, completed` | client |
| `rec_impression/click/complete/dismiss` | behavioural | `recId, itemType, itemRef, variant, position/reason` | server (impression) / client |

**Units & semantics (verified against the existing code):** `durationSec` is **seconds** — the test-submit request carries milliseconds and is converted in `testResultService`; the speech pipeline's `metadata.duration` is already seconds. Scores are attached **only for full 7-part tests** (`full: true`); a Part-5-only practice has a "TOEIC score" of ~150 that would corrupt learner CEFR and the score-gain KPI.

Rules enforced at ingest: schema + per-type props validation, batch ≤ 100, `occurredAt` within [−7 d, +5 min], duplicate `eventId` ignored, behavioural events dropped without `analytics` consent, ordered:false bulk insert so one bad row never blocks the batch.

## 5. ETL / data pipeline

```
learning_events (pending) ──clean──► learning_events_clean ──aggregate (per user-day, REPLACE)──► learner_daily_facts ──► features
        │ rejected(reason)                  upsert $setOnInsert by eventId                           lineage: pipelineVersion, runId, source range
```

* **Trigger:** a 2-minute tick (`node-cron`) **plus** work-queue semantics: any `processing.status='pending'` row is work. Real-time path = the tick (≤ 2 min lag); batch path = same code with larger `RECSYS_PIPELINE_BATCH` / `rebuildUser()` for backfills after a `pipelineVersion` bump.
* **Multi-instance safe:** Mongo lease (`recsys_locks`, TTL 4 min); losers return immediately; a crashed holder is taken over after expiry.
* **Idempotent & replayable:** silver upsert by `eventId`; gold is recomputed from silver (never `$inc`), so replays and late events converge to the same numbers (integration-tested).
* **Study-time rule (no double counting):** test duration counted once; in-test `question_answered.timeMs` excluded; app-open time (`session_ended`) is not study time.
* **Data-quality checks per run** (`dataQuality.ts`, persisted on the run, surfaced by `/admin/recsys/health`):

| Check | Threshold | Severity |
| --- | --- | --- |
| reject_rate | ≤ 5% | critical |
| duplicate_rate (already-clean) | ≤ 20% | warn |
| unknown_skill_rate (taxonomy gaps) | ≤ 30% | warn |
| null_required_fields | 0 | critical |
| freshness_lag_minutes (oldest pending) | ≤ 30 | critical |

* **Lineage:** every silver/gold row carries `pipelineVersion` and `runId`; gold stores `sourceEventCount`, `min/maxOccurredAt`; runs store read/cleaned/rejected counts and the received-at range. To answer "why is this number X?": gold row → run → silver events → raw events.

## 6. Feature layer

* **Skill mastery** (`features/mastery.ts`): Elo/1-PL ability θ per (learner, skill); `P(correct)=σ(θ−b)` with item difficulty `b` from question metadata; learning rate decays with attempts (0.5/√(1+n/3), floor 0.06); θ decays toward 0 with τ=60 days when unpracticed; confidence = 1−e^(−n/10). Skill keys (`p5.wordform`, `p3.inference`, …; coarse for P3/P4) are derived from the tags **embedded in the test definition** (`questions[].skillTags/contentTags`, joined by `questionNumber` — the same source `AnalysisEngineService` uses); the `question_metadata` collection is only a fallback. Untagged answers become `part:N` / `unknown`: they are kept for analytics but are **never recommended** (no drill target / deep link) and do not count as evidence for personalised mode. Idempotent via a per-user cursor on the silver `_id` (insertion order; a `receivedAt` cursor would permanently skip re-queued rejected events and batch tails).
* **Forgetting curve** (`features/retention.ts`): `R(t,S) = (1 + F·t/S)^(−d)`, `F = 0.9^(−1/d) − 1` so that `R(S,S)=0.9`; we use the FSRS-4.5 constants (`d=0.5`, `F=19/81`) with `S` = the Leitner interval of the card's level. FSRS-6 makes `d` trainable per user (default 0.1542) ([FSRS algorithm wiki](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm)); adopting it needs review logs, which `flashcard_reviewed` now captures.
* **Learner features** (`learner_features`): activity (active days 7/30, minutes, streak, days since active), performance (acc 7/30 d, last test, score trend), SRS (due, new, avg retrievability, max overdue), timing (top-2 active hours), habits (days since test/pronunciation/vocab), engagement (rec CTR/dismiss rate, resource completion), per-skill mastery view.

## 7. Recommender

### 7.1 Candidate generation (`engine/candidates.ts`)
| Source | Candidate | Signals |
| --- | --- | --- |
| SRS | one "review N due cards" block (≤ 20) | urgency = 0.6·due/20 + 0.4·risk(1−avgR) |
| Weak skills (≥3 attempts, mastery < 0.8) | `skill_drill:<skill>` | need = gap × exam-part weight × evidence |
| Thin evidence skills | drill with `explore_skill` reason | explore = 1−confidence |
| Resources | matched to weak skills via topic tags, interests, CEFR fit, popularity | need, interest, levelFit, popularity |
| Habits | mini test (≥21 d), pronunciation (≥7 d), vocab capture (≥7 d), **starter diagnostic** (no test ever) | habit staleness |

Content tagging: `labels.cefr/domain/topic` (already produced at ingest) interpreted by `engine/contentTags.ts`; skill→topic keywords table; learner CEFR from last TOEIC score via ETS bands (A2 225, B1 550, B2 785, C1 945) else self-reported level.

### 7.2 Ranker (`engine/ranker.ts`)
`score = Σ wᵢ·signalᵢ + boost − recencyPenalty − completedRecently`. Variants (weights): `control` (need .36, srs .28, interest .10, levelFit .08, habit .10, explore .05, popularity .03) and `srs_heavy` (srs .40, need .28 …). `popularity_only` exists for offline baselines only. Deterministic tie-break by id.

### 7.3 Cold start
No personalisation consent **or** no skill with ≥3 attempts ⇒ `mode: cold_start`: weights lean on interests/level/popularity; starter diagnostic pinned (`boost 0.5`); no skill drills; behavioural features ignored (own-deck due cards still used — it is the learner's service data).

### 7.4 Spaced repetition and review timing
Reviews prioritised by estimated retrievability and overdue time; Leitner fields untouched (`level_memory`, `nextReviewDate` remain the source of truth for scheduling) → **zero migration risk**. Phase 2: FSRS in shadow mode (compare predicted vs actual recall on logged reviews) then behind a flag, writing extra optional fields.
Study timing: `timing.bestHour` = most active hour from the last 30 days, else preferred study time.

### 7.5 Guardrails (`engine/guardrails.ts`)
**The inputs to the guardrails (what was shown/clicked/dismissed) live in a small functional store `recsys_exposure` that works WITHOUT analytics consent** (it is a service function — don't repeat yourself, honour "not interested" — tiny, 30-day TTL, erased with the user's data). Analytics events about the same interactions remain consent-gated.

Hard filters: dismissed (14 d), frequency cap (≥3 impressions/7 d without click), completed cooldown (resources 30 d, drills 1 d), CEFR gap > 1, `suitableForLearners=false`. Selection: ≤2 per type, ≤2 per skill, 1 flashcard block, diversity floor (≥2 distinct types when possible, top item never displaced), time budget (trim lowest ranks beyond 1.25× the learner's daily minutes, keep ≥3).

### 7.6 Explainability
Every item has a reason code, evidence params and EN + VI text from templates (`engine/explain.ts`): e.g. "Your accuracy on Part 5 · word form is about 45% over 20 questions — the biggest opportunity to gain points." No LLM.

### 7.7 Feedback loop
Impressions are written by the server when a list is generated (cache-miss only): always to the functional exposure store, and as a `rec_impression` analytics event when consented. Clients report `click/complete/dismiss` through `POST /recommendations/feedback` (updates the exposure store and emits the analytics event); the analytics events carry `variant` and `mode` (`personalized`/`cold_start`). These events feed: guardrails (exposure map), ranker (recency penalty), KPI read-outs, offline replay.

### 7.8 Experimentation
Deterministic bucketing `sha256(experimentKey:userId)` → variant; kill switch `RECSYS_FORCE_VARIANT`. Read-out: CTR/completion/dismiss per **variant × mode** + two-proportion z-test within the same mode (cold-start lists ignore the variant, so mixing modes would dilute any real effect to zero). **Pre-register** each test: primary metric, MDE, sample size, stop rule. Reference sample sizes (α=0.05, power 0.8): CTR 20%→22% ≈ 6.5k impressions/arm; D7 retention 25%→28% ≈ 3.3k users/arm. Guardrail metrics: dismiss rate, D1 retention, support contacts.

### 7.9 Offline evaluation (`eval/`)
* **Metrics:** P@k, recall@k, NDCG@k, MRR, catalogue coverage, list diversity.
* **Replay evaluator** joins logged impressions with outcomes per variant (note selection/position bias; consenting users only).
* **Simulator** (seeded): learners with hidden true abilities generate answers; the *real* mastery model builds estimates; rankers are scored against ground-truth need. `npm run recsys:eval` (500 learners, seed 42):

| Ranker | NDCG@5 | P@3 | Diversity | Coverage |
| --- | --- | --- | --- | --- |
| random drills | 0.458 | 0.689 | 0.20 | 0.88 |
| **control** | **0.588** | **0.925** | 0.76 | ≤1 |
| srs_heavy | 0.538 | 0.916 | 0.76 | ≤1 |

Reading: personalisation adds +0.13 NDCG@5 over random in simulation. NDCG is capped well below 1 *by design* — guardrails limit lists to 2 drills and force type diversity. **Synthetic ground truth: this validates the plumbing and relative ordering, not real-world lift.** Real validation = shadow period + replay + A/B.

## 8. Security & privacy

### 8.1 Vietnamese data-protection mapping
Law **91/2025/QH15** (Personal Data Protection Law, passed 26 Jun 2025) and **Decree 356/2025/ND-CP** (issued 31 Dec 2025) apply from **1 Jan 2026** (summary sources: [PPC](https://ppc.land/vietnam-implements-comprehensive-personal-data-decree-on-final-day-of-2025/), [EY legal alert](https://www.ey.com/en_vn/technical/tax/tax-and-law-updates/legal-alert-march-2026-decree-no-356-2025-nd-cp-providing-detailed-guidance-for-implementation-of-personal-data-protection-law)). **These are secondary sources; counsel must confirm against the official texts before launch.**

| Requirement (as summarised) | Design response |
| --- | --- |
| Consent must be verifiable, not pre-set, instructions clear | `recsys_consents` default off; `recsys_consent_ledger` append-only with policy version, purpose, timestamp, channel |
| Purpose limitation / granular purposes | 3 purposes: `analytics`, `personalization`, `research`; behavioural events need `analytics`; personalised ranking needs `personalization`; `research` reserved (no use yet) |
| Sensitive data (broadened to behavioural tracking, health, finance …) | Treat behavioural tracking conservatively (consent-gated); **no audio/biometric data in the event stream** — scores only; no free text |
| Data-subject rights: access 2 working days to respond / 10 d to execute; erasure 2 / 20; withdrawal 2 / 15 | `GET /privacy/export`, `DELETE /privacy/data`, `POST /privacy/consent/withdraw` execute immediately |
| Cross-border transfer impact assessment (ex-ante, MPS A05, 15-day review, 6-monthly updates) | Event store stays in the primary Mongo region; **open item:** Atlas region, Gemini (US), Azure Speech, Stripe flows must be inventoried and assessed |
| Breach: notify authority; for location/biometric 72 h to data subjects; keep records ≥ 5 years | Runbook in `06-operations.md` §5; audit via lineage + ledger |
| DPO / processing register | Owner assignment is organisational (open item) |
| Functional vs analytics data | Repetition guard (`recsys_exposure`) is service data with 30-day TTL and works without consent; every analytics event stays consent-gated |
| Minimisation & retention | Scores/ids only; TTL 400 d raw/clean; erasure removes derived data |

### 8.2 Threats and controls
| Threat | Control |
| --- | --- |
| Event spoofing / score tampering | `userId` only from JWT; client allow-list (behavioural types only); strict envelope; per-user rate limit (60 req/min) |
| Replay/duplicate flooding | idempotent `eventId`; batch ≤ 100; stale/future windows |
| Cross-user data access | every query scoped by `req.user.id`; erasure tested not to touch other users |
| Admin endpoints exposure | `hasAuthority(ADMIN)`; cohorts < 5 suppressed |
| PII leakage via analytics | aggregates only; no names/emails in events |
| Bad recommendations harming trust | guardrails, dismiss feedback, kill switch |

## 9. Code map

```
src/recsys/
  config.ts                      thresholds, flags
  events/    eventTypes · eventModel · eventService · emitters · aiUsageTracker
  privacy/   consentModel · consentService · dataSubjectService
  etl/       models · clean · aggregate · dataQuality · pipeline
  features/  skillTaxonomy · mastery · retention · featureModels · featureBuilder
  engine/    types · cefr · contentTags · candidates · ranker · guardrails · explain · experiments · recommender
  eval/      metrics · replay · simulator · cli
  analytics/ kpi · kpiService · healthService
  http/      routes · recsysController
  scheduler.ts
  stream/    pseudonym · wire · erasure · regions · kafkaConfig · producer · exporter      (Phase 3)
  warehouse/ schema · clickhouse · loader · erasure · consumer                              (Phase 3)
  featurestore/ registry · snapshotModel · store                                            (Phase 3)
  learning/  logreg · model · train · dataset · registry · retrain                          (Phase 3)
  embeddings/ provider · store · indexer · semantic                                         (Phase 3)
  analytics/sources.ts  (Mongo / ClickHouse KPI inputs)
  analytics/dbt/ (repo root) staging + marts, run via scripts/ops/run-dbt.sh
hooks in existing code (additive, fail-safe): testResultService · flashcardService · creditsService · speechController · googleGenAIClient · authMiddleware
```

API: `POST /events/batch` · `POST /recommendations/feedback` · `GET|PUT /privacy/consent` · `POST /privacy/consent/withdraw` · `GET /privacy/export` · `DELETE /privacy/data` · `GET /recommendations?limit=&refresh=` · `GET /admin/recsys/{kpis,experiments,pipeline,health}`.

**`skill_drill` action payload is a proposed contract.** `{screen:'skill_drill', skillKey, questions}` has **no backend route yet**: the `WeaknessDrill` model is commented out and the only drill route is `.../practice-drill/complete`, which marks an LLM-plan item done. Questions live embedded in test documents, so a drill endpoint (select questions by `skillKey` across tests) needs a product/UX decision (T1.25). Until then `skill_drill` items are a recommendation of *what* to practise, not a one-tap deep link; the other action types (`flashcard_review`, `resource`, test list, speech, vocab) map to existing screens.

**Integration with the existing daily plan (follow-up, ~2 days):** feed `GET /recommendations` items as an extra candidate source into `DailySessionService.buildSessionPlan` and let the ranker order `findAvailableResources`. Not done in this branch to avoid changing LLM-driven plan behaviour without an A/B.

> **Existing bug found (not fixed here):** `DailySessionService.findAvailableResources` filters `labels.domain` with `.toUpperCase()`, but the `Domain` enum and `Resource` schema are lower-case, so the domain filter likely matches nothing. The new code matches both casings.

## 10. Infrastructure decisions, options and triggers

> **Update:** none of the **P3** triggers below has fired. Phase 3 (§12) was nevertheless built ahead of its triggers at the owner's request. It is **dormant behind flags that default to off**, MongoDB remains the system of record, and nothing in §12 is required to run the product.

| Concern | MVP decision | Options considered | Why MVP choice | **Trigger to move** → Phase |
| --- | --- | --- | --- | --- |
| Event store | MongoDB regular collection | Mongo time-series; ClickHouse; BigQuery | No new system; ~10M events/month fits; erasure by `userId` is trivial | raw > ~200M rows or KPI queries > 1 s p95 or analytics load hurts API p95 → **ClickHouse (P3)** |
| Job runner | `node-cron` + Mongo lease | BullMQ + Redis; Temporal; cloud scheduler | Retries/locking solved without Redis at this scale | need delayed/retry per-job, fan-out > 1 worker, or > 3 job types → **BullMQ + Redis (P2)** |
| Stream | none (poll pending) | Kafka/Redpanda; Mongo change streams | Change streams need a replica set (dev compose is standalone) | > 500 events/s sustained or multiple consumers → **Redpanda (P3)** |
| Feature store | Mongo docs | Redis; Feast | Reads are 1 doc/user | p95 `/recommendations` DB time > 100 ms → Redis cache (P2) |
| Ranker | weighted, deterministic | LightGBM/bandit | Needs logged impressions | ≥ 100k impressions with outcomes → **learned re-ranker (P2)** |
| Experiments | in-house hash buckets | GrowthBook, Statsig | Free; 2–3 tests | > 3 concurrent tests or non-engineers running tests → GrowthBook (P2) |
| BI | admin JSON endpoints | Metabase/Grafana on ClickHouse | Enough for KPI review | stakeholders need self-serve → **P3** |
| SRS | Leitner + retrievability priority | FSRS (`ts-fsrs` 5.x, Node ≥ 20) | Zero schema risk | ≥ 30 d review logs → **FSRS shadow → flag (P2)** |

BullMQ production requirements (when adopted): Redis `maxmemory-policy=noeviction`, AOF persistence, worker connections with `maxRetriesPerRequest: null`, graceful shutdown on SIGTERM ([BullMQ production guide](https://docs.bullmq.io/guide/going-to-production)); job schedulers via `upsertJobScheduler` (idempotent per deploy).

**Migration path:** all stages sit behind narrow interfaces (`EventService.ingest`, `PipelineService.runOnce`, `RecDeps`, `FeatureBuilder`). P2: swap the scheduler for a BullMQ repeatable job calling the same `runOnce` (no logic change). P3: dual-write events to Redpanda → ClickHouse; point `kpiService` at ClickHouse; keep Mongo as system of record for serving features.

## 11. Cost model
* **Incremental runtime infra (MVP): none.** Storage only (§3 sizing: bytes/event × events/month × retention). Price storage at your Atlas tier's $/GB — not quoted here because I could not verify current vendor prices.
* **AI cost:** the recommender adds **0 LLM calls**. Per-learner LLM cost is now *measured* (`ai_usage`), enabling a margin guardrail (target: AI cost ≤ 3% of ARPU — to validate).
* **Compute:** ≈ 6 ms CPU per recommendation (plain Node, 300 candidates; ≈ 14 ms p50 under Jest instrumentation) + a few indexed reads; ETL ≈ 700 events/s on the dev VM (measured, in-memory DB).
* **Phase 2 adds:** one small managed Redis (BullMQ) and CI minutes; **Phase 3 adds:** ClickHouse + Redpanda (managed or 2–3 VMs) — size from observed event volume at that time.

## 12. Phase 3 (Scale) — built ahead of triggers, dormant behind flags

### 12.1 What exists, and how it was verified
Legend: **Live** = exercised against a real server in Docker (opt-in tests in `__tests__/live`, skipped by default). **Tests** = automated tests against in-memory MongoDB / fakes only. **Design** = documented, not built.

| Piece | Code | Verification |
| --- | --- | --- |
| Stream exporter (Mongo silver → Kafka-protocol topic) | `src/recsys/stream/` | **Live** (Redpanda v25.2.1, client `@confluentinc/kafka-javascript` 1.11.0) + Tests |
| ClickHouse sink + loader + erase propagation | `src/recsys/warehouse/` | **Live** (ClickHouse 25.8.33.6, `@clickhouse/client` 1.25.0) + Tests |
| dbt project (staging view + `learner_daily_facts` mart + tests; the mart mirrors only the KPI-relevant subset of `aggregateDay`) | `analytics/dbt/` | **Live**: `dbt build` 12/12 pass (dbt-core 1.12.6, dbt-clickhouse 1.10.3, in a pinned container) |
| KPI backend switch (Mongo ⇄ ClickHouse) | `analytics/sources.ts`, `kpiService.ts` | **Live parity test**: identical overview + experiment read-outs on the same events; Tests for fallback |
| Feature store (registry, point-in-time snapshots) | `src/recsys/featurestore/` | Tests (incl. no-future-leakage) |
| Learned ranker + retraining + registry + challenger layer + harm guard | `src/recsys/learning/` | Tests on **synthetic** rows only — never run on production data (none exists yet) |
| Content embeddings (indexer, store, semantic signal) | `src/recsys/embeddings/` | Tests with the **lexical-hash provider only**. The Gemini provider path was **never executed** (no API key in the dev environment) |
| Data residency — code level | `stream/regions.ts` | Tests |
| Kafka TLS/SASL settings (incl. private CA) | `stream/kafkaConfig.ts` | **Live** against a secured Redpanda (SASL/SCRAM-SHA-256 over TLS, private CA): works; wrong password, plaintext client and untrusted CA are refused. ClickHouse over HTTPS **not** tested |
| Health report: exporter backlog/errors, pending warehouse erasures, live model | `analytics/healthService.ts` | Tests |

### 12.2 Data flow
```
Mongo bronze → silver (existing ETL) ──► StreamExporter (cron 1 min, lease, cursor on silver _id)
   consent + tombstone gate, region lookup, HMAC pseudonym ──► topic  echo.learning_events.v1.<region>  (bounded retention)
                                                                    │
                         WarehouseLoader  (own process: npm run recsys:loader, one per region)
        parse → drop invalid / foreign-region / erased → insert (ReplacingMergeTree on event_id)
                                                                    ▼
                         ClickHouse  events ──dbt──► stg_events (view) ──► learner_daily_facts (mart)
                                                                    ▼
                         KpiService (RECSYS_ANALYTICS_BACKEND=clickhouse; falls back to Mongo, reporting why)
```
Delivery is **at-least-once end to end**: the exporter advances its cursor only after the broker acknowledges; the loader commits offsets only after the insert; duplicates collapse on `event_id`. Nothing in this chain sits on a request path, and a broker or warehouse outage cannot affect the API (the cursor simply waits).

### 12.3 Privacy controls on the new copies of data (the part most likely to go wrong)
* **Pseudonymised, not anonymous.** The wire format never carries the raw user id; `u = HMAC-SHA256(secret, "<region>:<userId>")[:32]`. Exports **fail closed** unless `RECSYS_PSEUDONYM_SALT` is a real secret (≥ 16 chars, not a known placeholder). The pseudonym is region-scoped so records cannot be joined across residency regions. Props may still contain personal data; treat the warehouse as personal data.
* **Consent at export time.** Behavioural events are exported only while analytics consent is currently granted (withdrawal stops future exports; already-exported history is removed only by erasure — counsel to confirm that this satisfies withdrawal).
* **Erasure reaches every copy.** `DELETE /privacy/data` (1) writes **tombstones** for the user's pseudonym in **every** known region (a learner who moved regions is covered), (2) deletes from Mongo, (3) runs a synchronous ClickHouse `DELETE`. The response reports `downstream.warehouse = deleted | failed | not_enabled` truthfully.
* **Race with in-flight data.** Kafka cannot delete a single record and a loader may be mid-batch when an erase runs. Both exporter and loader refuse any event that occurred at or before the tombstone; the loader's periodic sweep re-applies the delete for tombstones younger than 1 h **and for any whose delete failed** (`warehousePending`), so a warehouse outage during an erase self-heals. Tombstones carry only pseudonyms and have **no TTL** (expiring them would let later service events of an erased user flow again without fresh consent). After erasure, new events are exported only if the user grants analytics consent again.
* **Topic retention is bounded** (`RECSYS_STREAM_RETENTION_HOURS`, default 168 h, set when the topic is created — verified on a real broker: `retention.ms = 604800000`). Existing topics are left as they are; Kafka cannot honour per-record deletion, which is why tombstones exist.
* **Operational assumption: `_id` cursors need sane clocks.** The mastery updater and the stream exporter resume from the silver `_id` (insertion order). ObjectIds are monotonic within one process and across instances whose clocks agree to within the pipeline tick (2 min); a backwards clock step could make a later-inserted row sort before the cursor and be skipped. Run NTP on every instance. A mastery test that relies on wall-clock ordering failed twice in roughly a dozen 2-worker runs on the dev VM and never in 40 isolated repetitions; the cause was **not** established (a clock step is a hypothesis, not a finding), and the test now sets an explicit later `_id` so it no longer depends on it.
* **Feature snapshots and region tags are included in export and erase.** Embeddings describe *content*, not people, so there is nothing to erase.
* **Transport.** Dev overlay is plaintext. A real broker needs TLS + SASL (`RECSYS_STREAM_TLS`, `RECSYS_STREAM_SASL_*`, and `RECSYS_STREAM_TLS_CA_FILE` for a private CA — passed to the client as `ssl.ca.location`, because the Confluent client accepts only a boolean `ssl` inside its `kafkaJS` block). **Verified live** against a secured Redpanda (SASL/SCRAM-SHA-256 over TLS, self-signed CA); a wrong password, a plaintext client and an untrusted CA were each refused. ClickHouse over HTTPS (URL `https://…`) was **not** tested.

### 12.4 Feature store
In-house, deliberately small. `featurestore/registry.ts` lists the flat learner features (15, versioned). `featureBuilder.build()` appends an immutable snapshot to `learner_feature_snapshots` when `RECSYS_FEATURE_SNAPSHOTS=true`, at most once per hour per learner (TTL 120 d). `getHistoricalFeatures([{userId, t}])` returns, per row, the newest snapshot with `asOf ≤ t` and not older than 72 h — **never a later one** (tested with snapshots on both sides of the timestamp). The online store stays `learner_features`. Feast was rejected: one table and one join do not justify another system.

### 12.5 Learned ranker and automated retraining
```
rec_impression{signals, position, recId}  +  rec_click  ──join (recId,itemRef)──►  labelled rows
                         │ as-of join to feature snapshots → learner segment (new / established)
                         ▼
 trainRanker: user-level 80/20 split → IRLS logistic regression (signals + position)
   gates: ≥ minRows impressions, ≥ minPositives clicks, holdout ≥ 50 clicks, AUC lift over control ≥ minAucLift
   per-segment weights adopted only if they beat the global weights on that segment's holdout
                         ▼
 weights → existing WeightSet (negative → 0, normalised to 1; position coefficient DROPPED)
                         ▼
 rec_models registry:  rejected | candidate → active(≤5% auto) → retired
```
* **No engine change.** A model is just a `WeightSet`, so the ranker, guardrails and explanations are untouched; offline eval output is byte-identical to the pre-Phase-3 baseline (checked after every engine commit).
* **Position bias.** Position is a *training covariate* (so a signal that merely correlates with top slots is not credited — tested with collinear data) and is not part of serving weights. Logged impressions only contain items that were *shown*, so offline lift is a pointwise (AUC) estimate under selection bias; the online experiment is the real test.
* **Serving.** A separate hash layer (`rec_learned_layer_v1`) routes `allocationPct`% of users to `variant=learned`; everyone else keeps their original `control`/`srs_heavy` assignment (tested: no reshuffling). Auto-activation is hard-capped at **5 %**; only an admin may raise it, to at most **50 %**. The registry read is cached (60 s) and any failure degrades to the default path. `RECSYS_FORCE_VARIANT` overrides everything.
* **Safety rails.** Models trained on synthetic data are `rejected` and cannot be activated even by an admin. A new model replaces the live one only if its lift is higher. A daily guard auto-**retires** the live model if its personalised-mode CTR is significantly worse than control (z ≤ −1.96 with ≥ 1000 impressions). Automatic actions can shrink exposure; only a human can grow it.
* **Runs inside the API process, so it is cooperative.** Training (weekly cron and `POST /admin/recsys/models/retrain`) yields to the event loop between small chunks, and uses the newest 200 000 impressions at most. Measured on the 2.9 GB dev VM: 100 000 rows ≈ 2.6 s total with a longest event-loop stall ≈ 0.5 s (includes JIT warm-up); 200 000 rows ≈ 3.6 s, longest stall ≈ 0.2 s. Before this was done, 500 000 rows blocked the loop for ≈ 15 s (found by measuring, not by design). If volume ever outgrows this, move training to its own process like the loader. The snapshot join is time-bounded (`asOf ∈ [min t − 72 h, max t]`).
* **The model registry cache is 60 s and is never touched by background jobs** (`fetchActive()` is the uncached read used by retrain/guard) — a bug in the first version passed a far-future `now` to bypass the cache, which also stored a far-future expiry; it was found in review and is covered by a regression test. With several instances, a retire or allocation change is therefore visible everywhere within ~60 s.
* **Not validated.** All thresholds (`RECSYS_RETRAIN_MIN_*`, 5 % challenger) are judgement calls. The trainer has only ever seen synthetic rows. Expect to retune once real impressions exist.

### 12.6 Content embeddings
Offline only (`npm run recsys:embed`): resources are embedded from title + summary + trusted labels; unchanged content is skipped by hash (provider name is part of the hash), a per-run cap bounds cost, and cost is reported per run (job-level; no learner is involved, so it is not an `ai_usage` event). The model name is read from `GENAI_EMBEDDING_MODEL` (default `gemini-embedding-001`) — the same setting the document-analysis service already uses. Serving: a learner's recently *completed* resources form a centroid; each candidate resource gets `signals.semantic` = cosine similarity, and a resource at or above `RECSYS_SEMANTIC_MIN` can qualify on similarity alone with the reason `similar_to_completed`. `semantic` has weight **0 in every shipped variant**, so the signal changes nothing until a learned model assigns it weight. **`RECSYS_SEMANTIC_MIN=0.75` is uncalibrated and model-specific** (the lexical-hash baseline scores genuinely related texts around 0.57); recalibrate on the real catalogue whenever the model changes.

### 12.7 Data residency — scope boundary
**Built (code):** a persisted per-learner region tag (`learner_regions`, validated against `RECSYS_REGIONS`; unknown/stale tags fall back to the default region so data is never routed to a sink that is no longer configured), region-keyed topic / consumer group / pseudonym scope, and a loader that **refuses messages tagged for another region**. Admin endpoint: `PUT /admin/recsys/learners/:userId/region`.
**Not built (infrastructure, design only):** separate MongoDB clusters per region, regional API deployments and traffic routing, per-region ClickHouse clusters (a regional deployment points its loader at its own ClickHouse via env), DNS, Terraform. Changing a learner's region affects *future* exports only; history is not migrated (erase covers all regions). No new learners get a region automatically — assignment at signup needs a product/legal decision.

### 12.8 Sizing and cost
**Measured on the 2.9 GB / 2-vCPU dev VM** with Redpanda, ClickHouse, MongoDB and Node all sharing it (`npm run recsys:bench -- 150000 5000`, real services; **this is not production capacity**):

| Measure | Result |
| --- | --- |
| Exporter (Mongo silver → Redpanda) | ≈ 3 800 events/s |
| Exporter + loader end to end (Redpanda → ClickHouse) | ≈ 930 events/s; the loader is the slower stage (≈ 1 200/s once the exporter is done) |
| Expected load (10M events/month, `README` §4) | ≈ 4 events/s average → roughly two orders of magnitude of headroom on this VM; peaks and concurrency were **not** modelled |
| ClickHouse storage | 84 B/event compressed (2.16× vs uncompressed); `props` is a JSON string, so a typed-column design would compress better |
| MongoDB silver storage in the same run | 232 B/event incl. indexes (earlier §3 measurement: 462 B with larger props — the figure depends on the props mix) |

Not measured: ClickHouse query latency at scale, consumer-group rebalances, multi-partition ordering under failure, sustained multi-hour runs, network latency to managed services. One known cost in the exporter: consent is looked up per distinct user per batch (cached 60 s) — fine at this size, batch it before it becomes the bottleneck at much higher user counts.
Dev overlay limits (Redpanda 900 MB, ClickHouse 1.2 GB) were verified on the 2.9 GB VM (with both running, ~1.5 GB of the 2.9 GB was still available). Production sizing: managed Redpanda/ClickHouse or 2–3 VMs from observed event rate — **not decided**; no vendor prices are quoted because none were verified.
