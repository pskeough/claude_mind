/**
 * Skill-router utilization report.
 *
 * The router already logged every fire to ambient.log as prose, which made "is this
 * skill ever actually used" a grep rather than a measurement. logDecision now carries
 * a `skills` field, so fires join to the same ph/profile/timestamp spine as every other
 * gate decision. This reads that spine.
 *
 * The load-bearing column is not fire count, it is the DEAD list: a skill installed on
 * disk that has never once cleared the floor is costing description tokens in every
 * session and buying nothing. Same logic as lesson eviction — scarcity is the quality
 * mechanism, so an unused entry should be pruned or its description rewritten, not left
 * to sit. A skill added in the last few days has simply not had its moment yet; the
 * `first seen` line is there so recency is not mistaken for uselessness.
 *
 *   npm run skills:usage            all history
 *   npm run skills:usage -- --days 30
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { vaultRoot } from "./config";

const DECISIONS = path.join(vaultRoot(), ".claude", "logs", "decisions.jsonl");

interface Fire { name: string; score: number; ts: string }

function skillsOnDisk(): string[] {
  const dirs = [
    path.join(vaultRoot(), ".claude", "skills"),
    path.join(os.homedir(), ".claude", "skills"),
  ];
  const names: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      if (fs.existsSync(path.join(dir, sub.name, "SKILL.md"))) names.push(sub.name);
    }
  }
  return [...new Set(names)].sort();
}

function main() {
  const argv = process.argv.slice(2);
  const di = argv.indexOf("--days");
  const days = di >= 0 ? Number(argv[di + 1]) : null;
  const cutoff = days ? Date.now() - days * 86_400_000 : 0;

  if (!fs.existsSync(DECISIONS)) { console.error(`no decisions log at ${DECISIONS}`); process.exit(1); }

  const fires: Fire[] = [];
  let gateCalls = 0, gatesWithSkill = 0, earliest = "";
  for (const line of fs.readFileSync(DECISIONS, "utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    if (cutoff && new Date(rec.ts).getTime() < cutoff) continue;
    gateCalls++;
    if (!earliest) earliest = rec.ts;
    if (!Array.isArray(rec.skills) || !rec.skills.length) continue;
    gatesWithSkill++;
    for (const s of rec.skills) fires.push({ name: s.n, score: s.s, ts: rec.ts });
  }

  const by = new Map<string, Fire[]>();
  for (const f of fires) { const a = by.get(f.name) ?? []; a.push(f); by.set(f.name, a); }

  const window = days ? `last ${days}d` : "all history";
  console.log(`skill router utilization (${window})`);
  console.log(`  gate calls: ${gateCalls}   with a suggestion: ${gatesWithSkill}` +
    (gateCalls ? ` (${(100 * gatesWithSkill / gateCalls).toFixed(1)}%)` : ""));
  console.log(`  window starts: ${earliest || "n/a"}\n`);

  if (by.size) {
    console.log("  fires  med.score  last fired            skill");
    [...by.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([name, fs_]) => {
      const scores = fs_.map(f => f.score).sort((a, b) => a - b);
      const med = scores[Math.floor(scores.length / 2)]!;
      const last = fs_.map(f => f.ts).sort().at(-1)!.slice(0, 16).replace("T", " ");
      console.log(`  ${String(fs_.length).padStart(5)}  ${med.toFixed(3).padStart(9)}  ${last}     ${name}`);
    });
  } else {
    console.log("  no skill suggestions recorded in this window.");
  }

  // The `skills` field was added to logDecision on 2026-08-11; records written before
  // that have no field at all, so "never fired" over a longer window than the field has
  // existed will over-report. Prefer --days for a clean read.
  const dead = skillsOnDisk().filter(n => !by.has(n));
  if (dead.length) {
    console.log(`\n  never fired in this window (${dead.length}):`);
    for (const n of dead) console.log(`    ${n}`);
    console.log("  A skill that never clears the 0.30 floor is paying description tokens for nothing:");
    console.log("  rewrite its description (domain nouns inside the first 400 chars, which is all the");
    console.log("  cross-encoder sees) or drop it. Two things make this list over-report: a newly");
    console.log("  installed skill has not had its moment yet, and the `skills` field only exists in");
    console.log("  decisions written from 2026-08-11 on, so any window reaching further back is blind.");
  }
}

main();
