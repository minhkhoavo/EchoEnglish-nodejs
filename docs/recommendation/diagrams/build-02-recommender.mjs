// Recommender: one GET /recommendations request, left to right. No x/y numbers.
import { writeFileSync } from "node:fs";
import { Diagram, box, stage, endpoint, phantom, renderTree } from "drawio-ai-kit";

const d = new Diagram("pipeline");

const entry = stage("s0", 0, "1 · Request", [
  box("auth", "JWT principal\n401 if missing"),
  box("cache", "Cache per user + limit\n120 s · refresh=true bypasses"),
  box("consent", "Consent check\npersonalization granted?"),
]);
const load = stage("s1", 1, "2 · Load context (RecDeps)", [
  box("feat", "learner_features\n+ profile (level, interests,\nminutes/day)"),
  box("res", "Resources ≤ 300\nrecent + interest domains"),
  box("exp", "Exposure map (30 d)\nshown · clicked · dismissed"),
  box("pop", "Popularity 30 d\nlog-scaled · cached"),
]);
const cand = stage("s2", 2, "3 · Candidates", [
  box("mode", "decideMode\ncold_start unless a skill\nhas ≥ 3 attempts"),
  box("srs", "SRS block ≤ 20 cards\nurgency + retention risk"),
  box("drill", "skill_drill\nweak: mastery < 0.8 · explore"),
  box("rsrc", "Resources by tag, interest,\nCEFR fit, popularity,\nsemantic similarity (opt.)"),
  box("habit", "Habits: mini test · speech ·\nvocab · starter diagnostic"),
]);
const rank = stage("s3", 3, "4 · Rank + guardrails", [
  box("var", "Variant: control · srs_heavy\nlearned layer ≤ 5 % (admin ≤ 50 %)\nRECSYS_FORCE_VARIANT wins"),
  box("score", "score = Σ w·signal + boost\n− recency − completed"),
  box("guard", "Dismissed 14 d · cap 3/7 d ·\ncooldowns · CEFR gap ≤ 1\n≤ 2 per type/skill · budget 1.25×"),
]);
const out = stage("s4", 4, "5 · Explain + respond", [
  box("why", "Reason code + params\nEN / VI templates\nno LLM"),
  box("resp", "Response: recId, mode, variant,\nitems[rank, type, ref, action]\nsignals never sent to clients"),
  box("log", "Impressions: exposure store (always)\nrec_impression event (if analytics\nconsent) incl. ranking signals"),
]);

const tree = phantom("root", "", { dir: "row", gap: 46, align: "top", header: 0, pad: 10 }, [
  endpoint("client", "CLIENT\nGET /recommendations\n?limit=&refresh="),
  entry, load, cand, rank, out,
]);
renderTree(d, tree, [40, 80]);
d.title("Recommender — request flow (src/recsys/engine)");

d.link("client", "s0", "request");
d.link("s0", "s1", "miss", { flow: true });
d.link("s1", "s2", "RecContext", { flow: true });
d.link("s2", "s3", "candidates", { flow: true });
d.link("s3", "s4", "selected items", { flow: true });
d.link("s4", "client", "list + impressions", { dash: true, rail: "bottom" });

const res = d.validate();
console.log("VALIDATE:", JSON.stringify({ ok: res.ok, errors: res.errors, warnings: res.warnings, advice: res.audit.advice }));
writeFileSync(new URL("./02-recommender.drawio", import.meta.url), d.mxfile("Recommender request flow"));

import { execFileSync as __exec } from "node:child_process";
const __cli = (a) => process.env.DRAWIO_AI_CLI
  ? __exec(process.execPath, [process.env.DRAWIO_AI_CLI, ...a], { encoding: "utf8" })
  : __exec("drawio-ai", a, { encoding: "utf8" });
const __f = new URL("./02-recommender.drawio", import.meta.url).pathname;
try {
  console.log(__cli(["render", __f, "--check", "-o", __f + ".png"]).trim());
} catch (e) { console.error("RENDER-SKIPPED:", String(e.message).split("\n")[0]); }
