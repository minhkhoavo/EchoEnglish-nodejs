# Task list & status

Legend: ✅ done in this branch (code + tests) · 📝 documented only · ⏭ later phase. Estimates are ideal engineer-days for one engineer.

## Phase 0 — Foundations (MVP week 1)
| ID | Task | Est | Status |
| --- | --- | --- | --- |
| T0.1 | Business overview, decisions, assumptions | 1 | ✅ |
| T0.2 | Requirements, user stories, acceptance criteria | 1 | ✅ |
| T0.3 | Event contract v1 (zod) + `LearningEvent` model (idempotent) | 1 | ✅ |
| T0.4 | Consent model + ledger + API; export/erase API | 2 | ✅ |

## Phase 1 — MVP slice: events → ETL → features → recommender → API (weeks 2–5)
| ID | Task | Est | Status |
| --- | --- | --- | --- |
| T1.1 | Emit points: test submit, flashcard review, credits, speech, resource view | 2 | ✅ |
| T1.2 | Batched client ingest endpoint (`/events/batch`) with allow-list + rate limit | 1 | ✅ |
| T1.3 | ETL: clean (validate/normalise/dedupe), daily facts, DQ checks, lineage, lease | 4 | ✅ |
| T1.4 | Feature layer: mastery (Elo), forgetting-curve, streak, best-hour | 3 | ✅ |
| T1.5 | Content tagging + candidate generators | 3 | ✅ |
| T1.6 | Ranker + guardrails + cold start + explanations | 3 | ✅ |
| T1.7 | Feedback loop (impression/click/complete/dismiss) + A/B bucketing | 2 | ✅ |
| T1.8 | Offline replay evaluation (P@k, NDCG, coverage, diversity) + simulator | 2 | ✅ |
| T1.9 | KPI service + admin endpoints | 3 | ✅ |
| T1.10 | Scheduler wiring behind `RECSYS_ENABLED` | 1 | ✅ |

## Phase 1b — Quality, delivery, operations
| ID | Task | Est | Status |
| --- | --- | --- | --- |
| T1.11 | Unit + integration + data-quality + perf tests | 4 | ✅ |
| T1.12 | CI workflow (lint/test/typecheck-new-files), SHA-tagged deploy, rollback script | 2 | ✅ |
| T1.13 | Health service + probe script + alert rules + k6 load test (compose overlay dropped: no runtime infra in MVP) | 2 | ✅ (k6 written, **not executed** here) |
| T1.14 | Docs: architecture, testing, deployment, operations | 3 | ✅ |

## Phase 1c — Follow-ups discovered during the build (not yet done)
| ID | Task | Est | Status |
| --- | --- | --- | --- |
| T1.15 | Feed `/recommendations` into `DailySessionService.buildSessionPlan` as a candidate source (behind A/B) | 2 | ⏭ |
| T1.16 | Front-end (other repo): consent screen, `/events/batch` for dwell/session/rec feedback, render recommendations | 5 | ⏭ |
| T1.17 | Seed historical `question_answered` from existing `testresults` (backfill script) | 2 | ⏭ |
| T1.18 | Tag top-5 LLM call sites with `runWithFeature()` for per-feature AI cost | 1 | ⏭ |
| T1.19 | Regenerate `package-lock.json` (`npm ci` currently fails: `@types/express-rate-limit` missing) | 0.5 | ⏭ |
| T1.20 | Fix `findAvailableResources` upper/lower-case `labels.domain` mismatch | 0.25 | ⏭ |
| T1.21 | Fix 53 pre-existing `tsc` errors in `src/controllers/*` (`req.params` is `string \| string[]`) | 1 | ⏭ |
| T1.22 | Make `ci.yml` a required check and gate `deploy.yaml` on it once the full suite is verified green | 0.5 | ⏭ |
| T1.23 | Legal: confirm PDPL/Decree 356 mapping, cross-border assessment, consent copy, ledger retention | external | ⏭ |
| T1.25 | **Drill endpoint** for `skill_drill` deep links: select questions by `skillKey` across tests (+ UX decision on drill format) — the recommendation action has no backend today | 4 | ⏭ **(blocking for one-tap drills)** |
| T1.26 | Consent UI is a prerequisite for personalisation: until it ships every learner gets cold-start lists (A/B variants have no effect in cold start) | (in T1.16) | ⏭ |
| T1.24 | Staging environment + run k6 + tune thresholds | 2 | ⏭ |

