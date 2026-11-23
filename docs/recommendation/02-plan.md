# 02 · Planning

## 1. Phased roadmap

```
 Phase 0   Phase 1 (MVP)                         Phase 2 (Growth)                 Phase 3 (Scale)
 wk 1      wk 2 ─────────── wk 5     wk 6–8       months 2–4                       months 5–12
 ┌──────┐  ┌────────────────────┐   ┌─────────┐  ┌───────────────────────┐        ┌─────────────────────────┐
 │ docs │  │ events→ETL→features│   │ staged  │  │ FSRS (shadow→flag)    │        │ Redpanda/Kafka          │
 │ + DPA│  │ →recommender→API   │   │ rollout │  │ learned ranker/bandit │        │ ClickHouse + dbt + BI   │
 │ review│ │ KPIs, tests, CI    │   │ 10→100% │  │ BullMQ + Redis        │        │ embeddings for content  │
 └──────┘  └────────────────────┘   └─────────┘  │ GrowthBook, Terraform │        │ feature store, retrain  │
                                                  │ consent UI polish     │        │ multi-region residency  │
                                                  └───────────────────────┘        └─────────────────────────┘
 Gate to P2: ≥ 30 days of review logs, ≥ 2 completed A/B tests, opt-in ≥ 40%, no P1 incidents
 Gate to P3: any trigger in 03-architecture §10 fires
```

## 2. Task breakdown and estimates
See `TASKS.md` (ideal engineer-days, one engineer). MVP total ≈ **38 days** (≈ 7–8 calendar weeks for one engineer, ≈ 4–5 weeks for two). Items already delivered in this branch are ticked there.

Estimation method: bottom-up per task, +25% buffer for integration with existing services, +15% for legal review loops. Confidence: ±30% for MVP, ±60% for Phase 2, order-of-magnitude for Phase 3.

## 3. Dependencies and critical path
1. **Legal review of consent copy + processing register** (critical; blocks production enablement, not development).
2. **Front-end** work (not in this repo): consent screen, call `POST /events/batch` for resource dwell/session/rec feedback, render recommendations. Without it only server-side signals flow.
3. **Content tagging coverage**: resources must carry `labels.cefr/domain/topic`; `QuestionMetadata` must exist for tests used in drills. Measured by DQ check `unknown_skill_rate`.
4. **LLM price configuration** (`RECSYS_AI_RATES_JSON`) to make AI cost KPI meaningful.

Critical path: legal copy → front-end consent UI → staged rollout. Engineering does not block on any of them.

## 4. Rollout plan (feature-flagged, reversible)

| Step | Action | Exit criteria | Rollback |
| --- | --- | --- | --- |
| R0 | Deploy with `RECSYS_ENABLED=false` | App unchanged (smoke test) | n/a |
| R1 | Enable on staging with synthetic users; run k6 | k6 thresholds pass; health `ok` 24 h | flag off |
| R2 | **Shadow collection** in prod: enable flag, keep UI unchanged | 2 weeks of events; DQ green; baselines recorded; consent opt-in measured | flag off (data kept, or erase on request) |
| R3 | Show recommendations to 10% (hash bucket) | CTR ≥ 15%, dismiss rate ≤ 25%, no regression in D1 retention vs control group | set rollout % to 0 |
| R4 | 50% → 100%; start A/B `control` vs `srs_heavy` | pre-registered sample size reached (03 §7.8) | `RECSYS_FORCE_VARIANT=control` |

## 5. Risks (extended)
See `TASKS.md` for the top risks. Additional delivery risks:

| Risk | Mitigation |
| --- | --- |
| Single-server memory (2–3 GB in dev/VPS) starves tests/jobs | ETL batch bounded (`RECSYS_PIPELINE_BATCH`), analytics windows capped at 90 d, CI runs jest with 2 workers |
| `npm ci` fails today (lockfile out of sync) | CI mirrors the Dockerfile's `npm install`; recommend regenerating the lockfile (separate PR) |
| Existing `deploy.yaml` ships without tests | New `ci.yml` runs tests on every branch/PR; make it a required check once the full suite is verified green |
| Prompt/LLM quota limits for optional features | Recommender has no LLM dependency |

## 6. Definition of done (per component)
Code + unit tests + (where Mongo semantics matter) integration test on real MongoDB; zero new `tsc` errors; lint clean; documented in `03-architecture.md`; flag-guarded; privacy impact noted.
