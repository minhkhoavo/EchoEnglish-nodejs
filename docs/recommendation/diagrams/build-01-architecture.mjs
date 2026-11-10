// EchoEnglish recommendation platform — system architecture (MVP loop). Layout engine only: no x/y numbers.
import { writeFileSync } from "node:fs";
import { Diagram, icon, box, stage, band, endpoint, phantom, grid, frame, renderTree } from "drawio-ai-kit";

const d = new Diagram("pipeline");

const ingest = stage("ing", 0, "1 · Collect", [
  box("ep", "POST /events/batch\nzod schema · allow-list\nconsent gate · 60 req/min"),
  box("emit", "emit() from services\nfail-safe, never throws\nserver-trusted events"),
]);

const lake = stage("lake", 1, "2 · Store & clean (MongoDB)", [
  icon("bronze", "mongodb", "learning_events\nbronze · unique eventId"),
  icon("silver", "mongodb", "learning_events_clean\nsilver · validated, deduped"),
  icon("gold", "mongodb", "learner_daily_facts\ngold · replace, never $inc"),
]);

const feat = stage("feat", 2, "3 · Features", [
  box("mastery", "skill_mastery\nElo / 1-PL ability θ per skill\ndecay τ = 60 d"),
  box("lf", "learner_features\nactivity · accuracy · SRS due\nbest hours · engagement"),
]);

const serve = stage("srv", 3, "4 · Recommend", [
  box("cand", "Candidates\nSRS · drills · resources · habits"),
  box("rank", "Ranker + guardrails\nweights · caps · cooldowns · budget"),
  box("expl", "Explain + A/B\nEN/VI templates · hash buckets"),
]);

const sched = frame("sched", "Scheduler (node-cron, every 2 min)", { dir: "col", gap: 8 }, [
  box("lease", "Mongo lease recsys_locks\none runner across instances"),
  box("dq", "Data-quality checks per run\nreject ≤ 5 % · lag ≤ 30 min"),
]);

const xcut = band("ops", "Privacy · Analytics · Operations (cross-cutting)", [
  box("consent", "Consent ledger\nanalytics · personalization · research\ndefault off"),
  box("dsr", "Export / erase\nGET /privacy/export\nDELETE /privacy/data"),
  box("kpi", "KPIs + experiments\n/admin/recsys/kpis\n/admin/recsys/experiments"),
  box("health", "Health + runs\n/admin/recsys/health\n/admin/recsys/pipeline"),
]);

const tree = phantom("root", "", { dir: "col", gap: 30, align: "center", header: 0, pad: 10 }, [
  phantom("main", "", { dir: "row", gap: 50, align: "top", header: 0 }, [
    phantom("left", "", { dir: "col", gap: 24, header: 0 }, [
      endpoint("app", "LEARNER APPS\nweb · mobile\nGET /recommendations\nPOST /recommendations/feedback"),
      endpoint("svc", "EXISTING SERVICES\ntest submit · flashcards\ncredits · speech · AI calls"),
    ]),
    ingest,
    lake,
    feat,
    serve,
  ]),
  sched,
  xcut,
]);

renderTree(d, tree, [40, 80]);
d.title("EchoEnglish recommendation platform — system architecture (MVP closed loop)");

d.link("svc", "emit", "service events");
d.link("app", "ep", "behavioural events");
d.link("ing", "lake", "insert", { flow: true });
d.link("bronze", "silver", "ETL", { flow: true });
d.link("silver", "gold", "aggregate", { flow: true });
d.link("lake", "feat", "facts + answers", { flow: true });
d.link("feat", "srv", "features", { flow: true });
d.link("srv", "app", "ranked, explained list", { dash: true, rail: "bottom" });
d.link("sched", "lake", "drives ETL", { dash: true });

const res = d.validate();
console.log("VALIDATE:", JSON.stringify({ ok: res.ok, errors: res.errors, warnings: res.warnings, advice: res.audit.advice }));
writeFileSync(new URL("./01-architecture.drawio", import.meta.url), d.mxfile("EchoEnglish recommendation architecture"));

import { execFileSync as __exec } from "node:child_process";
const __cli = (a) => process.env.DRAWIO_AI_CLI
  ? __exec(process.execPath, [process.env.DRAWIO_AI_CLI, ...a], { encoding: "utf8" })
  : __exec("drawio-ai", a, { encoding: "utf8" });
const __f = new URL("./01-architecture.drawio", import.meta.url).pathname;
try {
  console.log(__cli(["render", __f, "--check", "-o", __f + ".png"]).trim());
} catch (e) { console.error("RENDER-SKIPPED:", String(e.message).split("\n")[0]); }
