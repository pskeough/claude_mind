/**
 * prune-automation.ts - keeps the L1 session layer to sessions a human actually had.
 *
 * Three things pollute journal/ and journal/_sessions.jsonl:
 *
 *  1. `claude -p` calls made by the vault's own machinery and by the user's
 *     pipelines (theme synthesis, card synthesis, fact reconciliation, hindsight,
 *     salience, the lesson miners, the Mimesis gate, the shot director, the
 *     LinkedIn discriminators). The capture hook cannot tell them from a real
 *     conversation, so each one lands as a "session" whose only user turn is a
 *     multi-kilobyte system prompt. They dominate the layer by count and, because
 *     they are verbose and repetitive, they crowd real sessions out of retrieval.
 *
 *  2. Repeat captures of one session. The sweep, SessionEnd and PreCompact paths
 *     each append a fresh summary under the session's ORIGINAL timestamp, so a
 *     long-running session accumulates near-identical entries in the same file.
 *
 *  3. Rows in _sessions.jsonl for the same sessionId, from the same cause.
 *
 * Classification is deliberately asymmetric: a row is only called automation on
 * positive evidence, and anything ambiguous stays. Two independent signals:
 *
 *   SYSTEM_PROMPTS - literal openers of scripted prompts, matched against the
 *     captured title. Capped by LINE_CAP because the user also opens real
 *     interactive sessions by pasting a role prompt; those run for thousands of
 *     transcript lines, which a batch call never does.
 *
 *   structural - a single scripted turn looks like: few transcript lines, a
 *     payload long enough that the 80-char title is truncated, a session that
 *     starts and ends within minutes, and a second-person directive opener. All
 *     four must hold, which is why a short human exchange ("hello", "Explain
 *     briefly what files are in this directory") is never caught.
 *
 * Everything removed is appended to backup/pruned-automation.jsonl with its full
 * text, so any removal can be read back and reinstated by hand.
 *
 *   tsx prune-automation.ts                 # dry run: counts per project + borderline sample
 *   tsx prune-automation.ts --apply         # prune sessions + journal, then dedupe
 *   tsx prune-automation.ts --themes        # dry run: duplicate/stub theme cards
 *   tsx prune-automation.ts --themes --apply
 *   tsx prune-automation.ts --sample 40     # widen the borderline sample
 *
 * Removing files or entries leaves their chunks in the vector store. After
 * --apply, re-embed the touched journal files (`npm run embed`) and cold-tier the
 * deleted theme files (`npx tsx .claude/bin/prune-stale.ts --tombstone <paths>`).
 */
import * as fs from "fs";
import * as path from "path";

import { vaultRoot } from "./config";

const VAULT = vaultRoot();
const JOURNAL_DIR = path.join(VAULT, "journal");
const LEDGER = path.join(JOURNAL_DIR, "_sessions.jsonl");
const THEMES_DIR = path.join(VAULT, "themes");
const BACKUP_DIR = path.join(VAULT, ".claude", "memory", "backup-2026-09-02");
const REMOVED_LOG = path.join(BACKUP_DIR, "pruned-automation.jsonl");

const has = (f: string) => process.argv.includes(`--${f}`);
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

const APPLY = has("apply");
const SAMPLE_N = Number(arg("sample") ?? 20);

/** Transcript lines above this mean real work happened, whatever the prompt looked like. */
const LINE_CAP = 150;
/** Structural gate: a scripted call is one turn in, one answer out. */
const MAX_LINES = 20;
/** Titles are stored truncated at 80 chars, so this length means the payload was longer. */
const MIN_TITLE = 78;
/** Seconds. A batch call is over in under ten minutes; a conversation is not. */
const MAX_DURATION = 600;

/**
 * Openers of prompts written by a script rather than typed by the user. Anchored
 * at the start of the captured title. Kept explicit rather than generalised so
 * that a new automation family shows up as an unclassified row instead of
 * silently widening the net.
 */
