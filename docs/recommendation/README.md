# EchoEnglish Recommendation Platform — Overview & Recommendation

> Status: MVP slice implemented on branch `feat/recommendation-platform`. Everything marked **[Phase 2]** / **[Phase 3]** is design only.
> Date: 2026-11-09 · Owner decisions: delegated to engineering (all decisions below were made by the engineering lead and are open to challenge).

## 1. Business case in one page

**Problem.** EchoEnglish already has strong point features (pronunciation scoring, vocabulary capture, TOEIC tests, roadmap + daily session). But _what to do next_ is decided by an LLM-generated weekly roadmap that does not learn from what the learner actually does day to day. Flashcards use a fixed Leitner ladder, resources are matched by label keywords, and no behavioural signal (dwell time, skips, review latency) is collected. Result: learners can stall without the app noticing, and we cannot measure what drives score gain or retention.

**Goal.** Make learning behaviour a compounding advantage: every answer, review, read and speech attempt improves the next recommendation → faster TOEIC score gain → longer retention → more credit purchases at a controlled AI cost.

**Recommendation (what we build).** A _closed-loop_ system, MVP on the current Node.js + MongoDB stack with **no new runtime infrastructure**:

```
 app actions ─► Event contract ─► Raw (bronze) ─► Clean (silver) ─► Daily facts + Features (gold)
                  (zod, consent,    TTL+erasure     validate/dedupe     mastery, forgetting, streak
                   idempotent)                                              │
        ▲                                                                   ▼
        └── impressions/clicks/completions ◄── Explainable recommendations ◄─ candidates → ranker → guardrails
                                                   (A/B variants, cold start, no LLM on request path)
 KPI endpoints (activation, retention, study time, score gain, credit spend, AI cost/learner) read the same facts.
```

**Why this and not "just add Kafka + a warehouse now".** At the current scale (assumed ≤ 10k MAU, see §4) the whole event volume is ~10M rows/month — comfortably inside MongoDB. New infrastructure is introduced only when a measurable trigger fires (see `03-architecture.md` §7). Infra we add in MVP: **none at runtime**; we add CI, immutable image tags (rollback), a monitoring compose overlay and a k6 load test.

**Expected outcomes (hypotheses to validate, not promises).**

| KPI | Baseline | 90-day target | How measured |
| --- | --- | --- | --- |
| Activation (first learning action ≤ 7d after signup) | unknown — instrument first | +10 pp vs. baseline | `kpiService.activation` |
| D7 retention | unknown — instrument first | +5 pp | cohort retention |
| Weekly study minutes / active learner | unknown | +15% | daily facts |
| Recommendation acceptance (click-through of top-3) | n/a | ≥ 25% | `rec_click / rec_impression` |
| Score gain per 8 weeks (median, learners with ≥2 tests) | unknown | +30 TOEIC pts | score history |
| AI cost per active learner / month | unknown | ≤ 3% of ARPU | `ai_usage` events |

First two weeks of production are **measurement only** (baselines); targets are re-set after that.

## 2. Key decisions (with reasons)

