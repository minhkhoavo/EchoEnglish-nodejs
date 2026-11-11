# Recommendation platform: developer guide

For two readers:

- **Client developers** (web and mobile) calling the API: sections 1–4.
- **Backend developers** changing the platform: sections 5–8.

What the system does and why it is built this way is in `FEATURE-DOCUMENT.md`. This guide covers how to run it, call it, change it and debug it.

---

## 1. Try it in five minutes (no database, no login)

The **sandbox** runs the real recommendation routes and services against an in-memory MongoDB with 30 seeded articles. It replaces login with two headers, `x-demo-user: <24-hex id>` and `x-demo-role: ADMIN`. It also adds two helper routes: one that fakes a practice history and one that runs the ETL immediately instead of waiting for the scheduler. It never reads `MONGO_URI`.

| Way | Command | You get |
| --- | --- | --- |
| **Automated walkthrough** | `npm run recsys:sandbox -- --walkthrough` | 19 PASS/FAIL checks over HTTP, exit code 0/1 |
| **Postman** | `npm run recsys:sandbox`, then import the collection (below) | 35 requests in client order, each with tests |
| **Postman from the command line** | sandbox running, then `npx -y newman@6.2.1 run docs/recommendation/postman/recsys.postman_collection.json -e docs/recommendation/postman/recsys-sandbox.postman_environment.json` | Same 35 requests and 70 assertions in the terminal |
| **curl** | `npm run recsys:sandbox` | Prints a learner id and ready-to-paste `curl` commands |

### Postman

1. Start the sandbox: `npm run recsys:sandbox` (port 4010; `PORT=4011` to change it).
2. In Postman, **Import** the three files in `docs/recommendation/postman/`:
   - `recsys.postman_collection.json`: the requests
   - `recsys-sandbox.postman_environment.json`: `baseUrl=http://127.0.0.1:4010`, `authMode=sandbox`
   - `recsys-local-app.postman_environment.json`: for a locally running app (section 2)
3. Select the **EchoEnglish recsys - sandbox** environment.
4. Either **Run** the whole collection (Collection Runner), or open folder *1. Learner workflow* and send the requests one by one, top to bottom.

How the collection works:

- Each run starts a **fresh learner**: the first request generates a new `userId`, so per-learner rate limits and earlier erasures never get in the way.
- Requests **chain**: `GET /recommendations` saves `recId` and the first two items into collection variables, and the feedback requests use them. Sent on their own before any list, the feedback requests fail with `400` because those variables are still empty.
- Folder *0* (real-app login) skips itself in the sandbox, and the `[sandbox]` requests skip themselves against the real app. The same collection is meant to run in both environments. The sandbox path is verified with newman; the local-app path (real login, JWT decode, scheduler timing) has not been run end to end yet, so report anything that breaks there.
- Folder *3* erases the learner's data, so it comes after the workflow and admin folders.
- The model activate and retire requests use version `999999`, which does not exist, so they return `404` and change nothing. Set `version` to a real one to try them.

Exploration (`RECSYS_EXPLORE_PCT`) is **off in the sandbox** so the same request returns the same list. Start it with `RECSYS_EXPLORE_PCT=10 npm run recsys:sandbox` to see the randomised slot.

---

## 2. Testing against a locally running app

Use this to check the integration with real login, real data and the scheduler.

1. In `.env`: `RECSYS_ENABLED=true` and a development `MONGO_URI`. Start the app with `npm run dev` (port 4000).
2. Create two test accounts: a learner, and an admin (an account whose `role` is `ADMIN`).
3. In Postman select **EchoEnglish recsys - local app** and fill in `email`, `password`, `adminEmail`, `adminPassword`. Keep them as *current values* only, so they are never exported or committed.
4. Run the collection. Folder *0* logs both accounts in and stores `token`, `adminToken` and the learner's `userId` (read from the JWT).

Differences from the sandbox:

- The ETL runs on the scheduler **every 2 minutes**. A list stays `cold_start` until the learner has events that went through a tick. The sandbox-only assertions (the exact cold-start item, "weak skills are drilled") are skipped here.
- Rate limits are per learner and per hour for export (5) and erasure (3), so repeated runs with the same account hit `429`.
- `DELETE /privacy/data` really erases the account's behavioural data. **Never point the local-app environment at staging or production.** A unit test fails if a committed environment has a non-local `baseUrl` or any credential.

---

## 3. API basics

| Topic | Rule |
| --- | --- |
| Base path | Routes are mounted at the root: `/recommendations`, `/events/batch`, `/privacy/*`, `/admin/recsys/*` |
| Auth | `Authorization: Bearer <JWT>` from `POST /auth/login` (`data.token`). The user id always comes from the token, never from a body or query parameter. `/admin/recsys/*` needs the `ADMIN` role |
| Envelope | Success: `{ "message": "...", "data": ... }`. Error: `{ "message": "..." }` |
| Status codes | `400` invalid input (the message says which field) · `401` no or invalid token · `403` not an admin · `404` unknown model version · `429` rate limited · `503` health is `down` |
| Content type | `application/json` |