const SYSTEM_PROMPTS: RegExp[] = [
  /^Read\nBEGIN_/,                                   // theme/card/fact/reconcile/hindsight/salience/drift synthesis
  /^You\nBEGIN_/,                                    // same family; the capture keeps whichever verb the caller used
  /^Summarize\nUSER:/,                               // title summariser
  /^Read the target company'?s raw text database/,   // leadership-report evidence pass
  /^Read the (extracted|operational) /,              // leadership-report evidence pass
  /^Read '[a-z_]+\//i,                               // leadership-report file-scoped pass
  /^\[SYSTEM\] You are /,                            // calibrated judge
  /^One of these two (short )?LinkedIn/,             // voice discriminator
  /^One of the two posts is a genuine/,
  /^One post is genuinely by futurist/,
  /^You are a precise writing collaborator/,
  /^You are a writing collaborator\./,
  /^You are building an episodic record/,
  /^You are writing entries for a procedural-memory/,
  /^You are extracting BEHAVIOURAL PREFERENCES/,
  /^You are mining a developer'?s past AI/,
  /^You are reading a cluster of work-session/,
  /^You are running the semantic tier/,
  /^You are about to start the task described/,
  /^You are a Context Interpreter/,
  /^You are a shot director/,
  /^You are a demanding editor/,
  /^You are a discerning editor/,
  /^You are an expert on the writing of/,
  /^You are a (rigorous )?forensic linguist/,
  /^You are a rigorous judge/,
  /^You are auditing whether a written/,
  /^You are comparing two plans/,
  /^You are performing deductive coding/,
  /^You are a qualitative research assistant/,
  /^You are a senior leadership-design/,
  /^You are a corporate research agent with WebSearch/,
  /^You are a public figure editing/,
  /^You know futurist a public figure/,
  /^You turn an example post/,
  /^You select the single best/,
  /^You explain why an edit was made/,
];

/** Second-person directive shape. Only ever consulted alongside the structural gate. */
const DIRECTIVE_OPENER = /^(You (are|know|turn|select|explain|will|must) |Read\n|Read the |Read '|\[SYSTEM\]|One of the |One of these |One post |Summarize\n|Rewrite\n|Given\n)/;

interface Row {
  sessionId: string; project?: string; cwd?: string; event?: string;
  lineCount?: number; at?: string; sessionStart?: string; sessionEnd?: string;
  title?: string; transcript?: string;
}
type Verdict = { automation: boolean; reason: string };

function durationSec(r: Row): number | null {
  if (!r.sessionStart || !r.sessionEnd) return null;
  const a = Date.parse(r.sessionStart), b = Date.parse(r.sessionEnd);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / 1000;
}

function classify(r: Row): Verdict {
  const title = r.title ?? "";
  const lines = r.lineCount ?? 0;
  if (lines < LINE_CAP) {
    for (const p of SYSTEM_PROMPTS) if (p.test(title)) return { automation: true, reason: "system-prompt" };
  }
  const d = durationSec(r);
  const structural = lines > 0 && lines < MAX_LINES
    && title.length >= MIN_TITLE
    && (d === null || d < MAX_DURATION)
    && DIRECTIVE_OPENER.test(title);
  if (structural) return { automation: true, reason: "structural" };
  return { automation: false, reason: lines >= LINE_CAP && SYSTEM_PROMPTS.some(p => p.test(title)) ? "long-session-scripted-opener" : "human" };
}

// ---------------------------------------------------------------- journal I/O

const HEADER = /^## (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?\s*\(([^)]*)\)\s*$/gm;

interface Entry { header: string; body: string; start: number; end: number; shortId: string | null; title: string }

function parseEntries(text: string): { head: string; entries: Entry[] } {
  HEADER.lastIndex = 0;
  const marks: { idx: number; end: number; inner: string; header: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = HEADER.exec(text))) marks.push({ idx: m.index, end: m.index + m[0].length, inner: m[3] ?? "", header: m[0] });
  if (!marks.length) return { head: text, entries: [] };
  const head = text.slice(0, marks[0]!.idx);
  const entries = marks.map((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1]!.idx : text.length;
    const body = text.slice(mk.end, end);
    const sid = /session ([0-9a-f]{6,})/.exec(mk.inner);
    // The capture writes the truncated prompt back as the entry's italic subtitle,
    // which is the only classifiable text an entry carries on its own. The prompt
    // often contains newlines, so the italic block spans lines.
    const sub = /^\s*_([\s\S]*?)_\s*$/m.exec(body.slice(0, 600));
    return { header: mk.header, body, start: mk.idx, end, shortId: sid ? sid[1]!.slice(0, 8) : null, title: sub ? sub[1]! : "" };
  });
  return { head, entries };
}

// ------------------------------------------------------------------ reporting

function pad(s: string | number, n: number) { return String(s).padEnd(n); }

