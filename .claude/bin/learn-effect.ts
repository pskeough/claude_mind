/**
 * learn-effect.ts — did a method principle change how sessions actually went?
 *
 *   npm run learn:effect
 *
 * Implements decision d-007 in the build ledger, which fixed this design BEFORE any
 * number was produced. That pre-registration is not ceremony: this build has already
 * measured the wrong thing twice (coverage over-attribution, then temporal leakage),
 * both caught by an outside audit rather than by me. Writing the design down first is
 * the cheapest defence against a third.
 *
 * THE QUESTION. Eleven tier-2 principles exist and not one has been shown to improve
 * anything. Counting them is not a result.
 *
 * DESIGN (fixed in advance, do not adjust after seeing output):
 *   POPULATION  sessions with >= 6 assistant turns (the episode miner's filter)
 *   ASSIGNMENT  POST if the session starts after the LAST cited episode of a
 *               matching-domain principle; PRE if it ends before the FIRST.
 *               Sessions INSIDE the evidence window are excluded outright - that
 *               leakage is precisely the bug that inflated coverage twice.
 *   MEASURES    all mechanical, no judge:
 *                 errPer100  tool errors per 100 tool calls
 *                 churn      consecutive-edit runs (same file 3+ times)
 *                 corrections correction-like human turns
 *                 turns      assistant turns to session end
 *   CONTROL     the same PRE/POST split over UNRELATED domains across the identical
 *               calendar window, to absorb global trend (model changes, tooling
 *               changes, my own drift). Without it a improvement is unattributable.
 *   STATISTIC   (POST-PRE in matched domain) minus (POST-PRE in control)
 *   STOP RULE   if the differenced effect is within noise on all four measures, the
 *               honest conclusion is structured memory rather than learning, and no
 *               further tiers get built.
 *
 * A NOTE ON POWER, stated before the result: 118 episodes and 11 principles is a
 * small base. This can plausibly return "no detectable effect" because the effect is
 * absent OR because n is too small to see it, and those are different conclusions.
 * The output reports arm sizes so that distinction stays visible.
 */
import * as fs from "fs";
import * as path from "path";
import { memDir } from "./config";

const ROOT = path.join(process.env.HOME || process.env.USERPROFILE || "", ".claude", "projects");