Rate limits are per user and per minute unless stated:

| Route | Limit |
| --- | --- |
| `POST /events/batch` | 60 |
| `PUT /privacy/consent`, `POST /privacy/consent/withdraw` | 20 |
| `GET /recommendations` | 30 |
| `POST /recommendations/feedback` | 120 |
| `GET /privacy/export` | 5 per hour |
| `DELETE /privacy/data` | 3 per hour |
| `POST /admin/recsys/models/retrain` | 5 per hour |

---

## 4. Client integration

### 4.1 Consent first

Everything behavioural is gated by consent, and every purpose is **off by default**.

| Purpose | What it turns on |
| --- | --- |
| `analytics` | Behavioural events are stored (`POST /events/batch`, feedback analytics). Without it they are counted as `droppedNoConsent` and discarded |
| `personalization` | Personalised lists. Without it the learner gets the non-personalised `cold_start` list |
| `research` | Stored and recorded in the ledger; nothing reads it yet |

```http
GET /privacy/consent                 → { analytics, personalization, research }
PUT /privacy/consent                 { "analytics": true, "personalization": true }   (send only what changed)
POST /privacy/consent/withdraw       → every purpose false
```

Each change is appended to a ledger with the policy version. A change applies at once on the app instance that handled it and within 60 seconds on the others, because consent is cached per instance for 60 seconds. The recommendation cache is keyed by consent, so once an instance sees a withdrawal it never serves a cached personalised list.

### 4.2 Get recommendations

```http
GET /recommendations?limit=5          limit 1–10, default 5
GET /recommendations?refresh=true     bypass the 2-minute cache (pull-to-refresh only)
```

A real sandbox response, shortened to one item:

```json
{
  "message": "OK",
  "data": {
    "recId": "07d87e11-7085-431c-a5a4-15d38eaaaa39",
    "generatedAt": "2026-11-11T05:33:15.785Z",
    "variant": "srs_heavy",
    "algo": "weighted-v1",
    "mode": "personalized",
    "timing": {
      "bestHour": 12,
      "suggestion": "You tend to study around 12:00 — schedule this session then.",
      "suggestionI18n": { "en": "You tend to study around 12:00 — …", "vi": "Bạn thường học vào khoảng 12:00 — …" }
    },
    "totalMinutes": 24,
    "items": [
      {
        "rank": 3,
        "id": "skill_drill:p6.conjunction",
        "type": "skill_drill",
        "ref": "p6.conjunction",
        "title": "Practice: Part 6 · conjunction",
        "titleI18n": { "en": "Practice: Part 6 · conjunction", "vi": "Luyện tập: Part 6 · conjunction" },
        "estMinutes": 10,
        "skillKey": "p6.conjunction",
        "score": 0.110653,
        "reason": {
          "code": "weak_skill",
          "text": {
            "en": "You answered 25% of 12 questions on Part 6 · conjunction correctly (estimated mastery now 34%) — the biggest opportunity to gain points.",
            "vi": "Bạn trả lời đúng 25% trong 12 câu ở Part 6 · conjunction (…)"
          },
          "evidence": { "skill": "Part 6 · conjunction", "pct": 34, "n": 12, "acc": 25 }
        },
        "action": { "screen": "skill_drill", "skillKey": "p6.conjunction", "questions": 10 }
      }
    ]
  }
}
```

How to render it:

- Show `titleI18n[lang]` and `reason.text[lang]` (`lang` is `en` or `vi`). `reason.code` and `evidence` are for icons, analytics and support. Don't build sentences from them.
- `action.screen` says what to open: `flashcard_review`, `skill_drill` (with `skillKey`, `questions`), `resource` (with `resourceId`), `test_list` (with `mode`), `speech_practice`, `vocab_capture`.
- Keep `recId` with the list; feedback needs it.
- **Do not send `rec_impression`.** The server records what it served when it builds the list.
- `variant` and `mode` are informational. The server already knows them, so you don't need to send them back.

### 4.3 Send feedback

```http
POST /recommendations/feedback
{ "recId": "<from the list>", "itemType": "<items[i].type>", "itemRef": "<items[i].ref>", "action": "click" }
```

| `action` | When | Extra field |
| --- | --- | --- |
| `click` | The learner opens the item | – |
| `complete` | The learner finishes it | `outcome`: score 0–100 (optional) |
| `dismiss` | The learner hides it (hidden for 14 days) | `reason`: `too_easy`, `too_hard`, `not_relevant` or `seen` (optional) |

