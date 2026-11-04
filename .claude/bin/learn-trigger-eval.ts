/**
 * learn-trigger-eval.ts — replay the PreToolUse rules against real historical traffic.
 *
 *   npm run learn:trigeval
 *
 * Built after an independent audit found the delivery layer was the broken part of
 * the learning system while the ledger was fine: one rule fired 4,752 times at 0.6%
 * precision, 32 of 81 rules never matched anything, and 60.6% of firings delivered a
 * near-duplicate pair. None of that was visible from hand-written probes, because a
 * hand-written probe set is too clean. Only the corpus tells the truth.
 *
 * Reimplements the hook's matching semantics exactly (executable fields only,
 * substring match, 2-slot cap) so the numbers here are the numbers the hook produces.
 * Any change to lkhs-pretool-lesson.ps1 must be mirrored here or this stops measuring
 * the live system.
 */
import * as fs from "fs";
import * as path from "path";
import { memDir } from "./config";

const ROOT = path.join(process.env.HOME || process.env.USERPROFILE || "", ".claude", "projects");
const EXEC_FIELDS = ["command", "file_path", "url", "pattern", "notebook_path", "path"];

interface Call { tool: string; text: string; errored: boolean }

/**
 * Calls, each tagged with whether its result came back an error.
 *
 * Fire RATE alone cannot tell a good trigger from a bad one, and reporting it alone hid
 * a real defect for a whole review cycle: 40 of 53 rules were keyed on a single English
 * word scavenged from action prose (`immediately`, `backslash`, `prints`, `opens`).
 * Those words are individually uncommon inside command text, so the union fire rate came
 * out at a healthy-looking 1.3% while what the rules predicted was nothing at all.
 *
 * The measure that distinguishes them is LIFT: among the calls a rule fires on, how much
 * more often does the call fail than the tool's base rate? A trigger exists to fire on
 * the calls that are about to go wrong. Lift near 1.0 means the rule is firing at random
 * with respect to the thing it claims to predict, however rare or common it is.
 */
function collect(): Call[] {
  const files: string[] = [];
  (function walk(d: string) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".jsonl")) files.push(p); } })(ROOT);
  const out: Call[] = [];
  for (const f of files) {
    let lines: string[]; try { lines = fs.readFileSync(f, "utf8").split("\n"); } catch { continue; }
    const pending = new Map<string, Call>();
    for (const line of lines) {
      if (!line.trim()) continue;
      let m: any; try { m = JSON.parse(line); } catch { continue; }
      const c = m?.message?.content;
      if (!Array.isArray(c)) continue;
      if (m.type === "assistant") {
        for (const b of c) {
          if (b?.type !== "tool_use" || !b.id) continue;
          const fields = EXEC_FIELDS.map(k => b.input?.[k]).filter(Boolean).map(String);
          if (!fields.length) continue;
          pending.set(b.id, { tool: String(b.name || "?"), text: fields.join(" ").toLowerCase(), errored: false });
        }
      } else if (m.type === "user") {
        for (const b of c) {
          if (b?.type !== "tool_result" || !b.tool_use_id) continue;
          const call = pending.get(b.tool_use_id); if (!call) continue;
          pending.delete(b.tool_use_id);
          const txt = typeof b.content === "string" ? b.content
            : Array.isArray(b.content) ? (b.content.find((x: any) => x?.type === "text")?.text || "") : "";
          call.errored = b.is_error === true
            || /^(Error|error):|Traceback|command not found|No such file|Exit code [1-9]/.test(String(txt).trim());
          out.push(call);
        }
      }
    }
    // A call whose result never arrived (session cut off) is still a call that was made.
    for (const c of pending.values()) out.push(c);
  }
  return out;
}