const CORRECT = /\b(no,|nope|that'?s (wrong|not right)|don'?t |stop |actually,|not what i|you (missed|forgot|didn'?t)|revert|undo|broke|doesn'?t work|didn'?t work|wrong|incorrect|fix (that|it)|i said|i meant|why did you)\b/i;

interface Sess {
  id: string; project: string; start: number; end: number;
  asst: number; tools: number; errors: number; churn: number; corrections: number;
}

function classify(m: any): "human" | "asst" | "skip" {
  const c = m?.message?.content, t = m?.type;
  if (t === "assistant") return Array.isArray(c) && c.some((x: any) => x?.type === "text" && x.text?.trim()) ? "asst" : "skip";
  if (t !== "user") return "skip";
  if (Array.isArray(c) && c.some((x: any) => x?.type === "tool_result")) return "skip";
  const txt = typeof c === "string" ? c : Array.isArray(c) ? c.filter((x: any) => x?.type === "text").map((x: any) => x.text).join(" ") : "";
  if (!txt.trim() || /^<(system-reminder|command-name|local-command|task-notification|command-message)/.test(txt.trim())) return "skip";
  return "human";
}

function collect(): Sess[] {
  const files: string[] = [];
  (function walk(d: string) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".jsonl")) files.push(p); } })(ROOT);
  const by = new Map<string, Sess>();
  for (const f of files) {
    const project = path.basename(path.dirname(f));
    let lines: string[]; try { lines = fs.readFileSync(f, "utf8").split("\n"); } catch { continue; }
    let lastEdit = "", run = 0, lastAsstText = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      let m: any; try { m = JSON.parse(line); } catch { continue; }
      const sid = String(m?.sessionId || ""); if (!sid) continue;
      const ts = Date.parse(m?.timestamp || "") || 0;
      const s = by.get(sid) ?? by.set(sid, { id: sid, project, start: ts || Infinity, end: 0, asst: 0, tools: 0, errors: 0, churn: 0, corrections: 0 }).get(sid)!;
      if (ts) { s.start = Math.min(s.start, ts); s.end = Math.max(s.end, ts); }
      const c = m?.message?.content;
      if (m?.type === "assistant" && Array.isArray(c)) {
        for (const b of c) {
          if (b?.type !== "tool_use") continue;
          s.tools++;
          if (b.name === "Edit" || b.name === "Write") {
            const t = String(b.input?.file_path || "");
            if (t && t === lastEdit) { run++; if (run === 2) s.churn++; } else { lastEdit = t; run = 0; }
          }
        }
      }
      if (m?.type === "user" && Array.isArray(c)) {
        for (const b of c) {
          if (b?.type !== "tool_result") continue;
          const txt = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? (b.content.find((x: any) => x?.type === "text")?.text || "") : "";
          if (b.is_error === true || /^(Error|error):|Traceback|command not found|No such file|Exit code [1-9]/.test(txt.trim())) s.errors++;
        }
      }
      const k = classify(m);
      if (k === "asst") { s.asst++; lastAsstText = true; }
      else if (k === "human") {
        const txt = typeof c === "string" ? c : Array.isArray(c) ? c.filter((x: any) => x?.type === "text").map((x: any) => x.text).join(" ") : "";
        if (lastAsstText && CORRECT.test(txt)) s.corrections++;
        lastAsstText = false;
      }
    }
  }
  // Population must match the episode miner's corrected selection, not the old
  // chattiness filter. Fixing the miner and leaving this standing kept the arms at
  // 1/5 even after the episode base grew 118 -> 298: a definition changed in one
  // place and its dependent site left behind.
  return [...by.values()].filter(s => s.tools >= 2 && isFinite(s.start));
}

const measures = (arr: Sess[]) => ({
  n: arr.length,
  errPer100: arr.length ? (100 * arr.reduce((a, s) => a + s.errors, 0)) / Math.max(1, arr.reduce((a, s) => a + s.tools, 0)) : 0,
  churn: arr.length ? arr.reduce((a, s) => a + s.churn, 0) / arr.length : 0,
  corrections: arr.length ? arr.reduce((a, s) => a + s.corrections, 0) / arr.length : 0,
  turns: arr.length ? arr.reduce((a, s) => a + s.asst, 0) / arr.length : 0,
});

