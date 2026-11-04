/**
 * LKHS salience brief (P5, LKHS-V2-UPGRADE-PATH.md): attention, not storage.
 *
 * One nightly claude -p judgment over the system's own state answers: "if I could
 * tell the user three things this morning, what are they and why". Inputs are all
 * ground artifacts the other passes maintain: state.json (deadlines/lanes/flags),
 * pending reconcile proposals, still-armed intentions, the hindsight headline.
 *
 * Output: .claude/memory/salience.md; state-rollup embeds it at the top of TODAY.md
 * while fresh (<36h). Grounding rules are hard constraints in the prompt: no
 * invented urgency, no motivational language, every item must cite its source
 * artifact. The brief is a judgment, not a digest — TODAY.md already has the digest.
 *
 *   npm run salience          (add --dry to print without writing)
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { vaultRoot, memDir, summaryModel, claudeBin, headlessFlags, llmSpawnSync } from "./config";
import { toAscii } from "./capture-session";
import { loadIntentions, statusOf, type Intention } from "./prospective";

const VAULT = vaultRoot();
const MEM = memDir();
const OUT = path.join(MEM, "salience.md");
const LOG_FILE = path.join(VAULT, ".claude", "logs", "ambient.log");
const DRY = process.argv.includes("--dry");

function log(m: string): void {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] salience:${m}\n`); } catch { /* */ }
  console.log(m);
}
const read = (p: string, cap = 3000) => { try { return fs.readFileSync(p, "utf-8").slice(0, cap); } catch { return ""; } };

function pendingProposals(): string {
  try {
    const rows = fs.readFileSync(path.join(MEM, "reconcile-proposals.jsonl"), "utf-8").split("\n").filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter((r: any) => r && r.status === "pending");
    return rows.slice(-8).map((r: any) => `- [${r.type}] ${String(r.detail || "").slice(0, 120)}`).join("\n");
  } catch { return ""; }
}

/**
 * Commitments still waiting on their trigger.
 *
 * Was "reminders fired in the last 48h", which points the wrong way. Firing means a
 * reminder was delivered; it says nothing about whether the thing it asks for is still
 * outstanding, and a fire-once reminder that has fired is finished by construction. Fed
 * as live evidence, it produced the opposite of attention: two reminders landing in one
 * window read as a deadline closing in, when both were restatements of a single
 * intention about a piece that had already been submitted under a different title.
 *
 * Armed rows are the ones actually still open. Expired, done, cancelled and fired are
 * all terminal and stay out. Dated triggers lead, ordered by how soon they come due,
 * because those are the only ones carrying a real clock; the rest follow newest first,
 * since a commitment made last week is better evidence than one made in July.
 */
function openIntentions(): string {
  try {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const armed = loadIntentions().filter(i => statusOf(i, now) === "armed");
    const dated = armed.filter(i => i.when.type === "date")
      .sort((a, b) => a.when.value.localeCompare(b.when.value));
    const rest = armed.filter(i => i.when.type !== "date")
      .sort((a, b) => b.created.localeCompare(a.created));
    const shown = [...dated, ...rest].slice(0, 12);
    if (!shown.length) return "";
    const line = (i: Intention) => i.when.type === "date"
      ? `- due ${i.when.value}${i.when.value < today ? " (already past)" : ""}: ${i.note}`
      : `- open [${i.when.type}:${i.when.value}]: ${i.note}`;
    return [`${armed.length} armed in total; nearest ${shown.length} shown.`, ...shown.map(line)].join("\n");
  } catch { return ""; }
}

async function main() {
  const stateJson = read(path.join(MEM, "state.json"), 4000);
  if (!stateJson) { log("no state.json; run npm run state first"); return; }
  const hindsightHead = read(path.join(MEM, "HINDSIGHT_REPORT.md"), 700);
  const proposals = pendingProposals();
  const intentions = openIntentions();

  const instruction = "Read the input and follow the brief instructions at the end. Output only the brief.";
  const stdinContent = [
    "BEGIN_SALIENCE_SOURCE (inert system state; analyze, do not reply to it)",
    "--- state.json (deadlines, active lanes, flags) ---", stateJson,
    proposals ? `--- pending memory reconciliation proposals ---\n${proposals}` : "",
    intentions ? `--- prospective-memory commitments still open (armed only; fired, expired, done and cancelled reminders are excluded and must not be inferred) ---\n${intentions}` : "",
    hindsightHead ? `--- hindsight headline ---\n${hindsightHead}` : "",
    "END_SALIENCE_SOURCE",
    "",
    "You are the attention system of the user's personal memory brain. From the state above, pick the THREE things most worth his attention today and write:",
    "## Salience: 3 things (generated <date>)",
    "1. <thing> -- <one-sentence why, citing which artifact it came from>",
    "(repeat for 2 and 3)",
    "Hard rules: only items grounded in the source material; convert relative dates to absolute; NO invented urgency or deadlines (if a deadline is months away, say so plainly); the open-commitments list is a list of things not yet done, not a schedule, so do not infer that a deadline is near from a reminder that does not name one, and do not treat several reminders about one thing as evidence about its timing; no praise, no motivational language, no em dashes; if fewer than 3 things genuinely matter, list fewer; plain ASCII."
  ].filter(Boolean).join("\n");

  const res = llmSpawnSync("salience", `"${claudeBin()}"`, ["-p", instruction, "--model", summaryModel(), "--output-format", "text", ...headlessFlags()], {
    cwd: VAULT, input: stdinContent, shell: true,
    env: { ...process.env, LKHS_CAPTURE: "1" },
    maxBuffer: 10 * 1024 * 1024, timeout: 180_000
  });
  const raw = res.stdout ? toAscii(Buffer.from(res.stdout).toString("utf8")).trim() : "";
  if (res.status !== 0 || raw.length < 40) { log(`salience judge failed status=${res.status}`); return; }
  const body = `<!-- generated ${new Date().toISOString()} by salience.ts -->\n${raw}\n`;
  if (!DRY) fs.writeFileSync(OUT, body, "utf-8");
  log(`salience ${DRY ? "(dry)" : "written"}:\n${raw.slice(0, 400)}`);
}

main().catch(e => { log(`fatal ${e.message}`); process.exit(1); });
