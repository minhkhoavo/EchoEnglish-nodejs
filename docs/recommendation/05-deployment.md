# 05 · Deployment

## 1. Environments

| Env | Purpose | Data | Flags |
| --- | --- | --- | --- |
| **local** | development | `docker compose up` Mongo (+ optional `db-sync` from Atlas) or `mongodb-memory-server` in tests | `RECSYS_ENABLED=true` |
| **CI** | every branch/PR | in-memory MongoDB 7.0 | enabled per test |
| **staging** (to create) | k6 + rollout rehearsal | synthetic users with consent | `RECSYS_ENABLED=true` |
| **production** (VPS, Docker) | users | real | **`RECSYS_ENABLED=false` at first deploy** |

Configuration (see `.env.example`): `RECSYS_ENABLED`, `RECSYS_EVENT_RETENTION_DAYS`, `RECSYS_PIPELINE_BATCH`, `RECSYS_FORCE_VARIANT`, `RECSYS_AI_RATES_JSON`, `RECSYS_USD_VND`. Note: values in a Docker `--env-file` are taken literally — do not wrap `RECSYS_AI_RATES_JSON` in quotes.

## 2. CI/CD

```
push/PR ──► ci.yml
             ├─ recsys-quality: npm install → eslint → typecheck guard (0 errors in new code)
             │                  → jest (unit+integration+DQ+perf) → offline eval
             └─ full-suite (informational): all existing tests
push main ─► deploy.yaml: build image tagged :<git-sha> AND :latest → push
             → ssh to VPS: pull :<sha> → run → health probe from INSIDE the container (10×3 s, no host `curl` needed) → on failure restart previous image → keep the 4 newest images, remove older ones
```

Changes made to the existing pipeline (`deploy.yaml`): immutable **SHA tags** (rollback needs addressable versions; `:latest` alone is not rollback-able), **health-gated start with automatic rollback** to the previously running image, and `IMAGE_TAG` passed to the VPS. Health probe: `docker exec echo-english node -e "http.get(…)"` — any HTTP status proves the process is serving (the auth gate answers 401); verified locally: closed port → exit 1, live 401 server → exit 0. **Retention:** SHA-tagged images are never "dangling", so `docker image prune` alone would fill the disk; the script keeps the 4 most recent distinct images (current + previous + 2 spare).

**Recommendation (not applied — it changes your release policy):** make `ci.yml / recsys-quality` a required status check on `main` and make `deploy.yaml` depend on tests. The repo-wide suite was not verified green in this environment (see `04-testing.md` §6), so `full-suite` is informational for now.

> Pushing to `main` deploys to production. All work is on branch `feat/recommendation-platform`; nothing was pushed. **The `deploy.yaml` and `ci.yml` changes take effect when the branch is merged to `main`.**

## 3. Infrastructure as code
* Today: GitHub Actions + `docker run` on a VPS; compose for local Mongo. Committed in this branch: `ci.yml`, `deploy.yaml` (SHA/rollback), `scripts/deploy/rollback.sh`, `scripts/ci/typecheck-recsys.sh`, `scripts/ops/recsys-health.ts`, `loadtest/recsys.k6.js`.
* **Phase 2 (design, unvalidated sketch):** Terraform for managed Redis (BullMQ) with `maxmemory-policy=noeviction` and AOF; secrets in the cloud secret manager; staging stack. Phase 3: ClickHouse + Redpanda modules. They are deliberately not committed until needed (an unused, unvalidated IaC file is a liability).

## 4. First-time enablement runbook
1. Deploy image with `RECSYS_ENABLED=false`; smoke test existing flows.
2. Mongoose creates indexes on first use; for large clusters pre-create them off-peak: `learning_events` (6 indexes incl. TTL), `learning_events_clean`, `learner_daily_facts`, `skill_mastery`, `learner_features`, consents.
3. Set `RECSYS_AI_RATES_JSON` from the provider's *current* price list.
4. Flip `RECSYS_ENABLED=true` on one instance, watch `/admin/recsys/health` for 1 h, then all instances.
5. Verify: emit a test event, see it in `learner_daily_facts` within ~2–4 min.
6. Follow the rollout table in `02-plan.md` §4 (shadow → 10% → 100%).

## 5. Rollback matrix