## Phase 2 — Growth (months 2–4) ⏭
BullMQ + Redis for pipeline jobs · FSRS via `ts-fsrs` (shadow mode first) · learned ranker / contextual bandit · GrowthBook · Terraform · front-end consent UI · weekly KPI review ritual.
Triggers: see `03-architecture.md` §10.

## Phase 3 — Scale: ✅ built and verified as far as this environment allows; what remains needs real inputs (Gemini key + catalogue, production data, a second region)
> **Status of intent.** None of the §10 triggers in `03-architecture.md` has fired (no volume, no stakeholder BI need, no ≥100k labelled impressions). Phase 3 is therefore **built ahead of triggers at the owner's request and stays dormant behind flags that default to off**. MongoDB remains the system of record; `deploy.yaml` and the production compose are untouched; Redpanda/ClickHouse live in a separate opt-in compose overlay with pinned tags. **Phase 2 (BullMQ, FSRS, GrowthBook, Terraform) is still open** — Phase 3 only pulls forward the minimum trainable model that retraining needs.

Legend: **Verified live** = exercised against a real server in Docker (opt-in tests, skipped by default). **Built** = code + automated tests (in-memory MongoDB / fakes). **Design only** = documented, no code.

| ID | Item | Acceptance criteria | Flag | Status |
| --- | --- | --- | --- | --- |
| T3.0 | Smoke test of infra images | Redpanda v25.2.1 and ClickHouse 25.8 start on the 2.9 GB dev VM; Kafka client round-trips a message | — | ✅ done (client: `@confluentinc/kafka-javascript` — kafkajs last published Feb 2023) |
| T3.1 | Stream exporter (Mongo silver → Redpanda) | Cursor-resumable, at-least-once, key = pseudonym; consent + erasure gating; broker down ⇒ no loss, no request impact; lazy client; fails closed without a real salt | `RECSYS_STREAM_ENABLED` | ✅ **Verified live**, including a secured broker (SASL/SCRAM over TLS) |
| T3.2 | ClickHouse sink + loader | Idempotent on `eventId`; erase propagates + tombstones block late events; failed deletes retried; bounded topic retention | `RECSYS_CLICKHOUSE_ENABLED` | ✅ **Verified live** (incl. real `DELETE`, retention check with `rpk`, loader as a real process) |
| T3.3 | KPI backend switch | Same KPIs from Mongo and ClickHouse on the same data; Mongo default; explicit fallback | `RECSYS_ANALYTICS_BACKEND` | ✅ **Verified live** (parity test; fallback tested) |
| T3.4 | dbt project | Models + tests; run against real ClickHouse (mart covers the KPI-relevant subset of `aggregateDay` only) | — | ✅ **dbt itself ran**: `dbt build` 12/12 (dbt-core 1.12.6, dbt-clickhouse 1.10.3, pinned container). Not run in CI |
| T3.5 | Feature store | Registry; point-in-time snapshots; no leakage; export + erase | `RECSYS_FEATURE_SNAPSHOTS` | ✅ Built |
| T3.6 | Learned ranker + automated retraining | Gates; position handling; as-of features; registry; ≤5 % auto challenger in own hash layer; synthetic never servable; harm guard | `RECSYS_RETRAIN_ENABLED` | ✅ Built — **trained only on synthetic data; never run on production logs** |
| T3.7 | Content embeddings | Offline only; hash staleness; similarity signal/candidate; control metrics unchanged | `RECSYS_EMBEDDINGS_ENABLED` | ✅ Built — **hash provider only; Gemini path never executed; threshold uncalibrated** |
| T3.8 | Data residency — code-level only | Region tag, region-keyed routing, cross-region write refusal | `RECSYS_REGIONS` | ✅ Built (code). Regional clusters / deployments / DNS / Terraform: **not built** |
| T3.9 | Overlay, runbook, docs | Compose overlay (pinned tags); architecture §12, deployment §5b, operations §4b, testing §6b | — | ✅ Done |
| T3.10 | Design only | Managed Redpanda/ClickHouse sizing, Metabase/Grafana dashboards, Feast, multi-region infrastructure, Terraform | — | 📝 |

