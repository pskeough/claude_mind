/**
 * LKHS rehearsal packs (P9, LKHS-V2-UPGRADE-PATH.md): preparation, not reaction.
 *
 * For the top active lanes in state.json, pre-assemble the context Patrick would
 * otherwise reconstruct on session open: exact stopping point (last journal entry's
 * open threads), pending reconcile proposals touching the project, and prospective
 * intentions waiting on it. Deterministic assembly, no LLM. The SessionStart
 * project-card hook already injects the L2 card, so packs deliberately EXCLUDE the
 * card body and carry only the delta: where you stopped, what is pending, what fires.
 *
 * Output: .claude/memory/rehearsal/<project>.md, injected by lkhs-project-card.ps1
 * when fresh (<48h). Runs nightly in lkhs-refresh after state-rollup.
 *
 *   npm run rehearsal          (add --top N, default 3)
 */
import * as fs from "fs";
import * as path from "path";
import { vaultRoot, memDir } from "./config";

const VAULT = vaultRoot();
const MEM = memDir();
const OUT_DIR = path.join(MEM, "rehearsal");
const LOG_FILE = path.join(VAULT, ".claude", "logs", "ambient.log");
const TOP = Number((() => { const i = process.argv.indexOf("--top"); return i >= 0 ? process.argv[i + 1] : "3"; })());

function log(m: string): void {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] rehearsal:${m}\n`); } catch { /* */ }
  console.log(m);
}

function lastJournalSections(project: string, n = 2): string[] {
  try {
    const content = fs.readFileSync(path.join(VAULT, "journal", `${project}.md`), "utf-8");
    return content.split(/^## (?=\d{4}-)/m).slice(1).slice(-n).map(s => ("## " + s).trim().slice(0, 1600));
  } catch { return []; }
}

function jsonlRows(file: string): any[] {
  try {
    return fs.readFileSync(file, "utf-8").split("\n").filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

async function main() {
  let state: any;
  try { state = JSON.parse(fs.readFileSync(path.join(MEM, "state.json"), "utf-8")); } catch { log("no state.json; run npm run state first"); return; }
  const lanes = (state.lanes || []).filter((l: any) => l.status === "active" || l.lastActive).slice(0, TOP);
  if (!lanes.length) { log("no active lanes"); return; }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const proposals = jsonlRows(path.join(MEM, "reconcile-proposals.jsonl")).filter(r => r.status === "pending");
  const intentions = jsonlRows(path.join(MEM, "prospective.jsonl")).filter(r => !r.fired_at);

  let built = 0;
  for (const lane of lanes) {
    const project: string = lane.project;
    if (!project) continue;
    const pl = project.toLowerCase();
    const sections = lastJournalSections(project);
    const myProposals = proposals.filter(p => (p.detail || "").toLowerCase().includes(pl)).slice(0, 4);
    const myIntentions = intentions.filter(i =>
      (i.when?.type === "project" && project.toLowerCase().includes(String(i.when.value).toLowerCase())) ||
      (i.note || "").toLowerCase().includes(pl)).slice(0, 4);

    const L: string[] = [];
    L.push(`<!-- rehearsal pack, generated ${new Date().toISOString()} by build-rehearsal.ts -->`);
    L.push(`# ${project} - rehearsal pack (delta over the state card)`);
    if (lane.nextStep) L.push(`\n**Declared next step:** ${lane.nextStep}`);
    if (sections.length) { L.push(`\n## Where the last sessions stopped`); L.push(sections.join("\n\n")); }
    if (myProposals.length) { L.push(`\n## Pending memory proposals touching this project`); for (const p of myProposals) L.push(`- [${p.type}] ${String(p.detail).slice(0, 160)}`); }
    if (myIntentions.length) { L.push(`\n## Intentions waiting on this project`); for (const i of myIntentions) L.push(`- [${i.when.type}:${i.when.value}] ${i.note}`); }
    if (L.length <= 2) continue;
    fs.writeFileSync(path.join(OUT_DIR, `${project}.md`), L.join("\n") + "\n", "utf-8");
    built++;
  }
  log(`built ${built} rehearsal pack(s): ${lanes.map((l: any) => l.project).join(", ")}`);
}

main().catch(e => { log(`fatal ${e.message}`); process.exit(1); });