interface Removal { kind: string; reason: string; file?: string; project?: string; sessionId?: string; at?: string; title?: string; text?: string }
const removals: Removal[] = [];

function flushRemovals() {
  if (!removals.length) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString();
  fs.appendFileSync(REMOVED_LOG, removals.map(r => JSON.stringify({ prunedAt: stamp, ...r })).join("\n") + "\n", "utf-8");
  console.log(`\nwrote ${removals.length} removed item(s) to ${path.relative(VAULT, REMOVED_LOG)}`);
}

// ------------------------------------------------------------------- sessions

function runSessions() {
  const raw = fs.readFileSync(LEDGER, "utf-8").split("\n").filter(l => l.trim());
  const rows: Row[] = [];
  const unparsed: string[] = [];
  for (const l of raw) { try { rows.push(JSON.parse(l)); } catch { unparsed.push(l); } }

  const verdicts = rows.map(classify);
  const autoIdx = new Set<number>();
  rows.forEach((_, i) => { if (verdicts[i]!.automation) autoIdx.add(i); });

  // A short id is only safe to strip from the journal if every ledger row that
  // shares it is automation; a session captured twice under two shapes is real.
  const byShort = new Map<string, { auto: number; total: number }>();
  rows.forEach((r, i) => {
    const s = r.sessionId?.slice(0, 8);
    if (!s) return;
    const e = byShort.get(s) ?? { auto: 0, total: 0 };
    e.total++; if (autoIdx.has(i)) e.auto++;
    byShort.set(s, e);
  });
  const autoShort = new Set([...byShort.entries()].filter(([, v]) => v.auto === v.total).map(([k]) => k));
  const knownShort = new Set(byShort.keys());

  const survivors = rows.filter((_, i) => !autoIdx.has(i));
  const distinctAll = new Set(rows.map(r => r.sessionId)).size;
  const distinctReal = new Set(survivors.map(r => r.sessionId)).size;

  // Per-project counts.
  const per = new Map<string, { auto: number; real: number }>();
  rows.forEach((r, i) => {
    const k = r.project || "(none)";
    const e = per.get(k) ?? { auto: 0, real: 0 };
    if (autoIdx.has(i)) e.auto++; else e.real++;
    per.set(k, e);
  });
  const byReason = new Map<string, number>();
  verdicts.forEach(v => { if (v.automation) byReason.set(v.reason, (byReason.get(v.reason) ?? 0) + 1); });

  console.log(`\n=== _sessions.jsonl ===`);
  console.log(`rows ${rows.length}  (unparsable ${unparsed.length})   distinct sessions ${distinctAll}`);
  console.log(`automation ${autoIdx.size}  [${[...byReason].map(([k, v]) => `${k} ${v}`).join(", ")}]`);
  console.log(`real rows ${survivors.length}   real distinct sessions ${distinctReal}`);
  console.log(`\n${pad("project", 38)}${pad("auto", 8)}${pad("real", 8)}`);
  for (const [k, v] of [...per.entries()].sort((a, b) => (b[1].auto + b[1].real) - (a[1].auto + a[1].real))) {
    console.log(`${pad(k.slice(0, 36), 38)}${pad(v.auto, 8)}${pad(v.real, 8)}`);
  }

  // Duplicate ledger rows, by sessionId, among survivors.
  const seen = new Map<string, number[]>();
  survivors.forEach((r, i) => { const a = seen.get(r.sessionId) ?? []; a.push(i); seen.set(r.sessionId, a); });
  const dupGroups = [...seen.values()].filter(a => a.length > 1);
  const dupExtra = dupGroups.reduce((n, a) => n + a.length - 1, 0);
  console.log(`\nduplicate ledger rows: ${dupGroups.length} session(s), ${dupExtra} redundant row(s)`);

  // Borderline sample: structural catches without a named family, plus long
  // sessions that opened with a scripted prompt and were therefore kept.
  const borderline: string[] = [];
  rows.forEach((r, i) => {
    const v = verdicts[i]!;
    const named = SYSTEM_PROMPTS.some(p => p.test(r.title ?? ""));
    if (v.automation && v.reason === "structural" && !named) borderline.push(`CUT  lines=${pad(r.lineCount ?? 0, 5)} ${pad(r.project ?? "", 22)} ${JSON.stringify((r.title ?? "").slice(0, 72))}`);
    else if (!v.automation && v.reason === "long-session-scripted-opener") borderline.push(`KEEP lines=${pad(r.lineCount ?? 0, 5)} ${pad(r.project ?? "", 22)} ${JSON.stringify((r.title ?? "").slice(0, 72))}`);
  });
  console.log(`\n--- borderline classifications (${Math.min(SAMPLE_N, borderline.length)} of ${borderline.length}) ---`);
  const step = Math.max(1, Math.floor(borderline.length / SAMPLE_N));
  for (let i = 0, shown = 0; i < borderline.length && shown < SAMPLE_N; i += step, shown++) console.log(borderline[i]);

  if (!APPLY) return { autoShort, knownShort, applied: false };

  // Rewrite the ledger: automation out, then one row per session (the row with
  // the most transcript lines, i.e. the capture that saw the most of it).
  const keptIdx: number[] = [];
  const best = new Map<string, number>();
  rows.forEach((r, i) => {
    if (autoIdx.has(i)) return;
    const cur = best.get(r.sessionId);
    if (cur === undefined || (rows[cur]!.lineCount ?? 0) < (r.lineCount ?? 0)) best.set(r.sessionId, i);
  });
  const keep = new Set(best.values());
  rows.forEach((r, i) => {
    if (keep.has(i)) { keptIdx.push(i); return; }
    const v = verdicts[i]!;
    removals.push({
      kind: "session-row", reason: autoIdx.has(i) ? v.reason : "duplicate-row",
      file: "journal/_sessions.jsonl", project: r.project, sessionId: r.sessionId, at: r.at,
      title: r.title, text: JSON.stringify(r),
    });
  });
  keptIdx.sort((a, b) => a - b);
  const out = keptIdx.map(i => JSON.stringify(rows[i])).concat(unparsed).join("\n") + "\n";
  fs.writeFileSync(LEDGER, out, "utf-8");
  console.log(`\n_sessions.jsonl rewritten: ${keptIdx.length} rows kept, ${rows.length - keptIdx.length} removed`);
  return { autoShort, knownShort, applied: true };
}

