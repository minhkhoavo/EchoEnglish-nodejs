// Phase 3 (Scale): stream + warehouse + dbt + learning loop. All flag-gated, dormant by default.
import { writeFileSync } from "node:fs";
import { Diagram, icon, box, stage, band, endpoint, phantom, frame, renderTree } from "drawio-ai-kit";

const d = new Diagram("pipeline");

const src = stage("a", 0, "Source of truth", [
  icon("silver", "mongodb", "learning_events_clean\nsilver (MongoDB)"),
  box("tomb", "Erasure tombstones\npseudonym · no TTL"),
]);
const exp = stage("b", 1, "Exporter (cron 1 min)", [
  box("gate", "Gates: analytics consent ·\ntombstone · region lookup"),
  box("pseudo", "HMAC-SHA256(salt,\nregion:userId)[:32]\nfails closed without salt"),
  box("cursor", "Cursor on silver _id\nadvance only after broker ack"),
]);
const bus = stage("c", 2, "Redpanda v25.2.1", [
  icon("topic", "kafka", "echo.learning_events.v1.<region>\nretention 168 h"),
]);
const load = stage("d", 3, "Loader (own process)", [
  box("parse", "Validate · drop foreign-region\nand erased events"),
  box("commit", "Insert, then commit offsets\nat-least-once"),
  box("sweep", "Erase sweep every minute\nretries warehousePending"),
]);
const wh = stage("e", 4, "ClickHouse 25.8", [
  icon("ch", "clickhouse", "events\nReplacingMergeTree(event_id)"),
  icon("dbt", "dbt", "dbt: stg_events → learner_daily_facts\n12 tests"),
]);
const kpi = stage("f", 5, "Analytics", [
  box("kpi", "KpiService\nRECSYS_ANALYTICS_BACKEND\nclickhouse | mongo"),
  box("fb", "Fallback to Mongo\nreports fallbackReason"),
]);

const learn = band("learn", "Learning loop (weekly retrain, guard daily)", [
  box("imp", "rec_impression + rec_click\njoin (recId, itemType, itemRef)"),
  box("snap", "Feature snapshots\nas-of join, never future\nmax age 72 h"),
  box("train", "trainRanker: IRLS ridge logistic\nuser-level 80/20 split\nposition = training covariate"),
  box("reg", "rec_models registry\nrejected → candidate →\nactive ≤ 5 % → retired"),
  box("guardm", "Harm guard\nz ≤ −1.96, ≥ 1000 imps\n→ auto-retire"),
  box("embed", "Embeddings (offline)\nsemantic signal, weight 0\nthreshold uncalibrated"),
]);

const tree = phantom("root", "", { dir: "col", gap: 34, align: "center", header: 0, pad: 10 }, [
  phantom("chain", "", { dir: "row", gap: 40, align: "top", header: 0 }, [src, exp, bus, load, wh, kpi]),
  learn,
]);
renderTree(d, tree, [40, 80]);
d.title("Phase 3 (Scale) — stream, warehouse, dbt and learning loop (flag-gated, dormant)");

d.link("a", "b", "export", { flow: true });
d.link("b", "c", "produce", { flow: true });
d.link("c", "d", "consume", { flow: true });
d.link("d", "e", "insert", { flow: true });
d.link("e", "f", "marts", { flow: true });
d.link("imp", "snap", "");
d.link("snap", "train", "");
d.link("train", "reg", "");
d.link("reg", "guardm", "", { dash: true });

const res = d.validate();
console.log("VALIDATE:", JSON.stringify({ ok: res.ok, errors: res.errors, warnings: res.warnings, advice: res.audit.advice }));
writeFileSync(new URL("./03-phase3.drawio", import.meta.url), d.mxfile("Phase 3 scale"));

import { execFileSync as __exec } from "node:child_process";
const __cli = (a) => process.env.DRAWIO_AI_CLI
  ? __exec(process.execPath, [process.env.DRAWIO_AI_CLI, ...a], { encoding: "utf8" })
  : __exec("drawio-ai", a, { encoding: "utf8" });
const __f = new URL("./03-phase3.drawio", import.meta.url).pathname;
try {
  console.log(__cli(["render", __f, "--check", "-o", __f + ".png"]).trim());
} catch (e) { console.error("RENDER-SKIPPED:", String(e.message).split("\n")[0]); }