| # | Decision | Reason | Alternative rejected (for now) |
| --- | --- | --- | --- |
| D1 | MVP stays on MongoDB; raw events go in a **regular collection** (unique `eventId` index for idempotency, `userId` index for export/erasure, TTL on `receivedAt` for retention) — **not** a time-series collection | Per the current MongoDB manual, time-series collections do not support unique indexes, only allow updates that match/modify the `metaField`, cannot be written in transactions, and have no change streams ([limitations](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-limitations/)). We need idempotent inserts and an in-place `processing` status, so they do not fit | Time-series collection; ClickHouse now |
| D2 | Pipeline = in-process micro-batch worker with a **Mongo lease + watermark** (multi-instance safe, retryable, idempotent) | Gives retries and no duplicate runs without Redis | BullMQ now; Kafka |
| D3 | Recommender = deterministic hybrid (mastery model + forgetting-curve + content tags + weighted ranker), **no LLM call per request**, template explanations | Gemini free-tier quotas in `.env.example` are ≤ 30 RPM / 20 RPD for some models; latency and cost must be flat | LLM re-ranking; learned ranker (needs data first) |
| D4 | SRS: keep Leitner fields working; prioritise reviews by **estimated retrievability** (power-law forgetting curve calibrated to Leitner intervals). **[Phase 2]** FSRS via `ts-fsrs` after ≥ 30 days of review logs are collected (`flashcard_reviewed` carries `prevLevel/newLevel/latency`) | FSRS needs review history to fit; no schema break now | Big-bang FSRS migration |
| D5 | Experiments = in-house deterministic hash bucketing (`sha256(experiment:user)`), logged on every impression | Zero infra; reproducible; enough for 2–3 concurrent tests at our scale | GrowthBook/Statsig **[Phase 2]** |
| D6 | Privacy: consent ledger with 3 purposes (`analytics`, `personalization`, `research`), **default off**, versioned, withdrawable; service-necessary events vs behavioural events separated; export + erasure endpoints | Vietnam PDPL (Law 91/2025/QH15) and Decree 356/2025 apply from 1 Jan 2026; consent must not be pre-set and must be provable ([EY legal alert](https://www.ey.com/en_vn/technical/tax/tax-and-law-updates/legal-alert-march-2026-decree-no-356-2025-nd-cp-providing-detailed-guidance-for-implementation-of-personal-data-protection-law)) | One bundled consent |
| D7 | **Audio is never put in the event stream** — only scores | Voice is high-risk personal data; keeps blast radius small | Storing audio features centrally |

## 3. What is implemented vs. designed

| Area | MVP (code + tests in this branch) | Phase 2 / 3 (design only) |
| --- | --- | --- |
| Data gathering | Event contract v1 (zod), idempotent ingest, consent gate, batched client endpoint, server emit points (test submit, flashcard review, credits, speech, resource view) | Mobile SDK batching/offline queue |
| ETL | bronze→silver→gold, DQ checks, lineage, lease/watermark, scheduler | BullMQ+Redis (P2), Redpanda + ClickHouse + dbt (P3) |
| Recommender | Mastery (Elo-style), forgetting-curve, candidates, ranker, guardrails, cold start, explanations, feedback loop, A/B, offline replay eval | Learned ranker/bandit (P2), FSRS (P2), embeddings for content (P3) |
| Analytics | KPI service + admin endpoints | Metabase/Grafana dashboards on ClickHouse (P3) |
| Infra | CI, SHA-tagged deploy + rollback script, monitoring compose overlay, k6 test | Terraform, managed Redis, ClickHouse Cloud (P2/P3) |

**Not done / needs real users or legal sign-off** — see §4 and `06-operations.md`.

## 4. Assumptions to validate

1. Scale: ≤ 10k MAU, ≤ 60 events per active learner-day. _Validate with current MAU in the first week of instrumentation._
2. Content catalogue: resources carry `labels.{cefr,domain,topic}` (already true); `QuestionMetadata` exists for tests used by drills. _Validate coverage ≥ 90% of served questions._
3. The mobile/web clients can call `POST /events/batch` and show the consent UI. _Needs front-end work (not in this repo)._
4. Legal: voice recordings and behavioural tracking are treated conservatively as sensitive; cross-border transfers (Gemini, Azure Speech, Atlas region, Stripe) need a Transfer Impact Assessment filing. **Legal counsel must confirm** — secondary sources I could verify disagree on minor details (e.g. whether biometrics are listed as sensitive in the decree itself).
5. Explanations in Vietnamese vs English: templates ship in English + Vietnamese keys; copy must be reviewed by a native speaker.

## 5. Document map

| File | SDLC phase |
| --- | --- |
| `01-requirements.md` | Business & requirements analysis |
| `02-plan.md`, `TASKS.md` | Planning (roadmap, estimates, risks) |
| `03-architecture.md` | Architecture, data model, pipeline, recommender, security/privacy, cost, infra options |
| `04-testing.md` | Test strategy, pass/fail criteria |
| `05-deployment.md` | Environments, CI/CD, rollout/rollback |
| `06-operations.md` | Monitoring, alerting, cost tracking, incident handling, KPI iteration |

Code lives in `src/recsys/` (see the code map in `03-architecture.md` §9). Run `npm run recsys:eval` for the offline evaluation report; `npx jest __tests__/unit/recsys __tests__/integration` for the platform test suites.