// -------------------------------------------------------------------- journal

function runJournal(autoShort: Set<string>, knownShort: Set<string>) {
  const files = fs.readdirSync(JOURNAL_DIR).filter(f => f.endsWith(".md")).sort();
  let totalEntries = 0, cutAuto = 0, cutDup = 0, filesChanged = 0;
  const perFile: { f: string; total: number; auto: number; dup: number }[] = [];

  for (const f of files) {
    const full = path.join(JOURNAL_DIR, f);
    const text = fs.readFileSync(full, "utf-8");
    const { head, entries } = parseEntries(text);
    if (!entries.length) continue;
    totalEntries += entries.length;

    const drop = new Set<number>();
    const dropReason = new Map<number, string>();
    entries.forEach((e, i) => {
      // The ledger is the better evidence, since it carries the transcript line
      // count and the session's duration. Where it has no row for this entry, the
      // entry's own subtitle is all there is, so fall back to a family match only.
      const byLedger = e.shortId !== null && autoShort.has(e.shortId);
      const unknown = e.shortId === null || !knownShort.has(e.shortId);
      const byTitle = unknown && e.title.length > 0 && SYSTEM_PROMPTS.some(p => p.test(e.title));
      if (byLedger || byTitle) { drop.add(i); dropReason.set(i, byLedger ? "automation" : "automation-by-title"); }
    });
    const auto = drop.size;

    // Repeat captures of one session: keep the fullest body, which is reliably
    // the one that is not a truncated or failed summary.
    const groups = new Map<string, number[]>();
    entries.forEach((e, i) => {
      if (drop.has(i) || !e.shortId) return;
      const a = groups.get(e.shortId) ?? []; a.push(i); groups.set(e.shortId, a);
    });
    let dup = 0;
    for (const idxs of groups.values()) {
      if (idxs.length < 2) continue;
      let bestI = idxs[0]!;
      for (const i of idxs) if (entries[i]!.body.length > entries[bestI]!.body.length) bestI = i;
      for (const i of idxs) if (i !== bestI) { drop.add(i); dropReason.set(i, "duplicate-entry"); dup++; }
    }

    cutAuto += auto; cutDup += dup;
    if (auto || dup) perFile.push({ f, total: entries.length, auto, dup });
    if (!APPLY || !drop.size) continue;

    for (const i of [...drop].sort((a, b) => a - b)) {
      const e = entries[i]!;
      removals.push({
        kind: "journal-entry", reason: dropReason.get(i) ?? "duplicate-entry",
        file: `journal/${f}`, sessionId: e.shortId ?? undefined, title: e.title,
        text: e.header + e.body,
      });
    }
    const kept = entries.filter((_, i) => !drop.has(i)).map(e => e.header + e.body).join("");
    fs.writeFileSync(full, head + kept, "utf-8");
    filesChanged++;
  }

  console.log(`\n=== journal/*.md ===`);
  console.log(`dated entries ${totalEntries}   automation ${cutAuto}   duplicate ${cutDup}   surviving ${totalEntries - cutAuto - cutDup}`);
  console.log(`\n${pad("file", 44)}${pad("entries", 10)}${pad("auto", 8)}${pad("dup", 8)}`);
  for (const p of perFile.sort((a, b) => (b.auto + b.dup) - (a.auto + a.dup)).slice(0, 25)) {
    console.log(`${pad(p.f.slice(0, 42), 44)}${pad(p.total, 10)}${pad(p.auto, 8)}${pad(p.dup, 8)}`);
  }
  if (APPLY) console.log(`\n${filesChanged} journal file(s) rewritten`);
}

