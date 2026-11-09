# 06 · Operations

## 1. Monitoring
| Signal | Where | How |
| --- | --- | --- |
| Pipeline health (`ok/degraded/down` + reasons) | `GET /admin/recsys/health` (503 when down) and `scripts/ops/recsys-health.ts` (exit 0/1/2) | run the script every 5 min from cron / uptime monitor / scheduled GitHub Action |
| Run history, counts, DQ results | `GET /admin/recsys/pipeline` (last 20 runs) | admin dashboard |
| Backlog & freshness | `pendingEvents`, `freshnessLagMinutes` in health | alert |
| Recommendation quality | `GET /admin/recsys/experiments`, `kpis` | weekly review |
| Logs | `[recsys] …` lines (emit failures, ETL ticks, DQ) | existing log shipping |
| Latency/errors | existing API monitoring on `/recommendations`, `/events/batch` | k6 thresholds as SLOs |

## 2. Alert rules
| Alert | Condition | Severity | First action |
| --- | --- | --- | --- |
| Pipeline down | health `down` (no run > 15 min with backlog, last run failed, never ran) | P1 | §4.1 |
| Data quality degraded | any failed DQ check, reject rate > 5% (24 h) | P2 | §4.2 |
| Freshness | lag > 30 min | P2 | check lease/scheduler, Mongo load |
| Recommendations unhealthy | dismiss rate > 30% or CTR −30% vs 7-day mean | P2 | §4.3 |
| AI cost spike | AI cost/active learner > 2× 7-day mean or share of revenue > 3% | P2 | find `ai_usage.feature`; apply quota/model downgrade |
| Consent/erasure failure | any 5xx on `/privacy/*` | P1 | §4.4 |
| Event volume anomaly | events/hour < 50% or > 300% of same hour last week | P3 | check client release |

## 3. Cost tracking
* **AI cost/learner:** `ai_usage` events (tokens always recorded; `costUsd` from `RECSYS_AI_RATES_JSON`). Attribution: per request user via AsyncLocalStorage; tag a feature with `runWithFeature('daily_plan', …)` (Phase 1.1: tag the top 5 LLM call sites). System/cron LLM calls are platform cost, not per-learner.
* **Unit economics:** `kpis.unitEconomics` — credits/learner, payer conversion, AI cost share of revenue (`RECSYS_USD_VND`).
* **Storage:** bytes/event from `03-architecture.md` §3 × volume; review monthly against TTL.

## 4. Incident runbooks
**4.1 Pipeline stalled/down.** `GET /admin/recsys/health` → read `problems`. (a) `lastRun.status=failed`: read `error` in `/admin/recsys/pipeline`; fix and let the next tick retry (work is idempotent). (b) No runs: check `RECSYS_ENABLED`, process alive, `recsys_locks` (stale lease expires in 4 min; delete doc `_id:'etl'` only if the holder is confirmed dead). (c) Backlog large: raise `RECSYS_PIPELINE_BATCH`; backlog drains 10 batches/tick.
**4.2 DQ degraded.** Identify the failing check on the run. High `reject_rate`: inspect `processing.reason` on rejected rows (usually a client sending a changed payload) → fix client or loosen schema, then re-queue (`updateMany({'processing.status':'rejected'},{$set:{'processing.status':'pending'}})`). High `unknown_skill_rate`: tests missing `QuestionMetadata` → run metadata tagging.
**4.3 Bad/repetitive recommendations.** Set `RECSYS_FORCE_VARIANT=control`; inspect `reason.code` distribution; check exposure/dismiss events are flowing; if severe `RECSYS_ENABLED=false`.
**4.4 Privacy incident.** Contain (disable endpoint/flag), record time of discovery, assess data types (behavioural tracking; no audio/biometric data is stored by this platform), **notify per legal advice — the decree summary indicates authority notification and a 72-hour data-subject notice for location/biometric data; keep breach records ≥ 5 years** ([EY alert](https://www.ey.com/en_vn/technical/tax/tax-and-law-updates/legal-alert-march-2026-decree-no-356-2025-nd-cp-providing-detailed-guidance-for-implementation-of-personal-data-protection-law)). Use lineage to scope affected users.
**4.5 Data-subject request.** Self-service endpoints execute immediately; for requests through support: run export/erase for the user id, record ticket + timestamps (SLA: respond 2 working days; execute within 10 d access / 20 d erasure per decree summary).

## 5. Iterating on KPIs (operating cadence)
* **Weekly (30 min):** KPI overview (activation, D1/D7/D30, study time, score gain, credit spend, AI cost); top-10 recommendations by impressions with dismiss reasons; DQ trend.
* **Per experiment:** pre-register hypothesis, primary metric, MDE, sample size, guardrails, stop rule (03 §7.8) → run → read-out → decision recorded in the repo (`docs/recommendation/experiments/<id>.md`).
* **Monthly:** re-run offline eval on logged data; review taxonomy gaps; review retention TTLs and consent opt-in rate; check triggers in 03 §10.
* **Quarterly:** re-fit/tune weights (Phase 2: learned ranker), re-assess infra triggers and cost vs. ARPU.