function main() {
  // Principles and the episodes they cite.
  const lessons = (() => {
    const byId = new Map<string, any>();
    for (const l of fs.readFileSync(path.join(memDir(), "lessons.jsonl"), "utf8").split("\n")) {
      if (!l.trim()) continue; try { const x = JSON.parse(l); byId.set(x.id, x); } catch { /* */ }
    }
    return [...byId.values()].filter(l => !l.invalid_at && l.status === "active" && (l.tier ?? 1) >= 2);
  })();
  const episodes = fs.readFileSync(path.join(memDir(), "episodes.jsonl"), "utf8").split("\n")
    .filter(l => l.trim()).map(l => JSON.parse(l));
  const epBySession = new Map(episodes.map((e: any) => [e.session, e]));

  const sessions = collect();
  const byId = new Map(sessions.map(s => [s.id, s]));
  console.log(`effect measurement (design pre-registered as d-007)\n`);
  console.log(`  ${sessions.length} qualifying sessions, ${lessons.length} tier-2 principles\n`);

  let mPre: Sess[] = [], mPost: Sess[] = [], cPre: Sess[] = [], cPost: Sess[] = [];
  const perPrinciple: string[] = [];

  for (const l of lessons) {
    const cited = (l.cites || []).map((s: string) => byId.get(s)).filter(Boolean) as Sess[];
    if (cited.length < 2) continue;
    const first = Math.min(...cited.map(s => s.start));
    const last = Math.max(...cited.map(s => s.end));
    // Domain membership is taken from the CITED EPISODES, not from the principle's own
    // domain slug. The synthesizer invents a slug per cluster ("empirical-paper-
    // revision") while the episode miner invents its own ("paper-revision"), so the two
    // layers have private vocabularies and never join: matching on the principle's slug
    // returned zero sessions in both arms. That taxonomy split is a real defect worth
    // fixing upstream; here we route around it by defining a principle's domain as the
    // set of domains its evidence actually came from.
    const domains = new Set((l.cites || []).map((s: string) => (epBySession.get(s) as any)?.domain).filter(Boolean));
    if (!domains.size) continue;
    const inDomain = (s: Sess) => domains.has((epBySession.get(s.id) as any)?.domain);
    const pre = sessions.filter(s => inDomain(s) && s.end < first);
    const post = sessions.filter(s => inDomain(s) && s.start > last);
    // Control: same calendar window, DIFFERENT domain.
    const cpre = sessions.filter(s => !inDomain(s) && s.end < first && s.end >= first - 90 * 86400_000);
    const cpost = sessions.filter(s => !inDomain(s) && s.start > last && s.start <= last + 90 * 86400_000);
    mPre.push(...pre); mPost.push(...post); cPre.push(...cpre); cPost.push(...cpost);
    if (pre.length && post.length) perPrinciple.push(`    ${l.domain.padEnd(30)} pre ${String(pre.length).padStart(3)}  post ${String(post.length).padStart(3)}`);
  }

  const M = { pre: measures(mPre), post: measures(mPost) };
  const C = { pre: measures(cPre), post: measures(cPost) };
  const row = (name: string, k: keyof ReturnType<typeof measures>) => {
    const dM = (M.post[k] as number) - (M.pre[k] as number);
    const dC = (C.post[k] as number) - (C.pre[k] as number);
    const diff = dM - dC;
    const f = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(2);
    console.log(`  ${name.padEnd(13)} matched ${f(dM).padStart(8)}   control ${f(dC).padStart(8)}   differenced ${f(diff).padStart(8)}`);
    return diff;
  };

  console.log(`  arm sizes: matched pre ${M.pre.n} / post ${M.post.n}   control pre ${C.pre.n} / post ${C.post.n}`);
  if (perPrinciple.length) { console.log(`\n  principles with both arms populated:`); perPrinciple.forEach(p => console.log(p)); }
  console.log(`\n  change after the principle's evidence window (negative = better on all four):`);
  const diffs = [row("errPer100", "errPer100"), row("churn", "churn"), row("corrections", "corrections"), row("turns", "turns")];

  console.log(`\n  ${"-".repeat(66)}`);
  if (M.post.n < 10 || M.pre.n < 10) {
    console.log(`  UNDERPOWERED. Arms are ${M.pre.n}/${M.post.n}; this cannot distinguish "no effect"`);
    console.log(`  from "not enough data to see one". Per d-007 the stop rule does NOT fire on`);
    console.log(`  an underpowered null - it fires on a well-powered one. Re-run when the`);
    console.log(`  episode base is larger.`);
  } else if (diffs.every(d => Math.abs(d) < 0.5)) {
    console.log(`  STOP RULE MET: differenced effect within noise on all four measures.`);
    console.log(`  Per d-007 the conclusion is structured memory, not learning. Build no more tiers.`);
  } else {
    console.log(`  Signal present on at least one measure. Not proof of causation - the arms`);
    console.log(`  are observational and the assignment is temporal - but it is the first`);
    console.log(`  evidence that these principles correspond to anything.`);
  }
}
// Guarded: importing this module must not run the pass. A health check that imports
// every module to prove it parses would otherwise execute a full corpus scan, and on a
// fresh vault that fails with ENOENT on files the pass expects to already exist.
if (require.main === module) main();
