/**
 * learn-utility.ts — join lesson fires to what happened next.
 *
 *   npm run learn:utility            report only
 *   npm run learn:utility -- --apply write injected/helped back to the ledger
 *
 * THE GAP THIS CLOSES. `Lesson.injected` and `Lesson.helped` have existed since the
 * ledger was written and have never been anything but 0. enforceBudget() already reads
 * them — utility ranks above recurrence in its sort — so the consumer was there the
 * whole time and only the producer was missing. Until now the per-domain budget could
 * evict only by how OFTEN a rule was mined, never by whether it ever did anything, and
 * "fires constantly, prevents nothing" outranked "fires rarely, always right".
 *
 * THE JOIN. The PreToolUse hook appends one line per fire (ts, session, tool, lesson
 * ids). The transcript for that session records what the call actually did. Matching a
 * fire to the next same-tool call in the same session gives a mechanical, per-event
 * outcome with no model in the loop and no judge to disagree with.
 *
 * WHAT THE NUMBER IS, AND IS NOT. `helped/injected` is the success rate of calls made
 * under advice. It is NOT a causal effect: most tool calls succeed anyway, so a high
 * rate is unremarkable on its own. It is comparable BETWEEN lessons in the same domain,
 * which is exactly and only what eviction needs. The report therefore prints each
 * domain's base success rate next to it, so a lesson can be read against the background
 * rather than against 100%. Lessons below 3 fires are left neutral rather than ranked
 * on one or two events.
 *
 * Watermarked on the last processed fire timestamp, so a nightly run costs time
 * proportional to NEW fires rather than to the whole log.
 */
import * as fs from "fs";
import * as path from "path";
import { memDir } from "./config";
import { currentLessons, activeLessons, LEDGER, type Lesson } from "./lessons";

const FIRES = () => path.join(memDir(), "lesson-fires.jsonl");
const MARK = () => path.join(memDir(), "lesson_utility_mark.json");
const PROJECTS = path.join(process.env.HOME || process.env.USERPROFILE || "", ".claude", "projects");

/** A fire is credited to the first same-tool call within this window. Beyond it the
 *  call is a different unit of work and the advice cannot be said to apply. */
const WINDOW_MS = 120_000;

interface Fire { ts: string; session: string; tool: string; ids: string[]; cwd?: string }
interface Call { ts: number; tool: string; errored: boolean }

function readFires(since: string): Fire[] {
  let raw = "";
  try { raw = fs.readFileSync(FIRES(), "utf8"); } catch { return []; }
  const out: Fire[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const f = JSON.parse(line.replace(/^﻿/, "")) as Fire;
      if (f.ts > since && f.ids?.length) out.push(f);
    } catch { /* a torn line from a concurrent append is not worth failing over */ }
  }
  return out;
}

/** Tool calls in one session, in order, each tagged with whether its result errored. */
function callsFor(session: string): Call[] {
  const files: string[] = [];
  (function walk(d: string) {
    let ents: fs.Dirent[]; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === `${session}.jsonl`) files.push(p);
    }
  })(PROJECTS);
  if (!files.length) return [];
  const pending = new Map<string, { ts: number; tool: string }>();
  const calls: Call[] = [];
  for (const f of files) {
    let lines: string[]; try { lines = fs.readFileSync(f, "utf8").split("\n"); } catch { continue; }
    for (const line of lines) {
      if (!line.trim()) continue;
      let m: any; try { m = JSON.parse(line); } catch { continue; }
      const ts = Date.parse(m?.timestamp || "") || 0;
      const c = m?.message?.content;
      if (!Array.isArray(c)) continue;
      if (m.type === "assistant") {
        for (const b of c) if (b?.type === "tool_use" && b.id) pending.set(b.id, { ts, tool: String(b.name || "") });
      } else if (m.type === "user") {
        for (const b of c) {
          if (b?.type !== "tool_result" || !b.tool_use_id) continue;
          const p = pending.get(b.tool_use_id); if (!p) continue;
          pending.delete(b.tool_use_id);
          const txt = typeof b.content === "string" ? b.content
            : Array.isArray(b.content) ? (b.content.find((x: any) => x?.type === "text")?.text || "") : "";
          const errored = b.is_error === true
            || /^(Error|error):|Traceback|command not found|No such file|Exit code [1-9]/.test(String(txt).trim());
          calls.push({ ts: p.ts, tool: p.tool, errored });
        }
      }
    }
  }
  return calls.sort((a, b) => a.ts - b.ts);
}

