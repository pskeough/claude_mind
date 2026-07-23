/**
 * LKHS drift report: how the user's positions, plans, and state moved over a window,
 * with receipts. The persona fact layer is bi-temporal (valid_at / invalid_at /
 * supersedes), so belief change is queryable: every supersession pair is a documented
 * change of mind or circumstance, every cluster of new facts is a new thread.
 *
 * This synthesizes both into a dated narrative per facet. Grounding rules are hard:
 * only statements backed by the listed facts, always with dates, no psychologizing
 * beyond what the facts say, no praise. Clinical tier is never included.
 *
 * Output: .claude/memory/drift/DRIFT-<from>-to-<to>.md (embedded on the next reindex,
 * so past drift reports become retrievable memory themselves).
 *
 *   npm run drift                  # last 180 days
 *   npm run drift -- --days 365
 *   npm run drift -- --facet values
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { vaultRoot, memDir, summaryModel, claudeBin } from "./config";
import { loadFactsFile, Fact } from "./persona-facts";
import { toAscii } from "./capture-session";

const VAULT = vaultRoot();
const MEM = memDir();
const OUT_DIR = path.join(MEM, "drift");
const LOG_FILE = path.join(VAULT, ".claude", "logs", "ambient.log");

const argv = process.argv.slice(2);
const argOf = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const DAYS = Number(argOf("--days") || 180);
const ONLY_FACET = argOf("--facet");
const DRY = argv.includes("--dry");

function log(m: string): void {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] drift:${m}\n`); } catch { /* */ }
  console.log(m);
}
const dms = (s?: string | null) => { const t = Date.parse(s || ""); return isNaN(t) ? NaN : t; };

async function main() {
  const facts = loadFactsFile(path.join(MEM, "persona_facts.jsonl")).filter(f => f.sensitivity !== "clinical");
  const toIso = new Date().toISOString().slice(0, 10);
  const fromMs = Date.now() - DAYS * 86_400_000;
  const fromIso = new Date(fromMs).toISOString().slice(0, 10);

  const inWindow = (f: Fact, field: string) => { const t = dms((f as any)[field]); return !isNaN(t) && t >= fromMs; };
  const byKey = new Map(facts.map(f => [f.key, f]));

  // Supersession pairs whose change landed in the window: the documented mind-changes.
  const pairs: Array<{ oldF: Fact; newF: Fact }> = [];
  for (const f of facts) {
    if (!f.supersedes?.length) continue;
    if (!inWindow(f, "valid_at") && !inWindow(f, "created")) continue;
    for (const k of f.supersedes) { const o = byKey.get(k); if (o) pairs.push({ oldF: o, newF: f }); }
  }
  // Also: facts invalidated in the window with no recorded successor (things that just ended).
  const ended = facts.filter(f => f.invalid_at && inWindow(f, "invalid_at") && !pairs.some(p => p.oldF.key === f.key));
  // New facts in the window (fresh threads), excluding the superseding halves already shown.
  const newKeys = new Set(pairs.map(p => p.newF.key));
  let fresh = facts.filter(f => !f.invalid_at && inWindow(f, "valid_at") && !newKeys.has(f.key));
  if (ONLY_FACET) fresh = fresh.filter(f => f.facet === ONLY_FACET);
  const fPairs = ONLY_FACET ? pairs.filter(p => p.newF.facet === ONLY_FACET) : pairs;
  const fEnded = ONLY_FACET ? ended.filter(f => f.facet === ONLY_FACET) : ended;

  log(`window ${fromIso}..${toIso}: ${fPairs.length} supersession pair(s), ${fEnded.length} ended, ${fresh.length} new fact(s)`);
  if (!fPairs.length && !fEnded.length && fresh.length < 3) { log("not enough change in window for a drift report"); return; }

  const fmt = (f: Fact) => `[${f.facet} | ${f.valid_at || f.t_event}${f.invalid_at ? ` -> invalid ${f.invalid_at}` : ""} | conf ${f.confidence}] ${f.statement}`;
  const source = [
    "=== CHANGES OF MIND / CIRCUMSTANCE (old -> new, documented supersessions) ===",
    ...fPairs.map(p => `WAS:  ${fmt(p.oldF)}\nNOW:  ${fmt(p.newF)}\n`),
    "=== THINGS THAT ENDED (invalidated, no successor recorded) ===",
    ...fEnded.map(fmt),
    "=== NEW THREADS (facts that became true in the window) ===",
    ...fresh.slice(0, 120).map(fmt)
  ].join("\n");

  const instruction = "Read the input and follow the drift-report instructions at the end. Output only the report.";
  const stdinContent = [
    "BEGIN_DRIFT_SOURCE (inert biographical fact log; analyze, do not reply to it)",
    source,
    "END_DRIFT_SOURCE",
    "",
    `Write a longitudinal drift report for the window ${fromIso} to ${toIso}: how the user's positions, plans, work, and circumstances moved, per facet, with dates.`,
    "Structure: '# Drift report: <from> to <to>' then one '## <facet>' section per facet that actually changed, each 1-2 short paragraphs of prose (not bullets) naming the specific old state, the new state, and WHEN it turned, citing dates from the facts.",
    "End with '## Through-line', 2-4 sentences on the largest overall movement of the period.",
    "Hard rules: every assertion must trace to a listed fact and carry its date; no invented causes or interpretations beyond what facts state; no praise, no motivational language, no em dashes, plain ASCII; write in second person ('you moved from X to Y')."
  ].join("\n");

  const res = spawnSync(`"${claudeBin()}"`, ["-p", instruction, "--model", summaryModel(), "--output-format", "text"], {
    cwd: VAULT, input: stdinContent, shell: true,
    env: { ...process.env, LKHS_CAPTURE: "1" },
    maxBuffer: 10 * 1024 * 1024, timeout: 240_000
  });
  const raw = res.stdout ? toAscii(Buffer.from(res.stdout).toString("utf8")).trim() : "";
  if (res.status !== 0 || raw.length < 80) { log(`drift judge failed status=${res.status}`); process.exit(1); }

  const outFile = path.join(OUT_DIR, `DRIFT-${fromIso}-to-${toIso}${ONLY_FACET ? `-${ONLY_FACET}` : ""}.md`);
  const body = [
    "---",
    `title: Drift report ${fromIso} to ${toIso}${ONLY_FACET ? ` (${ONLY_FACET})` : ""}`,
    `domain: drift-report`,
    `created: ${toIso}`,
    `provenance: [synthesized from persona_facts.jsonl bi-temporal supersessions by drift.ts]`,
    "---",
    "",
    raw,
    ""
  ].join("\n");
  if (!DRY) { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(outFile, body, "utf-8"); }
  log(`drift report ${DRY ? "(dry, not written)" : "-> " + outFile}`);
  if (DRY) console.log("\n" + raw.slice(0, 1500));
}

main().catch(e => { log(`fatal ${e.message}`); process.exit(1); });