### Phase 3 follow-ups
| ID | Task | Status |
| --- | --- | --- |
| T3.11 | Kafka TLS/SASL and ClickHouse HTTPS against secured endpoints | ✅ **Verified live**: Redpanda with SASL/SCRAM-SHA-256 over TLS (private CA) and ClickHouse over HTTPS (private CA); wrong password, plaintext client and untrusted CA are refused. Found and fixed a real defect on the way (the client rejects object-form `ssl`). Used self-signed test CAs on localhost — **not** a managed/production endpoint |
| T3.12 | Run the Gemini embedding provider on the real catalogue; calibrate `RECSYS_SEMANTIC_MIN`; cost-check one run | 🟡 Wrapper tested with the client mocked (model/key selection, normalisation, error paths: 7 tests). **The real API call is unverified and the threshold uncalibrated — needs a Gemini API key and the real catalogue (absent here)** |
| T3.13 | First real retrain (dry run) once ≥ 20k personalised impressions exist; retune thresholds | 🟡 **Rehearsed end to end** on logs produced by the real recommender + event path (6 000 impressions, simulated learners): trained, gated, activated only as a 5 % challenger; the rehearsal found and fixed a label-join bug (identical `itemRef` across item types). **A retrain on real learners is blocked: no production data** (needs the consent UI, T1.16) |
| T3.14 | Capacity: loader throughput + storage | 🟡 **Measured on the dev VM** (≈ 930 events/s end to end, 84 B/event compressed; `npm run recsys:bench`). Production capacity, rebalancing and long runs **not** measured |
| T3.15 | Schedule `run-dbt.sh` + alert rules | ✅ Health-based alerts built (operations §4b); scheduled job built as `.github/workflows/analytics-dbt.yml` (hourly, **inert until** repo variable `RECSYS_DBT_ENABLED=true` and the `DBT_CH_*` secrets are set; the runner must reach ClickHouse). **Not yet run on GitHub** |
| T3.16 | Region assignment at signup and regional infrastructure | 🟡 **Decision made (D8):** server-assigned, implicit default `vn`, admin-changeable, no user choice; runbook for adding a region written (design). **Regional infrastructure not built** — no second region or cloud provider exists; counsel to confirm the decision |
| T3.17 | Exporter / erasure / live-model state in `/admin/recsys/health` | ✅ Built + tested |

## Top risks
| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Cold-start / sparse data → poor recommendations | High | Med | Preference + level-popularity fallback; exploration bonus; guardrails |
| Consent default-off starves the model | Med | Med | Value-exchange consent copy; non-personalised fallback works; measure opt-in rate |
| Legal misreading of PDPL/Decree 356 | Med | High | Counsel review before launch; data-minimising design; erasure tested |
| Event emission slows request path / breaks features | Low | High | Fire-and-forget emit that never throws; timeouts; tested |
| Mongo load from analytics queries | Med | Med | Bounded windows, indexes, read from facts not raw; move to ClickHouse at trigger |
| Skill taxonomy gaps (`QuestionMetadata` missing) | Med | Med | Fallback skill key `part:<n>`; DQ check on unknown-skill rate |
| Repetitive/bad suggestions erode trust | Med | High | Guardrails + dismiss feedback + weekly review of top recs |
