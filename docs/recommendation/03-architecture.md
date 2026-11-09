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
hooks in existing code (additive, fail-safe): testResultService · flashcardService · creditsService · speechController · googleGenAIClient · authMiddleware
```

API: `POST /events/batch` · `POST /recommendations/feedback` · `GET|PUT /privacy/consent` · `POST /privacy/consent/withdraw` · `GET /privacy/export` · `DELETE /privacy/data` · `GET /recommendations?limit=&refresh=` · `GET /admin/recsys/{kpis,experiments,pipeline,health}`.

**`skill_drill` action payload is a proposed contract.** `{screen:'skill_drill', skillKey, questions}` has **no backend route yet**: the `WeaknessDrill` model is commented out and the only drill route is `.../practice-drill/complete`, which marks an LLM-plan item done. Questions live embedded in test documents, so a drill endpoint (select questions by `skillKey` across tests) needs a product/UX decision (T1.25). Until then `skill_drill` items are a recommendation of *what* to practise, not a one-tap deep link; the other action types (`flashcard_review`, `resource`, test list, speech, vocab) map to existing screens.

**Integration with the existing daily plan (follow-up, ~2 days):** feed `GET /recommendations` items as an extra candidate source into `DailySessionService.buildSessionPlan` and let the ranker order `findAvailableResources`. Not done in this branch to avoid changing LLM-driven plan behaviour without an A/B.

> **Existing bug found (not fixed here):** `DailySessionService.findAvailableResources` filters `labels.domain` with `.toUpperCase()`, but the `Domain` enum and `Resource` schema are lower-case, so the domain filter likely matches nothing. The new code matches both casings.

## 10. Infrastructure decisions, options and triggers

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
