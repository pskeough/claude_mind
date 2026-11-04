/**
 * injection-cost.ts — what does this system cost per session, in tokens?
 *
 *   npx tsx .claude/bin/injection-cost.ts
 *
 * Every layer here injects something, and the cost was never measured — it was asserted.
 * The tier-2 method block was widened from 2 items to the whole active set this session
 * on the argument that "3,300 tokens buys what a reranker could not", which is a
 * defensible trade only if 3,300 is the real number and only if it is small next to what
 * else is already being spent.
 *
 * Counts characters and divides by 4. That is a rough estimate, deliberately: the point
 * is the RATIO between channels and the per-session total, and a tokenizer would change
 * neither conclusion while adding a dependency to a diagnostic.
 *
 * Read the FREQUENCY column as carefully as the size. A 3,400-token block that fires on
 * one prompt in twenty is cheaper than a 400-token block on every prompt.
 */
import * as fs from "fs";
import * as path from "path";
import { memDir, methodInjectMax, methodInjectMaxTokens } from "./config";
import { currentLessons } from "./lessons";

const tok = (s: string) => Math.ceil(s.length / 4);
const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };

interface Row { channel: string; tokens: number; when: string; note: string }
const rows: Row[] = [];

// ---- always-on, every session ----------------------------------------------
const today = read(path.join(memDir(), "TODAY.md"));
rows.push({ channel: "TODAY.md", tokens: tok(today), when: "every session start", note: "deadlines, lanes, inbox" });

const playbook = read(path.join(memDir(), "PLAYBOOK.md"));
rows.push({ channel: "PLAYBOOK.md", tokens: tok(playbook), when: "every session start", note: "rendered lesson view" });

const profile = read(path.join(memDir(), "persona", "PROFILE.md"));
if (profile) rows.push({ channel: "persona PROFILE.md", tokens: tok(profile), when: "every session start", note: "always-on identity card" });

// ---- per prompt -------------------------------------------------------------
// The tier-2 block, rendered exactly as taskOnsetGate renders it.
const t2 = currentLessons().filter(l => !l.invalid_at && l.status === "active" && (l.tier ?? 1) >= 2);
const methodBody = t2.map(l => [
  `- ${l.action}`, `    why: ${l.statement}`, `    stale if: ${l.falsifier}`, `    [${l.domain}, fit 0.00]`,
].join("\n")).join("\n");
const methodHeader = 240;   // the four-line framing paragraph
rows.push({
  channel: `tier-2 method (${t2.length} principles)`,
  tokens: tok(methodBody) + methodHeader / 4,
  when: "task-onset prompts only",
  note: `cap ${methodInjectMax()} items / ${methodInjectMaxTokens()} tokens`,
});

// The PreToolUse hook: at most 2 lessons, per matching tool call.
const trig = (() => { try { return JSON.parse(read(path.join(memDir(), "lesson-triggers.json"))); } catch { return { rules: [] }; } })();
const avgAction = trig.rules.length
  ? trig.rules.reduce((a: number, r: any) => a + String(r.action || "").length, 0) / trig.rules.length : 0;
// Fire volume is read, not asserted. lesson-fires.jsonl carries one line per hook fire
// with the ids it delivered, so both the frequency and the items-per-fire that the token
// estimate multiplies by are observable here. A fire RATE would need a denominator this
// file does not have (total tool calls live in the transcripts), and the failure lift
// needs an outcome per call, so both stay with `npm run learn:trigeval`, which replays
// the rule set over every recorded call and recomputes them from scratch.
const FIRE_WINDOW_DAYS = 14;
const fires = read(path.join(memDir(), "lesson-fires.jsonl")).split("\n").filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter((f: any) => f && Date.parse(f.ts) >= Date.now() - FIRE_WINDOW_DAYS * 86_400_000);
const firesPerDay = fires.length / FIRE_WINDOW_DAYS;
const perFire = fires.length
  ? fires.reduce((a: number, f: any) => a + (f.ids?.length ?? 0), 0) / fires.length : 2;
rows.push({
  channel: "PreToolUse trigger (2 max)",
  tokens: Math.ceil((avgAction * perFire + 220) / 4),
  when: fires.length ? `~${firesPerDay.toFixed(0)}/day, last ${FIRE_WINDOW_DAYS}d` : "per matching tool call",
  note: `${trig.rules.length} rules, ${perFire.toFixed(1)} delivered per fire (rate + lift: npm run learn:trigeval)`,
});

console.log(`injection cost, ~4 chars/token\n`);
console.log(`  ${"channel".padEnd(34)} ${"tokens".padStart(7)}   ${"fires".padEnd(24)} note`);
for (const r of rows.sort((a, b) => b.tokens - a.tokens))
  console.log(`  ${r.channel.padEnd(34)} ${String(r.tokens).padStart(7)}   ${r.when.padEnd(24)} ${r.note}`);

const startup = rows.filter(r => r.when.includes("session start")).reduce((a, r) => a + r.tokens, 0);
const onset = rows.find(r => r.channel.startsWith("tier-2"))!.tokens;
console.log(`\n  fixed per session start        ${startup}`);
console.log(`  + a task-onset prompt          ${onset}`);
console.log(`  worst case, one session        ${startup + onset}`);

// Context is ~200k. The honest framing is share-of-window, not raw count: a number with
// no denominator invites both "that's a lot" and "that's nothing" and settles neither.
const WINDOW = 200_000;
console.log(`\n  as a share of a 200k window:  startup ${(100 * startup / WINDOW).toFixed(2)}%, ` +
  `startup + onset ${(100 * (startup + onset) / WINDOW).toFixed(2)}%`);

if (t2.length >= methodInjectMax())
  console.log(`\n  NOTE: ${t2.length} active principles against a cap of ${methodInjectMax()} — the cap now BINDS,`);
else
  console.log(`\n  ${t2.length}/${methodInjectMax()} principles, ${tok(methodBody)}/${methodInjectMaxTokens()} tokens: the cap does not bind yet.`);
console.log(`  so ranking decides inclusion again. Re-read d-021: cosine ranks these poorly,`);
console.log(`  which is why the cap should be raised before it starts silently dropping items.`);
