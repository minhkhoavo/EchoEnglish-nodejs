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
             → ssh to VPS: pull :<sha> → run → health probe (10×3 s) → on failure restart previous image
```

Changes made to the existing pipeline (`deploy.yaml`): immutable **SHA tags** (rollback needs addressable versions; `:latest` alone is not rollback-able), **health-gated start with automatic rollback** to the previously running image, and `IMAGE_TAG` passed to the VPS. Health probe: any HTTP status from `localhost:4000/` proves the process is serving (the auth gate answers 401).

**Recommendation (not applied — it changes your release policy):** make `ci.yml / recsys-quality` a required status check on `main` and make `deploy.yaml` depend on tests. The repo-wide suite was not verified green in this environment (see `04-testing.md` §6), so `full-suite` is informational for now.

> Pushing to `main` deploys to production. All work is on branch `feat/recommendation-platform`; nothing was pushed.

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

## 6. Migration from the current stack
No data migration is required: all new collections; existing collections are read-only inputs. Flashcard scheduling is unchanged (Leitner). Backfill option: seed `question_answered` history from existing `testresults` via a one-off script (Phase 1.1; not needed for launch — mastery warms up from new answers, and cold start covers the gap).
