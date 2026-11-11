// Data-subject erasure across every copy of a learner's data (BPMN swimlane).
import { writeFileSync } from "node:fs";
import { Diagram, renderTree, pool, start, end, gateway, userTask, serviceTask } from "drawio-ai-kit";

const d = new Diagram("bpmn");

const proc = pool("erase", "Erasure — DELETE /privacy/data", {
  lanes: ["Learner", "API", "MongoDB", "Stream / ClickHouse"],
  phases: ["Request", "Tombstone + Mongo", "Warehouse", "Report"],
}, [
  start("s1", { lane: 0, col: 0, label: "Requests erasure" }),
  serviceTask("t1", { lane: 1, col: 1, label: "Auth + rate limit 3/h" }),
  serviceTask("t2", { lane: 2, col: 2, label: "Tombstone every region" }),
  serviceTask("t3", { lane: 2, col: 3, label: "Delete Mongo layers" }),
  serviceTask("t4", { lane: 3, col: 4, label: "ClickHouse DELETE by pseudonym" }),
  gateway("g1", { lane: 3, col: 5, label: "Delete ok?" }),
  serviceTask("t5", { lane: 3, col: 6, label: "Mark warehousePending" }),
  serviceTask("t6", { lane: 1, col: 7, label: "Respond with downstream status" }),
  end("e1", { lane: 0, col: 8, label: "Erased + consent withdrawn" }),
]);

renderTree(d, proc, [40, 80]);
d.title("Erasure reaches every copy — tombstones first, then Mongo, then warehouse");

d.link("s1", "t1", "", { flow: true, rounded: true });
d.link("t1", "t2", "", { flow: true, rounded: true });
d.link("t2", "t3", "", { flow: true, rounded: true });
d.link("t3", "t4", "", { flow: true, rounded: true });
d.link("t4", "g1", "", { flow: true, rounded: true });
d.link("g1", "t6", "deleted", { flow: true, rounded: true });
d.link("g1", "t5", "failed", { rounded: true });
d.link("t5", "t6", "loader retries", { rounded: true });
d.link("t6", "e1", "", { flow: true, rounded: true });

const res = d.validate();
console.log("VALIDATE:", JSON.stringify({ ok: res.ok, errors: res.errors, warnings: res.warnings, advice: res.audit.advice }));
writeFileSync(new URL("./04-erasure.drawio", import.meta.url), d.mxfile("Erasure and consent process"));

import { execFileSync as __exec } from "node:child_process";
const __cli = (a) => process.env.DRAWIO_AI_CLI
  ? __exec(process.execPath, [process.env.DRAWIO_AI_CLI, ...a], { encoding: "utf8" })
  : __exec("drawio-ai", a, { encoding: "utf8" });
const __f = new URL("./04-erasure.drawio", import.meta.url).pathname;
try {
  console.log(__cli(["render", __f, "--check", "-o", __f + ".png"]).trim());
} catch (e) { console.error("RENDER-SKIPPED:", String(e.message).split("\n")[0]); }
