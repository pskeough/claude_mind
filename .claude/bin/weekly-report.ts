/**
 * weekly-report.ts — synthesis P6: the weekly rollup. Synthesis over loops that
 * already run; NO new collectors, and CLAIMS DISCIPLINE: every number in the
 * report is computed directly from a ledger the reader can open (session ledger,
 * decisions.jsonl, hindsight.jsonl, rule proposals, git log). Nothing is stated
 * that has no row behind it.
 *
 * Sections: what moved (sessions by project), memory scorecard (gate behavior +
 * hindsight grades), voice signal, vault changes (git). Renderer is neutral
 * prose; the own-voice mimesis render is a config choice wired later
 * (reports.voice), per the opt-in design.
 *
 *   npx tsx .claude/bin/weekly-report.ts [--days 7] [--out <file>]
 * Output: .claude/memory/reports/weekly-<date>.md (also printed).
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { vaultRoot, memDir } from "./config";

const VAULT = vaultRoot();
const argv = process.argv.slice(2);
const argOf = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const DAYS = Number(argOf("--days") || 7);
const since = new Date(Date.now() - DAYS * 86_400_000);
const sinceIso = since.toISOString();

function readJsonl(file: string): any[] {
  try { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}
const p50 = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };

// ---- sessions (what moved) ----------------------------------------------------
// The ledger logs one row per CAPTURE EVENT (sweeps re-capture growing sessions),
// so dedupe by sessionId keeping the latest row. Wall-clock "hours" are NOT
// reported: long-lived idle sessions make duration sums exceed the week (first
// run of this report claimed 2848h/7d) — transcript line count is the honest
// activity proxy.
const rawLedger = readJsonl(path.join(VAULT, "journal", "_sessions.jsonl")).filter(r => r.at >= sinceIso);
const bySession = new Map<string, any>();
for (const r of rawLedger) bySession.set(String(r.sessionId || r.at), r); // later rows overwrite = latest capture wins
const ledger = [...bySession.values()];
// Micro-sessions (< 20 transcript lines) are mostly `claude -p` automation
// (judges, evals) swept into the ledger — counted separately so they don't
// masquerade as working sessions.
const MICRO_LINES = 20;
const byProject = new Map<string, { sessions: number; micro: number; lines: number; titles: string[] }>();
for (const r of ledger) {
  const proj = String(r.project || "unknown");
  const e = byProject.get(proj) || { sessions: 0, micro: 0, lines: 0, titles: [] };
  const lc = Number(r.lineCount) || 0;
  if (lc < MICRO_LINES) e.micro++; else {
    e.sessions++;
    if (r.title) e.titles.push(String(r.title).replace(/\s+/g, " ").slice(0, 80));
  }
  e.lines += lc;
  byProject.set(proj, e);
}
const projects = [...byProject.entries()].sort((a, b) => b[1].lines - a[1].lines);

// ---- gate scorecard -----------------------------------------------------------
const decisions = readJsonl(path.join(VAULT, ".claude", "logs", "decisions.jsonl")).filter(r => r.ts >= sinceIso);
const injects = decisions.filter(r => r.inject);
const latencies = decisions.map(r => Number(r.ms)).filter(Number.isFinite);
const profiles = new Map<string, number>();
for (const r of decisions) profiles.set(r.profile || "full", (profiles.get(r.profile || "full") || 0) + 1);

// ---- hindsight grades ---------------------------------------------------------
const hind = readJsonl(path.join(memDir(), "hindsight.jsonl")).filter(r => r.ts >= sinceIso);
const grades = { USED: 0, IGNORED: 0, HARMFUL: 0 } as Record<string, number>;
for (const r of hind) if (r.grade in grades) grades[r.grade]!++;

// ---- voice signal -------------------------------------------------------------
const ruleProps = readJsonl(path.join(memDir(), "voice-rule-proposals.jsonl")).filter(r => r.ts >= sinceIso);
const minedLedger = (() => { try { return JSON.parse(fs.readFileSync(path.join(memDir(), "preference_mined.json"), "utf8")).keys.length; } catch { return 0; } })();

// ---- vault git activity -------------------------------------------------------
let commits: string[] = [];
try {
  commits = execFileSync("git", ["log", `--since=${DAYS} days ago`, "--pretty=format:%s"], { cwd: VAULT, encoding: "utf8" })
    .split("\n").filter(Boolean);
} catch { /* not fatal */ }
const nonBackup = commits.filter(c => !/^nightly backup/.test(c));

// ---- render -------------------------------------------------------------------
const stamp = new Date().toISOString().slice(0, 10);
const lines: string[] = [];
lines.push(`# Weekly report — ${stamp} (last ${DAYS} days)`);
lines.push("");
lines.push("## What moved");
if (!projects.length) lines.push("No captured sessions in the window.");
for (const [proj, e] of projects.slice(0, 10)) {
  lines.push(`- **${proj}**: ${e.sessions} working session(s)${e.micro ? ` (+${e.micro} automation/micro)` : ""}, ${e.lines.toLocaleString()} transcript lines. ${e.titles[0] ? `Latest: "${e.titles[e.titles.length - 1]}"` : ""}`);
}
const stale = projects.length > 10 ? projects.length - 10 : 0;
if (stale) lines.push(`- (+${stale} more projects with less activity — full list in journal/_sessions.jsonl)`);
lines.push("");
lines.push("## Memory scorecard");
lines.push(`- Gate calls: ${decisions.length}; injected on ${injects.length} (${decisions.length ? Math.round(100 * injects.length / decisions.length) : 0}%). Latency p50 ${p50(latencies)}ms.`);
if (profiles.size > 1) lines.push(`- Profiles: ${[...profiles.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}.`);
if (hind.length) {
  lines.push(`- Hindsight graded ${hind.length} injection(s): ${grades.USED} used, ${grades.IGNORED} ignored, ${grades.HARMFUL} harmful.`);
  if (grades.HARMFUL > 0) lines.push(`  - HARMFUL grades need a look: see ${path.relative(VAULT, path.join(memDir(), "hindsight.jsonl"))} / HINDSIGHT_REPORT.md.`);
} else lines.push("- No hindsight grades in the window.");
lines.push("");
lines.push("## Voice signal");
lines.push(`- Mined preference chains to date: ${minedLedger}. New stylistic rule proposals this window: ${ruleProps.length}.`);
if (ruleProps.length) for (const r of ruleProps.slice(0, 5)) lines.push(`  - [${r.voice}] "${String(r.feedback).slice(0, 90)}"`);
lines.push("");
lines.push("## Vault changes");
lines.push(`- ${commits.length} commit(s)${nonBackup.length ? `, ${nonBackup.length} beyond nightly backups: ${nonBackup.slice(0, 5).join("; ").slice(0, 200)}` : " (nightly backups only)"}.`);
lines.push("");
lines.push(`*Every number above is computed from its ledger (sessions: journal/_sessions.jsonl; gate: .claude/logs/decisions.jsonl; grades: .claude/memory/hindsight.jsonl; git log). Generated by weekly-report.ts.*`);

const out = lines.join("\n") + "\n";
const outFile = argOf("--out") || path.join(memDir(), "reports", `weekly-${stamp}.md`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out);
console.log(out);
console.log(`saved: ${outFile}`);