| Failure | Action | Data impact |
| --- | --- | --- |
| Bad release | `scripts/deploy/rollback.sh <sha>` (or automatic on failed health probe) | none |
| Platform misbehaving | `RECSYS_ENABLED=false` + restart → no events, no scheduler, recs endpoint still answers (cold start) | collected data kept |
| Bad ranking variant | `RECSYS_FORCE_VARIANT=control` | none |
| Buggy ETL logic | fix, bump `pipelineVersion`, `pipelineService.rebuildUser()` / re-run from silver; gold is replace-not-increment | gold rebuilt |
| Wrong data collected | `DELETE /privacy/data` per user or targeted `deleteMany` by `type/occurredAt` (bronze is a regular collection) | derived data rebuilt |

## 5b. Phase 3 rollout (all optional, all off by default)
`deploy.yaml` and the production compose are **not** modified by Phase 3. The overlay `docker-compose.analytics.yml` (pinned: Redpanda `v25.2.1`, ClickHouse `25.8`) is for dev/staging; production brokers/warehouse are a separate decision (managed or 2–3 VMs sized from observed volume — not decided here).

Order, each step independently reversible; stop at any point:
1. **Secrets first.** Set `RECSYS_PSEUDONYM_SALT` (≥ 16 chars, secret, never rotated casually — rotating changes every pseudonym; keep the old one to erase old data). Without it every export is refused.
2. **Feature snapshots** — `RECSYS_FEATURE_SNAPSHOTS=true`. Needed ≥ 2–4 weeks before retraining is useful. Rollback: flag off (data TTLs out).
3. **Stream + warehouse** — create ClickHouse schema and run the loader as its own process: `RECSYS_LOADER_REGION=vn npx tsx scripts/ops/recsys-loader.ts --init`, then `npm run recsys:loader` (needs `MONGO_URI` for tombstones). Set `RECSYS_STREAM_BROKERS`, `RECSYS_STREAM_TLS/SASL_*`, then `RECSYS_STREAM_ENABLED=true` on **one** instance (the Mongo lease makes extra instances harmless). Topics are created on first connect with `retention.ms` = `RECSYS_STREAM_RETENTION_HOURS`. Rollback: flag off; the cursor is kept, so re-enabling resumes without loss.
4. **dbt** — `DBT_CH_HOST=… DBT_CH_USER=… DBT_CH_PASSWORD=… scripts/ops/run-dbt.sh build` (pinned container; schedule it every 15–60 min from cron/CI). Marts are tables rebuilt from `events`, so a bad run is fixed by re-running.
5. **KPI cut-over** — `RECSYS_ANALYTICS_BACKEND=clickhouse` only after comparing both backends for a week (`/admin/recsys/kpis` reports `backend` and any `fallbackReason`). Rollback: unset (default `mongo`).
6. **Embeddings** — `npm run recsys:embed` (try `RECSYS_EMBEDDINGS_PROVIDER=hash` first; it costs nothing), then `RECSYS_EMBEDDINGS_ENABLED=true`. Calibrate `RECSYS_SEMANTIC_MIN`. No behaviour changes until a learned model weights the signal.
7. **Retraining** — `RECSYS_RETRAIN_ENABLED=true` only once the logs hold enough impressions (defaults 20 000 impressions / 500 clicks). First `POST /admin/recsys/models/retrain {"dryRun":true}` and read the report. A passing model auto-activates at ≤ 5 %; raise with `POST /admin/recsys/models/:v/activate {"allocationPct":N}` (≤ 50) only after reading `/admin/recsys/experiments`. Rollback: `POST …/retire`, or `RECSYS_FORCE_VARIANT=control`, or flag off.

| Phase 3 failure | Action | Data impact |
| --- | --- | --- |
| Exporter misbehaving | `RECSYS_STREAM_ENABLED=false` | none; cursor retained |
| Wrong data reached the warehouse | `DELETE FROM events WHERE …`, fix, re-run dbt; or rewind `recsys_stream_state.cursorId` to re-export (loader dedups) | warehouse only |
| Warehouse down | nothing — KPI endpoints answer from Mongo and say so; exporter retries; failed erase deletes stay `warehousePending` and are retried by the loader sweep | none |
| Bad learned model | retire it (above); guard also auto-retires on significant CTR harm | none |
| Pseudonym secret leaked | rotate, re-export, erase old pseudonyms (tombstones cover old ones only if computed with the old secret — keep it for erasure) | warehouse rebuilt |

## 6. Migration from the current stack
No data migration is required: all new collections; existing collections are read-only inputs. Flashcard scheduling is unchanged (Leitner). Backfill option: seed `question_answered` history from existing `testresults` via a one-off script (Phase 1.1; not needed for launch — mastery warms up from new answers, and cold start covers the gap).
