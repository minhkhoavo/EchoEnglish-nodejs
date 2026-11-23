# 06 · Operations

## 1. Monitoring
| Signal | Where | How |
| --- | --- | --- |
| Pipeline health (`ok/degraded/down` + reasons) | `GET /admin/recsys/health` (503 when down) and `scripts/ops/recsys-health.ts` (exit 0/1/2) | run the script every 5 min from cron / uptime monitor / scheduled GitHub Action |
| Run history, counts, DQ results | `GET /admin/recsys/pipeline` (last 20 runs) | admin dashboard |
| Backlog & freshness | `pendingEvents`, `freshnessLagMinutes` in health | alert |
| Recommendation quality | `GET /admin/recsys/experiments`, `kpis` | weekly review |
| Logs | `[recsys] …` lines (emit failures, ETL ticks, DQ) | existing log shipping |
| Pushed alerts | `RECSYS_ALERT_WEBHOOK_URL` (Slack-compatible JSON `{text}`); at most one message per alert type per 30 min | ETL run degraded/failed (`etl_degraded`, `etl_failed`), `etl_crashed`, `retrain_crashed`, `model_auto_retired`; also written to the log as `[recsys][alert]` even without a webhook |
| Experiment integrity | `sampleRatio` and `perLearner` in `GET /admin/recsys/experiments` | check before every read-out |
| Feedback attribution | share of feedback answered `attributed: false` (client logs) or rejected `rec_*` events (`recId/item was not served to this user`) | a sudden rise means a client is sending ids from the wrong list |
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
| Sample-ratio mismatch | `sampleRatio.mismatch = true` in the experiment read-out | P2 | §4.12; do not read the experiment until fixed |

Only the four alert types listed under *Pushed alerts* are sent by the platform itself. Every other rule here needs an external monitor polling `/admin/recsys/health`, the KPI and experiment endpoints, or the logs. In particular, **a scheduler that has stopped sends nothing** — the uptime check on `npm run recsys:health` is what catches it.

## 3. Cost tracking
* **AI cost/learner:** `ai_usage` events (tokens always recorded; `costUsd` from `RECSYS_AI_RATES_JSON`). Attribution: per request user via AsyncLocalStorage; tag a feature with `runWithFeature('daily_plan', …)` (Phase 1.1: tag the top 5 LLM call sites). System/cron LLM calls are platform cost, not per-learner.
* **Unit economics:** `kpis.unitEconomics` — credits/learner, payer conversion, AI cost share of revenue (`RECSYS_USD_VND`).
* **Storage:** bytes/event from `03-architecture.md` §3 × volume; review monthly against TTL.