The response is `{ "attributed": true }` when `recId` + item match a list the server served to this learner in the last 30 days. Variant, mode and position are then taken from that record. `attributed: false` still updates the repetition guard but is not counted in analytics or training, which almost always means the client mixed up ids from different lists.

### 4.4 Send behavioural events

```http
POST /events/batch
x-client-platform: web | ios | android
{ "events": [ { "eventId": "<uuid v4>", "schemaVersion": 1, "type": "resource_viewed",
                "occurredAt": "2026-11-11T05:30:00.000Z",
                "props": { "resourceId": "<24-hex>", "dwellSec": 20 } } ] }
```

| Rule | Detail |
| --- | --- |
| Types a client may send | `session_started` `{platform?}`, `session_ended` `{durationSec}`, `resource_viewed` `{resourceId, dwellSec, resourceType?, scrollDepth?}`. `rec_*` events are accepted but checked against served lists; use `/recommendations/feedback` instead. Everything else (answers, tests, flashcards, credits, speech) is emitted by the server and rejected from clients as `server-only` |
| `eventId` | UUID generated **once per event** and reused on every retry. That makes retries safe (`duplicates` counter) |
| `occurredAt` | ISO time on the device. Rejected if older than 7 days or more than 5 minutes in the future |
| Batch size | At most 100 events |
| Result | `{ accepted, duplicates, droppedNoConsent, rejected: [{ index, reason }] }`. One bad event doesn't reject the batch |
| Retry | On a network error or `5xx`, resend the same batch. Don't resend items listed in `rejected`, because they will never be accepted |

The exact property schemas are `eventPropsSchemas` in `src/recsys/events/eventTypes.ts`.

### 4.5 Privacy screens

| Call | Purpose |
| --- | --- |
| `GET /privacy/export` | Everything held about the learner (events, daily facts, mastery, features, exposure, served lists, consent and its history, region) as JSON |
| `DELETE /privacy/data` | Erases behavioural data and withdraws consent. The consent ledger is kept as proof |

---

## 5. Backend: code map

Everything lives in `src/recsys/`. Business code touches it only through the emit helpers and the router.

| Folder | Responsibility | Start with |
| --- | --- | --- |
| `events/` | Event contract (zod), ingest with consent gate and idempotency, typed server-side emit helpers | `eventTypes.ts`, `emitters.ts` |
| `etl/` | Bronze `learning_events` → silver `learning_events_clean` → gold `learner_daily_facts`; data-quality checks; lease and watermark | `pipeline.ts` |
| `features/` | Mastery (Elo/1-PL with decay), retention, per-question difficulty, learner feature build | `featureBuilder.ts` |
| `engine/` | Candidates → ranker → guardrails → explanations; experiments, cache, served-list log, exposure | `recommender.ts` |
| `learning/` | Learned ranker: dataset, training, registry, retrain gates and harm guard | `retrain.ts` |
| `analytics/` | KPIs, experiment read-out, health, alerts | `kpiService.ts` |
| `privacy/` | Consent and ledger, export and erasure | `dataSubjectService.ts` |
| `eval/` | Offline metrics, simulator, replay and counterfactual estimators | `cli.ts` |
| `http/` | Routes and controller | `routes.ts` |
| `stream/`, `warehouse/`, `featurestore/`, `embeddings/` | Phase 3, flag-gated and off by default | `03-architecture.md` §12 |
| `scheduler.ts`, `config.ts` | Cron jobs; every environment variable | |

One `GET /recommendations` request, step by step, is in `FEATURE-DOCUMENT.md` §5.6.

MongoDB collections worth knowing when debugging: `learning_events`, `learning_events_clean`, `learner_daily_facts`, `learner_features`, `skill_mastery`, `rec_served`, `recsys_exposure`, `recsys_pipeline_runs`, `recsys_consents`, `recsys_consent_ledger`, `rec_models`.

---

## 6. Common changes

### Emit a new event from business code

1. Add the props schema to `eventPropsSchemas` and its category (`behavioral` needs analytics consent; `service` does not) to `EVENT_CATEGORY` in `events/eventTypes.ts`. TypeScript will not compile until both exist.
2. Add a typed helper to `events/emitters.ts` using `safe()`. Helpers never throw and are a no-op when `RECSYS_ENABLED` is off.
3. Call it from the service. Don't `await` it on a hot path.
4. If it should feed daily facts, add a `case` in `etl/aggregate.ts`.
5. Only add it to `CLIENT_ALLOWED_TYPES` if a client really is the source of truth. Anything that affects scores or credits must stay server-only.
6. Tests: `__tests__/unit/recsys/eventTypes.unit.test.ts` and `etl.unit.test.ts`.

### Add a recommendation reason or item source

