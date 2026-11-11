# 01 · Business & Requirements Analysis

## 1. Users and pain points

| Persona | Context | Pain today | What they need |
| --- | --- | --- | --- |
| **Linh – working professional** (TOEIC 600→750 for a promotion) | 15–30 min/day, mobile, evenings | Does not know what to practise first; roadmap is weekly and static; forgets vocabulary | "Tell me the 3 things to do in my 20 minutes tonight, and why" |
| **Nam – university student** (needs 550 to graduate) | Bursts of study before exam dates; low budget | Wastes credits on analyses that do not change what he studies | Cheap, targeted drills on his weakest parts; clear progress |
| **Hà – returning learner** | Dropped off 3 weeks ago | Large flashcard backlog is demotivating | A gentle restart: a short, high-value review first |
| **Product analyst** | Owns activation/retention | Cannot see which learning behaviour predicts score gain or renewal | Trusted KPIs, cohorts, experiment read-outs |
| **Content/ops admin** | Curates resources | No feedback on which resources help | Per-resource engagement, tagging quality signals |
| **Data-protection owner** | Accountable under PDPL | No consent ledger, export or erasure for behavioural data | Provable consent, working data-subject rights |

**Business pain:** retention and credit purchases depend on visible progress, but nothing closes the loop from *what the learner did* to *what they should do next*, and AI cost per learner is unmeasured.

## 2. Epics and user stories (with acceptance criteria)

Priority: **M**ust (MVP) · **S**hould (Phase 2) · **C**ould (Phase 3).

| ID | Story | Acceptance criteria (testable) | Pri | Implemented / test |
| --- | --- | --- | --- | --- |
| US-1 | As a learner I see "what to study next" with a reason | `GET /recommendations` returns ≤ `limit` unique items, each with type, minutes, deep-link `action`, and an EN+VI reason citing evidence (e.g. accuracy %, n) | M | `engine.unit`, `http.int` |
| US-2 | As a learner I am never shown the same thing repeatedly | An item shown ≥3×/7d with no click is suppressed; dismissed items hidden 14 d; completed resources hidden 30 d | M | `engine.unit` (guardrails), `http.int` (anti-repetition loop) |
| US-3 | As a learner my due flashcards are prioritised by forgetting risk | SRS candidate scored from due-count and avg retrievability; first card block capped at 20 / 1 block per list | M | `features.unit`, `engine.unit` |
| US-4 | As a new learner (no data) I still get sensible suggestions | Cold start: starter diagnostic pinned first; resources by interest/level/popularity; no skill drills | M | `engine.unit`, `http.int` |
| US-5 | As a learner I control my data | Consent defaults to **off**; per-purpose opt-in/out; export and erase endpoints; erase removes events, facts, mastery, features and withdraws consent | M | `http.int` |
| US-6 | As a learner without personalisation consent I still get a working app | Behavioural features ignored; only own-deck due cards, starter test and resources are used | M | `engine.unit` |
| US-7 | As the system I must not lose or double-count signals | Same `eventId` ingested twice ⇒ one row; replaying ETL ⇒ identical facts; late events recompute the day | M | `eventIngest.int`, `pipeline.int` |
| US-8 | As an analyst I see activation, retention, study time, score gain, credit spend, AI cost/learner | `GET /admin/recsys/kpis` returns the KPIs with cohort sizes; cohorts < 5 suppressed | M | `kpi.unit`, `http.int` |
| US-9 | As an analyst I can compare ranking variants | Variant assigned by stable hash; every impression/click/dismiss carries `variant`; read-out gives CTR with z-test | M | `engine.unit`, `kpi.unit`, `eventTypes.unit` |
| US-10 | As ops I know when the pipeline is unhealthy | Health endpoint/probe reports `ok/degraded/down` with reasons; DQ checks on every run | M | `health.int`, `etl.unit` |
| US-11 | As finance I see AI cost per learner | Every LLM completion by an authenticated learner produces `ai_usage` (tokens + cost from configured rates) | M | `aiUsage.unit` |
| US-12 | As a learner I see "best time to study" | Response includes `timing.bestHour` from my most active hours (or my preference) | S→done | `engine.unit` |
| US-13 | Flashcard scheduling adapts to me (FSRS) | Review logs captured; shadow-mode FSRS vs Leitner comparison; switch behind flag | S | Phase 2 |
| US-14 | Ranking learns from outcomes | Learned re-ranker/bandit beats `control` in an A/B by pre-registered margin | S | Phase 2 |
| US-15 | Warehouse-grade analytics | Dashboards on ClickHouse/BI without loading the app DB | C | Phase 3 |

## 3. Non-functional requirements

| Area | Requirement | Measure |
| --- | --- | --- |
| Latency | Recommendation compute adds ≤ 25 ms p95 server-side (pure compute, 300 candidates); endpoint p95 ≤ 300 ms | `performance.int` (P1), k6 thresholds |
| Reliability | Emitting a signal can never fail a learner action | `emit()` contract tested; no-op when disabled |
| Freshness | New events reflected in features within 5 min (tick every 2 min) | health: `freshness_lag_minutes ≤ 30` alert |
| Correctness | Idempotent ingest and ETL; no double counting | integration tests |
| Privacy | Consent, minimisation, erasure ≤ 20 days SLA (executed immediately) | `http.int` |
| Cost | No LLM call on the recommendation path; AI cost per learner measured | design + `ai_usage` |
| Operability | One flag disables everything (`RECSYS_ENABLED=false`) | deploy docs |

## 4. KPIs (definitions)

| KPI | Definition | Source |
| --- | --- | --- |
| Activation (7d) | % of signups (matured ≥7 d) with ≥1 learning action within 7 days | `kpi.activationRate` |
| Retention D1/D7/D30 | % of matured signups active exactly N days after signup | `kpi.dayNRetention` |
| DAU/WAU/MAU, stickiness | Active = ≥1 learning action; stickiness = DAU/MAU | `kpi.activeUserCounts` |
| Study time | Mean/median minutes per active learner per week (test time counted once; app-open time excluded) | `aggregateDay` rule |
| Score gain | Latest − earliest TOEIC score in 8 weeks, learners with ≥2 tests (suppressed if < 5) | `kpi.scoreGain` |
| Credit spend | Credits/active learner, spender rate, payer conversion | `kpi.unitEconomics` |
| AI cost per learner | Σ `ai_usage.costUsd` / active learners; share of revenue | `kpi.unitEconomics` |
| Rec acceptance | `rec_click / rec_impression` (consenting users) | `kpi.experimentReadout` |

Targets and baselines: see `README.md` §1 (first two weeks are measurement only).

## 5. Out of scope (MVP)
Push-notification timing delivery (we expose `timing.bestHour`; sending is a follow-up), LLM-generated explanations, group/classroom features, offline-first mobile SDK, multi-language beyond EN/VI.

## 6. To validate with real users
1. Do the reason strings (EN/VI) change behaviour? (A/B: with vs. without reason.) 2. Consent opt-in rate and wording. 3. Is "20 due cards" too many for returning learners (Hà)? 4. Are 5 items too many for a 15-minute session? 5. Do learners understand "Part 5 · word form"-style labels?
