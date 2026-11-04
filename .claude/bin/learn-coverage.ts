/**
 * learn-coverage.ts — what share of past failures does the ledger actually cover?
 *
 *   npm run learn:coverage
 *
 * The honest question about a learning system is not "did it produce plausible
 * lessons" but "would those lessons have caught what actually went wrong". This
 * answers it mechanically: no model, no judge, no interpretive step, so there is
 * nothing here that can flatter the result.
 *
 * Method. Recompute the same normalized error signatures the behavioral miner
 * clusters on, then ask, for every error event in the corpus:
 *   - is this event's signature covered by an ACTIVE lesson?
 *   - had the lesson ALREADY been observable, i.e. had >= 2 distinct sessions
 *     containing it already ENDED before this event occurred?
 * The second condition is what makes it a real test rather than a tautology. A
 * lesson mined from an event trivially "covers" that event. Only events that
 * post-date the lesson's own evidence count as prevented, which is exactly the
 * counterfactual: had the ledger existed then, would this have been avoidable?
 *
 * Reported as three numbers:
 *   covered        events whose signature has an active lesson (upper bound)
 *   preventable    covered AND the lesson's evidence predates the event (the claim)
 *   uncovered      the tail the ledger says nothing about (honest remainder)
 */
import * as fs from "fs";
import * as path from "path";
import { activeLessons } from "./lessons";

const ROOT = path.join(process.env.HOME || process.env.USERPROFILE || "", ".claude", "projects");

interface ErrEvent { ts: number; session: string; tool: string; raw: string }