function main() {
  const APPLY = process.argv.includes("--apply");
  let since = "";
  try { since = JSON.parse(fs.readFileSync(MARK(), "utf8")).last || ""; } catch { /* first run */ }

  const fires = readFires(since);
  if (!fires.length) { console.log(`no new fires since ${since || "(beginning)"} — nothing to grade`); return; }

  // Group by session so each transcript is read once, not once per fire.
  const bySession = new Map<string, Fire[]>();
  for (const f of fires) (bySession.get(f.session) ?? bySession.set(f.session, []).get(f.session)!).push(f);

  const tally = new Map<string, { fired: number; ok: number }>();
  const domainCalls = new Map<string, { n: number; ok: number }>();
  const byId = new Map(currentLessons().map(l => [l.id, l]));
  let unmatched = 0;

  for (const [session, fs_] of bySession) {
    const calls = callsFor(session);
    if (!calls.length) { unmatched += fs_.length; continue; }
    // Background rate for the tools involved, from this same transcript. Using the
    // session's own calls keeps the comparison honest: the base rate is measured on the
    // same host, the same day, and the same kind of work as the advised calls.
    for (const c of calls) {
      const d = domainCalls.get(c.tool) ?? domainCalls.set(c.tool, { n: 0, ok: 0 }).get(c.tool)!;
      d.n++; if (!c.errored) d.ok++;
    }
    for (const f of fs_) {
      const t = Date.parse(f.ts);
      const hit = calls.find(c => c.ts >= t && c.ts - t <= WINDOW_MS && c.tool.toLowerCase() === f.tool.toLowerCase());
      if (!hit) { unmatched++; continue; }
      for (const id of f.ids) {
        const e = tally.get(id) ?? tally.set(id, { fired: 0, ok: 0 }).get(id)!;
        e.fired++; if (!hit.errored) e.ok++;
      }
    }
  }

  console.log(`lesson utility — ${fires.length} fires across ${bySession.size} session(s)`);
  console.log(`  ${unmatched} fire(s) had no matching call within ${WINDOW_MS / 1000}s (call abandoned, or transcript not yet flushed)\n`);

  const rows = [...tally].map(([id, v]) => ({ id, l: byId.get(id), ...v }))
    .filter(r => r.l).sort((a, b) => b.fired - a.fired);
  for (const r of rows) {
    const base = domainCalls.get(r.l!.trigger.match) || domainCalls.get(r.l!.domain);
    const baseTxt = base && base.n >= 5 ? `  (tool base ${(100 * base.ok / base.n).toFixed(0)}%)` : "";
    console.log(`  ${r.id}  fired ${String(r.fired).padStart(3)}  ok ${String(r.ok).padStart(3)}  ${(100 * r.ok / r.fired).toFixed(0)}%${baseTxt}  [${r.l!.domain}] ${r.l!.action.slice(0, 60)}`);
  }
  if (!rows.length) console.log("  (no fire matched a call yet)");

  if (!APPLY) { console.log(`\nDRY RUN - add --apply to write injected/helped back to the ledger`); return; }

  // Append the updated counters. Append-only, like every other mutation here: the
  // previous record stays in the log and replay keeps the last.
  let written = 0;
  for (const r of rows) {
    const l = r.l as Lesson;
    const next: Lesson = { ...l, injected: (l.injected || 0) + r.fired, helped: (l.helped || 0) + r.ok };
    fs.appendFileSync(LEDGER(), JSON.stringify(next) + "\n");
    written++;
  }
  const last = fires.map(f => f.ts).sort().pop()!;
  fs.writeFileSync(MARK(), JSON.stringify({ last, updated: new Date().toISOString() }, null, 2));
  console.log(`\nwrote counters for ${written} lesson(s); watermark -> ${last}`);
  console.log(`enforceBudget() now ranks these by help rate ahead of recurrence.`);

  const act = activeLessons();
  const proven = act.filter(l => (l.injected || 0) >= 3);
  console.log(`${proven.length}/${act.length} active lessons now have >=3 fires (the threshold at which eviction stops treating them as neutral).`);
}
// Guarded: importing this module must not run the pass. A health check that imports
// every module to prove it parses would otherwise execute a full corpus scan, and on a
// fresh vault that fails with ENOENT on files the pass expects to already exist.
if (require.main === module) main();