## 4. Incident runbooks
**4.1 Pipeline stalled/down.** `GET /admin/recsys/health` → read `problems`. (a) `lastRun.status=failed`: read `error` in `/admin/recsys/pipeline`; fix and let the next tick retry (work is idempotent). (b) No runs: check `RECSYS_ENABLED`, process alive, `recsys_locks` (stale lease expires in 4 min; delete doc `_id:'etl'` only if the holder is confirmed dead). (c) Backlog large: raise `RECSYS_PIPELINE_BATCH`; backlog drains 10 batches/tick.
**4.2 DQ degraded.** Identify the failing check on the run. High `reject_rate`: inspect `processing.reason` on rejected rows (usually a client sending a changed payload) → fix client or loosen schema, then re-queue (`updateMany({'processing.status':'rejected'},{$set:{'processing.status':'pending'}})`). High `unknown_skill_rate`: tests missing `QuestionMetadata` → run metadata tagging.
**4.3 Bad/repetitive recommendations.** Set `RECSYS_FORCE_VARIANT=control`; inspect `reason.code` distribution; check exposure/dismiss events are flowing; if the complaints are about one odd item in a list, it may be the exploration slot (`explored: true` on the impression) — lower or zero `RECSYS_EXPLORE_PCT`; if severe `RECSYS_ENABLED=false`.
**4.4 Privacy incident.** Contain (disable endpoint/flag), record time of discovery, assess data types (behavioural tracking; no audio/biometric data is stored by this platform), **notify per legal advice — the decree summary indicates authority notification and a 72-hour data-subject notice for location/biometric data; keep breach records ≥ 5 years** ([EY alert](https://www.ey.com/en_vn/technical/tax/tax-and-law-updates/legal-alert-march-2026-decree-no-356-2025-nd-cp-providing-detailed-guidance-for-implementation-of-personal-data-protection-law)). Use lineage to scope affected users.
**4.5 Data-subject request.** Self-service endpoints execute immediately; for requests through support: run export/erase for the user id, record ticket + timestamps (SLA: respond 2 working days; execute within 10 d access / 20 d erasure per decree summary).

## 4b. Phase 3 runbooks
**4.6 Stream not flowing.** `recsys_stream_state` (`_id:'silver'`) shows `cursorId`, `updatedAt`, `lastError`, `totals`. `lastError` set ⇒ broker unreachable/auth: fix connectivity (TLS/SASL env), the next tick resumes. `PseudonymConfigError` in logs ⇒ `RECSYS_PSEUDONYM_SALT` missing/weak (export is refused by design). `locked` results are normal when another instance holds the lease (stale lease expires in 4 min).
**4.7 Loader lag / ClickHouse down.** Consumer-group `echo-warehouse-loader-<region>` lag via `rpk group describe`. The loader commits only after a successful insert, so an outage just builds lag. **Observed live** (ClickHouse stopped for ≈ 30 s while 3 events were exported): the consumer logged `Consumer encountered error while processing message … ECONNREFUSED`, the process stayed alive, and after ClickHouse restarted the 3 missed events arrived (rows 3 → 6) with no manual action. Longer outages, repeated restarts and consumer-group rebalances were **not** tested, so keep a supervisor (systemd/Docker `restart: always`) on the loader process; messages are retained for `RECSYS_STREAM_RETENTION_HOURS` — **if the outage exceeds retention, data is lost from the stream; re-export from Mongo** by rewinding `recsys_stream_state.cursorId` (dedup absorbs repeats).
**4.8 Erase reported `warehouse: failed`.** The tombstone is `warehousePending`; the loader sweep retries every minute. Verify later with `SELECT count() FROM events WHERE user_pseudo = '…'` (pseudonym = HMAC of region + user id). If no loader is running, run it once or execute `eraseFromWarehouse` manually — **do not close the data-subject ticket until it is confirmed deleted**.
**4.9 KPI shows `backend:"mongo"` with a `fallbackReason`.** ClickHouse unreachable or marts missing (run dbt). Numbers remain valid (Mongo path) but cover all regions, while ClickHouse covers one.
**4.10 Retraining.** `GET /admin/recsys/models` lists versions with `status`, `metrics.lift`, `metrics.positionBias`, `metrics.counterfactual`, `counts`, `reasons`. A `rejected` model with data-gate reasons (e.g. `only N positives`) is normal until enough logs accumulate; positives are outcome labels, so expect fewer than raw clicks. Weekly cron (Sat 20:00 UTC) trains; daily 20:30 UTC guard retires a live model whose per-learner CTR is significantly worse than control (look for the `model_auto_retired` alert, `auto-retired` in logs and `retiredReason`). **Never** raise allocation without reading the `learned` vs `control` rows in `/admin/recsys/experiments` (personalised mode).
**4.11 Embedding job.** Exit code 1 ⇒ at least one failed batch (quota). Re-run: unchanged items are skipped. Track `estTokens` per run for cost.

**Alerting.** `GET /admin/recsys/health` and `scripts/ops/recsys-health.ts` now include a `phase3` section when the matching flag is on and **degrade** on: an exporter `lastError`; silver events waiting while the cursor has been idle > 15 min; any warehouse erasure pending > 10 min. Point the existing uptime monitor at it. An auto-retired model is pushed to `RECSYS_ALERT_WEBHOOK_URL` (Phase 4). **Still to wire up (not built):** loader consumer-group lag (needs `rpk`/broker metrics), KPI `fallbackReason` present > 30 min, and failure alerting for the scheduled dbt job beyond the failing workflow run.

## 4c. Phase 4 runbooks
**4.12 Sample-ratio mismatch.** The arms do not hold the share of learners the assignment should give them, so the effect estimate cannot be trusted. Usual causes: a client or cache path that skips logging for one arm, a deploy that changed experiment weights mid-test, or bots concentrated in one arm. Stop reading the experiment, compare impressions per arm per day to find when it started, fix, and restart the test with a new pre-registration.
**4.13 Many `attributed: false` or rejected `rec_*` events.** A client is sending `recId`/item pairs that were not in a list served to that learner (mixed lists, cached ids from another account, or ids older than `RECSYS_SERVED_RETENTION_DAYS`). The repetition guard still works; only analytics and training lose the signal. Fix the client; nothing to repair on the server.
**4.14 Worker process.** With `RECSYS_SCHEDULER_ENABLED=false` on API instances, ETL, exporter, retraining and the harm guard run only in `npm run recsys:worker`. If it stops, nothing is pushed; `/admin/recsys/health` turns `down` once events are pending and no run has happened for 15 minutes, so the uptime check on it must be in place. Restart it; all jobs are idempotent and resume from their leases and cursors.

## 5. Iterating on KPIs (operating cadence)
* **Weekly (30 min):** KPI overview (activation, D1/D7/D30, study time, score gain, credit spend, AI cost); top-10 recommendations by impressions with dismiss reasons; DQ trend.
* **Per experiment:** pre-register hypothesis, primary metric, MDE, sample size, guardrails, stop rule (03 §7.8) → run → read-out → decision recorded in the repo (`docs/recommendation/experiments/<id>.md`).
* **Monthly:** re-run offline eval on logged data; review taxonomy gaps; review retention TTLs and consent opt-in rate; check triggers in 03 §10.
* **Quarterly:** re-fit/tune weights (or review the learned ranker's reports once retraining is on), re-assess infra triggers, exploration share and cost vs. ARPU.