function main() {
  const rules = JSON.parse(fs.readFileSync(path.join(memDir(), "lesson-triggers.json"), "utf8")).rules as any[];
  const calls = collect();
  console.log(`replaying ${rules.length} rules over ${calls.length} real tool calls (executable fields only)\n`);

  const fires = new Map<string, number>();     // rule id -> matched
  const fireErr = new Map<string, number>();   // rule id -> matched AND the call failed
  const delivered = new Map<string, number>(); // rule id -> reached the 2-slot cap
  let firedCalls = 0, firedErr = 0;
  const byTool = new Map<string, { n: number; fired: number; err: number }>();
  const pairCount = new Map<string, number>();

  for (const c of calls) {
    const t = byTool.get(c.tool) ?? byTool.set(c.tool, { n: 0, fired: 0, err: 0 }).get(c.tool)!;
    t.n++; if (c.errored) t.err++;
    const hits = rules.filter(r =>
      c.tool.toLowerCase().includes(String(r.match).toLowerCase()) &&
      r.when.every((tok: string) => c.text.includes(tok)));
    if (!hits.length) continue;
    firedCalls++; t.fired++; if (c.errored) firedErr++;
    for (const h of hits) {
      fires.set(h.id, (fires.get(h.id) ?? 0) + 1);
      if (c.errored) fireErr.set(h.id, (fireErr.get(h.id) ?? 0) + 1);
    }
    const top = [...hits].sort((a, b) => b.spec - a.spec || b.sessions - a.sessions).slice(0, 2);
    for (const h of top) delivered.set(h.id, (delivered.get(h.id) ?? 0) + 1);
    pairCount.set(top.map(h => h.id).join("+"), (pairCount.get(top.map(h => h.id).join("+")) ?? 0) + 1);
  }

  const pct = (a: number, b: number) => `${((100 * a) / (b || 1)).toFixed(1)}%`;
  console.log(`  calls that fire the hook   ${firedCalls} / ${calls.length}  ${pct(firedCalls, calls.length)}`);
  console.log(`  rules that never match     ${rules.filter(r => !fires.has(r.id)).length} / ${rules.length}`);
  console.log(`  rules never delivered      ${rules.filter(r => !delivered.has(r.id)).length} / ${rules.length}`);
  console.log(`\n  fire rate by tool:`);
  for (const [tool, v] of [...byTool.entries()].sort((a, b) => b[1].fired - a[1].fired).slice(0, 6))
    console.log(`    ${tool.padEnd(26)} ${String(v.fired).padStart(6)} / ${String(v.n).padStart(6)}  ${pct(v.fired, v.n)}`);
  console.log(`\n  highest-volume rules (fires / delivered):`);
  for (const [id, n] of [...fires.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    const r = rules.find(x => x.id === id)!;
    console.log(`    ${String(n).padStart(5)} / ${String(delivered.get(id) ?? 0).padStart(5)}  [${r.when.join(",")}] ${r.action.slice(0, 62)}`);
  }
  console.log(`\n  most common delivered pairs (duplicate delivery shows up here):`);
  for (const [k, n] of [...pairCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    const acts = k.split("+").map(id => (rules.find(x => x.id === id)?.action || "?").slice(0, 44));
    console.log(`    ${String(n).padStart(5)}  ${acts.join("  ||  ")}`);
  }

  // ---- LIFT: the measure that separates a trigger from a coincidence ----------
  // A rule fires to warn about a call that is about to fail. So among the calls it
  // fires on, the failure rate should exceed the tool's base failure rate. Lift ~1.0
  // means the rule is uncorrelated with failure however rare or common its token is,
  // which is the defect that a fire-rate-only report cannot see.
  const allErr = calls.filter(c => c.errored).length;
  console.log(`\n  ${"-".repeat(72)}`);
  console.log(`  FAILURE LIFT — base error rate over all calls: ${pct(allErr, calls.length)}`);
  console.log(`  fired calls that failed: ${pct(firedErr, firedCalls)}  (lift ${((firedErr / (firedCalls || 1)) / (allErr / (calls.length || 1))).toFixed(2)}x)`);
  const bySource = new Map<string, { f: number; e: number }>();
  for (const r of rules) {
    const f = fires.get(r.id) ?? 0; if (!f) continue;
    const s = r.tokenSource || "unknown";
    const acc = bySource.get(s) ?? bySource.set(s, { f: 0, e: 0 }).get(s)!;
    acc.f += f; acc.e += fireErr.get(r.id) ?? 0;
  }
  console.log(`\n  by token provenance (does where the token came from predict anything?):`);
  for (const [s, v] of [...bySource.entries()].sort((a, b) => b[1].f - a[1].f)) {
    const lift = (v.e / (v.f || 1)) / (allErr / (calls.length || 1));
    console.log(`    ${s.padEnd(16)} ${String(v.f).padStart(6)} fires  ${pct(v.e, v.f).padStart(6)} failed  lift ${lift.toFixed(2)}x`);
  }
  const ranked = rules.map(r => ({ r, f: fires.get(r.id) ?? 0, e: fireErr.get(r.id) ?? 0 }))
    .filter(x => x.f >= 20)
    .map(x => ({ ...x, lift: (x.e / x.f) / (allErr / (calls.length || 1)) }))
    .sort((a, b) => b.lift - a.lift);
  console.log(`\n  best rules by lift (>=20 fires):`);
  for (const x of ranked.slice(0, 5))
    console.log(`    ${x.lift.toFixed(2)}x  ${String(x.f).padStart(5)} fires  [${x.r.when.join(",")}] ${x.r.action.slice(0, 50)}`);
  console.log(`\n  worst rules by lift (>=20 fires) — these fire on calls that were fine:`);
  for (const x of ranked.slice(-5).reverse())
    console.log(`    ${x.lift.toFixed(2)}x  ${String(x.f).padStart(5)} fires  [${x.r.when.join(",")}] ${x.r.action.slice(0, 50)}`);
}
// Guarded: importing this module must not run the pass. A health check that imports
// every module to prove it parses would otherwise execute a full corpus scan, and on a
// fresh vault that fails with ENOENT on files the pass expects to already exist.
if (require.main === module) main();
