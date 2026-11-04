/**
 * phase0-recurrence.ts — does the same mistake actually recur?
 *
 *   npx tsx .claude/bin/phase0-recurrence.ts [--json out.json]
 *
 * Phase 0a of LEARNING-SYSTEM-SPEC.md. The premise of a learning system is that
 * failures REPEAT across sessions. If almost every error is a one-off, there is
 * nothing for a lesson to generalize to and the whole design should be abandoned.
 *
 * This measures that directly and mechanically: no LLM, no judge, no scoring model,
 * therefore no way for an agreeable judge to manufacture a positive result. An error
 * event counts as PREVENTABLE only if the same normalized signature already occurred
 * in a STRICTLY EARLIER, DIFFERENT session. Same-session repeats are excluded because
 * in-context memory already covers those; the claim under test is specifically about
 * knowledge that does not survive a session boundary.
 *
 * The one judgement call is signature normalization, and it swings the answer both
 * ways: too aggressive and every error collapses into one bucket (inflating the
 * result), too weak and nothing matches (deflating it). So the harness runs THREE
 * normalization strengths and reports all of them. Read the spread, not a number.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(process.env.HOME || process.env.USERPROFILE || "", ".claude", "projects");
const OUT = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;

interface ErrEvent { ts: number; session: string; project: string; tool: string; raw: string }
interface ChurnEvent { ts: number; session: string; file: string; edits: number }

// ---- collect ---------------------------------------------------------------
const files: string[] = [];
(function walk(d: string) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith(".jsonl")) files.push(p);
  }
})(ROOT);

const errors: ErrEvent[] = [];
const churn: ChurnEvent[] = [];

const resultText = (b: any): string => {
  if (typeof b.content === "string") return b.content;
  if (Array.isArray(b.content)) return b.content.filter((x: any) => x?.type === "text").map((x: any) => x.text).join(" ");
  return "";
};

for (const f of files) {
  const project = path.basename(path.dirname(f));
  let lines: string[]; try { lines = fs.readFileSync(f, "utf8").split("\n"); } catch { continue; }
  const idToTool = new Map<string, string>();
  let lastEdit = ""; let run = 0; let runStart = 0; let runSession = "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let m: any; try { m = JSON.parse(line); } catch { continue; }
    const ts = Date.parse(m?.timestamp || "") || 0;
    const session = String(m?.sessionId || "");
    const c = m?.message?.content;

    if (m?.type === "assistant" && Array.isArray(c)) {
      for (const b of c) {
        if (b?.type !== "tool_use") continue;
        idToTool.set(String(b.id), String(b.name || "?"));
        if (b.name === "Edit" || b.name === "Write") {
          const t = String(b.input?.file_path || "");
          if (t && t === lastEdit) { run++; }
          else {
            if (run >= 2 && lastEdit) churn.push({ ts: runStart, session: runSession, file: lastEdit, edits: run + 1 });
            lastEdit = t; run = 0; runStart = ts; runSession = session;
          }
        }
      }
    }
    if (m?.type === "user" && Array.isArray(c)) {
      for (const b of c) {
        if (b?.type !== "tool_result") continue;
        const txt = resultText(b);
        const isErr = b.is_error === true || /^(Error|error):|Traceback|command not found|No such file|Exit code [1-9]/.test(txt.trim());
        if (!isErr || !txt.trim()) continue;
        errors.push({ ts, session, project, tool: idToTool.get(String(b.tool_use_id)) || "?", raw: txt });
      }
    }
  }
  if (run >= 2 && lastEdit) churn.push({ ts: runStart, session: runSession, file: lastEdit, edits: run + 1 });
}

// ---- signature normalization (three strengths) -----------------------------
const stripVolatile = (s: string) => s
  .replace(/[A-Za-z]:\\[^\s"']+|\/[\w.\-\/]{6,}/g, "<path>")      // absolute paths
  .replace(/\b[0-9a-f]{7,}\b/gi, "<hash>")
  .replace(/\b\d+\b/g, "<n>")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const SIGS = {
  // strict: tool + a long slice of the normalized message. Under-matches.
  strict: (e: ErrEvent) => `${e.tool}::${stripVolatile(e.raw).slice(0, 160)}`,
  // medium: tool + first two normalized sentences/lines, which is usually the
  // distinctive part before a stack trace or a dump of output.
  medium: (e: ErrEvent) => `${e.tool}::${stripVolatile(e.raw.split(/[\n.]/).slice(0, 2).join(" ")).slice(0, 90)}`,
  // loose: tool + the error's leading clause only. Over-matches.
  loose: (e: ErrEvent) => `${e.tool}::${stripVolatile(e.raw).slice(0, 40)}`,
};

errors.sort((a, b) => a.ts - b.ts);
churn.sort((a, b) => a.ts - b.ts);

const DAY = 86400_000;

function analyze(name: string, sigOf: (e: ErrEvent) => string) {
  const firstSession = new Map<string, { session: string; ts: number }>();
  const counts = new Map<string, number>();
  let preventable = 0, sameSessionRepeat = 0, novel = 0;
  const gaps: number[] = [];
  const repeatBySig = new Map<string, number>();

  for (const e of errors) {
    const s = sigOf(e);
    counts.set(s, (counts.get(s) ?? 0) + 1);
    const prev = firstSession.get(s);
    if (!prev) { firstSession.set(s, { session: e.session, ts: e.ts }); novel++; continue; }
    if (prev.session === e.session) { sameSessionRepeat++; continue; }
    preventable++;                                   // seen before, in an earlier DIFFERENT session
    repeatBySig.set(s, (repeatBySig.get(s) ?? 0) + 1);
    if (e.ts && prev.ts) gaps.push(e.ts - prev.ts);
  }

  const distinct = counts.size;
  const singletons = [...counts.values()].filter(v => v === 1).length;
  gaps.sort((a, b) => a - b);
  const pct = (x: number) => `${((100 * x) / errors.length).toFixed(1)}%`;

  console.log(`\n── signature: ${name} ──`);
  console.log(`  distinct signatures      ${distinct}   (singletons ${singletons}, ${((100 * singletons) / distinct).toFixed(0)}% of signatures)`);
  console.log(`  novel (first occurrence) ${novel}  ${pct(novel)}`);
  console.log(`  same-session repeat      ${sameSessionRepeat}  ${pct(sameSessionRepeat)}   <- in-context memory already covers these`);
  console.log(`  CROSS-SESSION REPEAT     ${preventable}  ${pct(preventable)}   <- the ceiling a lesson system could address`);
  if (gaps.length) {
    const med = gaps[Math.floor(gaps.length / 2)]!;
    const p90 = gaps[Math.floor(gaps.length * 0.9)]!;
    const overDay = gaps.filter(g => g > DAY).length;
    console.log(`  gap to prior occurrence  median ${(med / DAY).toFixed(1)}d, p90 ${(p90 / DAY).toFixed(1)}d, ${((100 * overDay) / gaps.length).toFixed(0)}% more than a day later`);
  }
  const top = [...repeatBySig.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) {
    console.log(`  top recurring failures (cross-session repeat count):`);
    for (const [s, n] of top) console.log(`    ${String(n).padStart(4)}x  ${s.slice(0, 108)}`);
  }
  return { name, distinct, singletons, novel, sameSessionRepeat, preventable, total: errors.length };
}

// ---- churn recurrence ------------------------------------------------------
function analyzeChurn() {
  const byFile = new Map<string, Set<string>>();
  for (const c of churn) (byFile.get(c.file) ?? byFile.set(c.file, new Set()).get(c.file)!).add(c.session);
  const multi = [...byFile.entries()].filter(([, s]) => s.size >= 2);
  console.log(`\n── edit-churn recurrence ──`);
  console.log(`  churn runs (file edited 3+ times consecutively) ${churn.length}`);
  console.log(`  distinct files churned                          ${byFile.size}`);
  console.log(`  files churned in 2+ SEPARATE sessions           ${multi.length}  (${((100 * multi.length) / byFile.size).toFixed(0)}%)`);
  console.log(`  top repeat-churn files:`);
  for (const [f, s] of multi.sort((a, b) => b[1].size - a[1].size).slice(0, 8))
    console.log(`    ${String(s.size).padStart(3)} sessions  ${f.slice(-78)}`);
  return { runs: churn.length, files: byFile.size, multiSession: multi.length };
}

// ---- go --------------------------------------------------------------------
console.log(`Phase 0a — mistake recurrence`);
console.log(`transcripts ${files.length}   error events ${errors.length}   churn runs ${churn.length}`);
console.log(`\nAn error is PREVENTABLE only if its signature already appeared in an earlier,`);
console.log(`different session. Same-session repeats are excluded: in-context memory covers those.`);

const results = [
  analyze("strict (under-matches)", SIGS.strict),
  analyze("medium", SIGS.medium),
  analyze("loose (over-matches)", SIGS.loose),
];
const churnRes = analyzeChurn();

const lo = Math.min(...results.map(r => r.preventable));
const hi = Math.max(...results.map(r => r.preventable));
console.log(`\n${"=".repeat(72)}`);
console.log(`VERDICT: ${((100 * lo) / errors.length).toFixed(1)}% - ${((100 * hi) / errors.length).toFixed(1)}% of tool errors are cross-session repeats,`);
console.log(`         depending on how strictly a "same failure" is defined.`);
console.log(`         ${churnRes.multiSession}/${churnRes.files} churned files were re-churned in a later session.`);
console.log(`${"=".repeat(72)}`);

if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ results, churn: churnRes, totalErrors: errors.length }, null, 2)); console.log(`\nwrote ${OUT}`); }
