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
| T1.24 | Staging environment + run k6 + tune thresholds | 2 | ⏭ |

## Phase 2 — Growth (months 2–4) ⏭
BullMQ + Redis for pipeline jobs · FSRS via `ts-fsrs` (shadow mode first) · learned ranker / contextual bandit · GrowthBook · Terraform · front-end consent UI · weekly KPI review ritual.
Triggers: see `03-architecture.md` §10.

## Phase 3 — Scale (months 5–12) ⏭
Redpanda/Kafka + ClickHouse + dbt · content embeddings · multi-region data residency · feature store (Feast or in-house) · automated model retraining.

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