function collect(): ErrEvent[] {
  const files: string[] = [];
  (function walk(d: string) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".jsonl")) files.push(p); } })(ROOT);
  const out: ErrEvent[] = [];
  for (const f of files) {
    let lines: string[]; try { lines = fs.readFileSync(f, "utf8").split("\n"); } catch { continue; }
    const idToTool = new Map<string, string>();
    for (const line of lines) {
      if (!line.trim()) continue;
      let m: any; try { m = JSON.parse(line); } catch { continue; }
      const c = m?.message?.content;
      if (m?.type === "assistant" && Array.isArray(c))
        for (const b of c) if (b?.type === "tool_use") idToTool.set(String(b.id), String(b.name || "?"));
      if (m?.type === "user" && Array.isArray(c)) {
        for (const b of c) {
          if (b?.type !== "tool_result") continue;
          const txt = typeof b.content === "string" ? b.content
            : Array.isArray(b.content) ? (b.content.find((x: any) => x?.type === "text")?.text || "") : "";
          const isErr = b.is_error === true || /^(Error|error):|Traceback|command not found|No such file|Exit code [1-9]/.test(txt.trim());
          if (!isErr || !txt.trim()) continue;
          out.push({ ts: Date.parse(m?.timestamp || "") || 0, session: String(m?.sessionId || ""), tool: idToTool.get(String(b.tool_use_id)) || "?", raw: txt.slice(0, 1200) });
        }
      }
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// Identical normalization to lesson-mine-behavioral.ts. If that drifts, this drifts
// with it and the number stops meaning the same thing — keep them in step.
const sigOf = (e: ErrEvent) => `${e.tool}::` + e.raw
  .replace(/[A-Za-z]:\\[^\s"']+|\/[\w.\-\/]{6,}/g, "<path>")
  .replace(/\b[0-9a-f]{7,}\b/gi, "<hash>")
  .replace(/\b\d+\b/g, "<n>")
  .split(/[\n.]/).slice(0, 2).join(" ")
  .replace(/\s+/g, " ").trim().toLowerCase().slice(0, 90);

function main() {
  const events = collect();
  const lessons = activeLessons().filter(l => l.trigger.type === "tool");
  console.log(`ledger coverage: ${events.length} error events vs ${lessons.length} active tool lessons\n`);

  // A lesson's evidence window: the earliest event in any session it was mined from.
  // Sessions are ids, so map each session to its first error timestamp.
  const sessionFirst = new Map<string, number>();
  for (const e of events) if (!sessionFirst.has(e.session)) sessionFirst.set(e.session, e.ts);
  const lessonEarliest = new Map<string, number>();
  for (const l of lessons) {
    let earliest = Infinity;
    for (const s of l.sessions) { const t = sessionFirst.get(s); if (t && t < earliest) earliest = t; }
    lessonEarliest.set(l.id, earliest);
  }

  // Which signatures does each lesson cover? A lesson was mined from a cluster, so
  // rebuild the mapping by re-clustering and matching on the sessions it cites.
  const bySig = new Map<string, ErrEvent[]>();
  for (const e of events) (bySig.get(sigOf(e)) ?? bySig.set(sigOf(e), []).get(sigOf(e))!).push(e);

  // Exact provenance: a lesson covers the signature it was MINED from, nothing else.
  // The earlier version matched on session overlap and over-attributed wildly — one
  // Bash lesson appeared to cover most Bash signatures, inflating coverage to 81.8%.
  const sigToLesson = new Map<string, string>();
  for (const l of lessons) if (l.sig) sigToLesson.set(l.sig, l.id);
  const unattributed = lessons.filter(l => !l.sig).length;
  if (unattributed) console.log(`  NOTE: ${unattributed} active lesson(s) carry no signature (mined before provenance was recorded); their coverage is not counted.
`);

  // LEAVE-FUTURE-OUT. The previous condition (`e.ts > lessonEarliest`) was circular
  // and the docstring claiming otherwise was false: lessonEarliest is the MIN over the
  // lesson's cited sessions, so every event in the cluster except those in the single
  // earliest session satisfied it — including the events the lesson was mined from.
  // An audit re-derivation found 99.4% of the reported "preventable" events were
  // inside the lesson's own training data. Second time this harness measured the
  // wrong thing, so the condition is now spelled out explicitly:
  //
  //   an event counts ONLY if the lesson had already been observed in >= MIN_SESSIONS
  //   DISTINCT sessions that all ended before this event occurred.
  //
  // That is the real counterfactual: at the moment this error happened, would the
  // ledger already have held a promotable lesson covering it?
  const sessionLast = new Map<string, number>();
  for (const e of events) sessionLast.set(e.session, Math.max(sessionLast.get(e.session) ?? 0, e.ts));

  let covered = 0, preventable = 0, uncovered = 0, insideOwnEvidence = 0;
  const uncoveredSig = new Map<string, number>();
  for (const e of events) {
    const sig = sigOf(e);
    const lid = sigToLesson.get(sig);
    if (!lid) { uncovered++; uncoveredSig.set(sig, (uncoveredSig.get(sig) ?? 0) + 1); continue; }
    covered++;
    const lesson = lessons.find(l => l.id === lid)!;
    if (lesson.sessions.includes(e.session)) insideOwnEvidence++;
    const priorSessions = lesson.sessions.filter(s => {
      const last = sessionLast.get(s);
      return last !== undefined && last < e.ts;
    }).length;
    if (priorSessions >= 2) preventable++;
  }
  const pct = (x: number) => `${((100 * x) / events.length).toFixed(1)}%`;

  console.log(`  covered by an active lesson        ${covered}  ${pct(covered)}`);
  console.log(`  ...of which inside the lesson's OWN`);
  console.log(`     cited evidence (NOT a test)      ${insideOwnEvidence}  ${pct(insideOwnEvidence)}`);
  console.log(`  leave-future-out preventable:`);
  console.log(`     >=2 prior sessions had ended     ${preventable}  ${pct(preventable)}   <- the honest claim`);
  console.log(`  no lesson covers it                ${uncovered}  ${pct(uncovered)}`);
  console.log(`\n  signatures with a lesson: ${sigToLesson.size} of ${bySig.size}`);
  console.log(`\n  largest uncovered failure families (candidates for the next mining pass):`);
  for (const [s, n] of [...uncoveredSig.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6))
    console.log(`    ${String(n).padStart(4)}x  ${s.slice(0, 96)}`);
}
main();