// --------------------------------------------------------------------- themes

function runThemes() {
  const files = fs.readdirSync(THEMES_DIR).filter(f => f.endsWith(".md"));
  interface T { f: string; slug: string; mtime: number; stub: boolean; size: number }
  const cards: T[] = files.map(f => {
    const full = path.join(THEMES_DIR, f);
    const body = fs.readFileSync(full, "utf-8");
    return {
      f, slug: f.replace(/^\d+-/, ""),
      mtime: fs.statSync(full).mtimeMs,
      // The generator writes this line instead of a card when its model call fails.
      stub: /auto theme card unavailable/.test(body),
      size: body.length,
    };
  });
  const slugs = new Map<string, T[]>();
  for (const c of cards) { const a = slugs.get(c.slug) ?? []; a.push(c); slugs.set(c.slug, a); }

  const dropStub = cards.filter(c => c.stub);
  const keep = new Set<string>();
  const dropDup: T[] = [];
  for (const [, group] of slugs) {
    const real = group.filter(c => !c.stub).sort((a, b) => b.mtime - a.mtime);
    if (!real.length) continue;                       // every card for this slug failed; nothing to keep
    keep.add(real[0]!.f);
    dropDup.push(...real.slice(1));
  }

  console.log(`\n=== themes/ ===`);
  console.log(`files ${cards.length}   distinct slugs ${slugs.size}   stubs ${dropStub.length}`);
  console.log(`keep ${keep.size}   drop ${dropStub.length + dropDup.length}  (stub ${dropStub.length}, duplicate ${dropDup.length})`);
  const affected = [...slugs.entries()].filter(([, g]) => g.length > 1).sort((a, b) => b[1].length - a[1].length);
  console.log(`\nslugs with more than one file: ${affected.length}`);
  console.log(`${pad("slug", 46)}${pad("files", 8)}kept`);
  for (const [s, g] of affected) {
    const k = g.find(c => keep.has(c.f));
    console.log(`${pad(s.replace(/\.md$/, "").slice(0, 44), 46)}${pad(g.length, 8)}${k ? k.f : "(none - all stubs)"}`);
  }

  if (!APPLY) return;
  for (const c of [...dropStub, ...dropDup]) {
    if (keep.has(c.f)) continue;
    const full = path.join(THEMES_DIR, c.f);
    removals.push({
      kind: "theme-file", reason: c.stub ? "stub" : "duplicate-slug",
      file: `themes/${c.f}`, title: c.slug, text: fs.readFileSync(full, "utf-8"),
    });
    fs.unlinkSync(full);
  }
  console.log(`\ndeleted ${removals.filter(r => r.kind === "theme-file").length} theme file(s); ${fs.readdirSync(THEMES_DIR).filter(f => f.endsWith(".md")).length} remain`);
}

// ----------------------------------------------------------------------- main

function main() {
  console.log(APPLY ? "MODE: APPLY (mutating)" : "MODE: dry-run (no writes; pass --apply to mutate)");
  if (has("themes")) {
    runThemes();
  } else {
    const { autoShort, knownShort } = runSessions();
    runJournal(autoShort, knownShort);
  }
  if (APPLY) flushRemovals();
}

main();