1. Add the code to `ReasonCode` in `engine/types.ts`.
2. Add English and Vietnamese templates in `engine/explain.ts`. `TEMPLATES` is a `Record<ReasonCode, …>`, so a missing template does not compile. Vietnamese copy needs a native-speaker review.
3. Generate candidates in `engine/candidates.ts`, with `title`, `titleVi`, an `action` the clients can open, and normalised `signals`.
4. Run `npm run recsys:eval` before and after, and compare NDCG@5 against `control`.

### Add a ranking signal

Add it to `Signals` in `engine/types.ts` (normalised to [0, 1]). `WeightSet` is `Required<Signals>`, so every variant in `engine/ranker.ts` must give it a weight. The learned ranker's inputs (`SIGNAL_KEYS`) come from the control weights, so models trained before the change must be retrained before they are activated. Signals are logged with impressions and never sent to clients; a test checks this.

### Change an experiment

Arms and weights are in `RANKER_EXPERIMENT` in `engine/experiments.ts`. Assignment is a stable hash per learner. Pre-register the metric and sample size, then read results at `GET /admin/recsys/experiments`. `RECSYS_FORCE_VARIANT=control` is the kill switch.

### Add an HTTP route

1. Add the route in `http/routes.ts` with a per-user rate limit, and the handler in `http/recsysController.ts`. Get the user id with `uid(req)`, and validate every body field.
2. Add a request with at least one `pm.test` to the Postman collection. Edit it in Postman and export as *Collection v2.1* over the file. `__tests__/unit/recsys/postmanCollection.unit.test.ts` fails until the collection and the router match.
3. Add an integration test in `__tests__/integration/recsys/http.int.test.ts`.

---

## 7. Tests and checks

The repository machine is small: run Jest with `--maxWorkers=1`, one heavy command at a time.

| What | Command | Notes |
| --- | --- | --- |
| Unit tests | `npx jest __tests__/unit/recsys --maxWorkers=1` | Fast, no database |
| Integration tests | `npx jest __tests__/integration --maxWorkers=1` | In-memory MongoDB; several minutes |
| One suite | `npx jest __tests__/integration/recsys/hardening --maxWorkers=1` | |
| Lint (as CI) | `npx eslint src/recsys scripts __tests__/unit/recsys __tests__/integration __tests__/helpers` | |
| Types (as CI) | `bash scripts/ci/typecheck-recsys.sh` | Fails only on errors in recsys code, tests or scripts. The repo has older errors elsewhere |
| Offline evaluation | `npm run recsys:eval` | Ranker comparison on synthetic learners |
| HTTP walkthrough | `npm run recsys:sandbox -- --walkthrough` | 19 checks |
| Postman collection | sandbox running, then the newman command from section 1 | 35 requests, 70 assertions |

`__tests__/setup.ts` sets `RECSYS_EXPLORE_PCT=0`, so lists in tests are deterministic. Tests that exercise exploration set it themselves. CI runs the job *Recommendation platform (lint, types, tests)* on every push to a feature branch and on pull requests to `main`.

---

## 8. Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| List is always `cold_start` | `personalization` consent is off, or no events have gone through the ETL yet | `GET /privacy/consent`; `GET /admin/recsys/pipeline` for the last runs. Locally, wait for the 2-minute tick or use the sandbox `tick` |
| New events don't change the list | ETL runs every 2 minutes and the response cache lasts 2 minutes | Wait for the next tick, then `refresh=true` |
| `droppedNoConsent` > 0 | `analytics` consent is off | Expected. Ask for consent in the UI |
| `rejected: type … is server-only` | The client sent an event the server emits itself | Remove it from the client |
| `rejected: occurredAt out of accepted window` | Device clock is wrong, or the event is more than 7 days old | Send with the device time; drop old offline events |
| `rejected: recId/item was not served to this user` or `attributed: false` | `recId`, `itemType` or `itemRef` don't come from the same list, or the list is more than 30 days old | Keep each list's `recId` with its items |
| An item never appears | Guardrails: dismissed (14 days), shown 3 times in 7 days without a click, completion cooldown, level gap over 1 CEFR step, at most 2 per type and per skill, time budget | `reason`/`evidence` on the items that do appear; `recsys_exposure` for that learner |
| Same request, different list | The exploration slot (10 % of requests by default) or a different A/B arm | Locally `RECSYS_EXPLORE_PCT=0`; pin the arm with `RECSYS_FORCE_VARIANT` |
| `429 Too many requests` | Per-user rate limit (section 3) | Wait, or use another learner. The sandbox collection uses a new learner on every run |
| Health is `degraded` or `down` | Pipeline lag, failed runs or stale features | `GET /admin/recsys/health` lists the problems; `06-operations.md` has the runbook |

Every setting, with its default and effect, is in `.env.example` (section *Recommendation platform*) and `src/recsys/config.ts`.
