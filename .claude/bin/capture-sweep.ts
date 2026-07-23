/**
 * LKHS capture sweep: mode-independent backstop for the SessionEnd hook.
 *
 * Scans every Claude Code transcript on disk and captures any that are new or
 * have grown since last capture. Because it reads the .jsonl files directly, it
 * works regardless of whether lifecycle hooks fired (covers headless -p sessions,
 * terminals closed without a clean exit, etc). The ledger dedup means re-running
 * is cheap and safe.
 *
 *   npm run capture:sweep            # last 72h, real capture
 *   npm run capture:sweep -- --dry   # list what would be captured, no model calls
 *   npm run capture:sweep -- --hours 24
 *   npm run capture:sweep -- --all   # full backfill (every session ever; expensive)
 */
import * as fs from "fs";
import * as path from "path";
import { captureSession } from "./capture-session";
import { vaultRoot } from "./config";

const PROJECTS_DIR = path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "projects");
const CONFIG = path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "lkhs-capture-config.json");

function has(flag: string): boolean { return process.argv.includes(`--${flag}`); }
function val(flag: string): string | undefined { const i = process.argv.indexOf(`--${flag}`); return i >= 0 ? process.argv[i + 1] : undefined; }

// Normalize both sides to forward slashes + lowercase so exclude matching is
// OS-independent (config may hold either separator style).
const normPath = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

function loadExclude(): string[] {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf-8"));
    return (cfg.exclude || []).map((e: string) => normPath(e));
  } catch { return []; }
}

function excluded(cwd: string, list: string[]): boolean {
  const c = normPath(cwd);
  return list.some(ex => ex && (c === ex || c.startsWith(ex + "/")));
}

/** Read a transcript's head once (cwd is on the first turn; automation markers
 *  are in the first user message), so large transcripts are not loaded whole. */
function transcriptHead(file: string): string {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.toString("utf-8", 0, n);
  } finally { fs.closeSync(fd); }
}

function transcriptCwd(head: string): string {
  for (const l of head.split("\n")) {
    if (!l.trim()) continue;
    try { const o = JSON.parse(l); if (o.cwd) return o.cwd; } catch { /* partial last line */ }
  }
  return "unknown";
}

// LKHS's own `claude -p` automation (judges, evals, miners, summarizers,
// ambient compiles) must not enter the ledger as sessions: it polluted the
// session ledger with hundreds of micro-entries (2026-07-23 weekly report:
// 225 in one week). The spawns set LKHS_CAPTURE=1, but env is invisible in
// the transcript — the STABLE INSTRUCTION PHRASES are the durable signature.
// The user's own headless -p sessions match none of these and stay captured
// (they are exactly what the sweep exists to cover).
const AUTOMATION_RE = /output ONLY the requested JSON|BEGIN_FACTS|BEGIN_CONVERSATION|BEGIN_SESSION_LOG|BEGIN_PROJECT_DIGEST|LKHS ambient compile|archivist instructions|injected by a personal memory system under a privacy profile/;
function isAutomation(head: string): boolean {
  for (const l of head.split("\n")) {
    if (!l.trim()) continue;
    try {
      const o = JSON.parse(l);
      if (o.type !== "user") continue;
      const c = o.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => b?.text || "").join("\n") : "";
      return AUTOMATION_RE.test(text);   // decide on the FIRST user turn only
    } catch { /* partial line */ }
  }
  return false;
}

async function main() {
  if (!fs.existsSync(PROJECTS_DIR)) { console.error("No projects dir:", PROJECTS_DIR); process.exit(1); }

  const dry = has("dry");
  const all = has("all");
  const hours = Number(val("hours") ?? 72);
  const cutoff = Date.now() - hours * 3600_000;
  const settleCutoff = Date.now() - Number(val("settle") ?? 15) * 60_000; // skip files still being written
  const exclude = loadExclude();

  // Sweep singleton: never let two sweeps run at once (would double-capture).
  const SWEEPLOCK = path.join(vaultRoot(), "journal", ".sweep.lock");
  if (!dry) {
    fs.mkdirSync(path.dirname(SWEEPLOCK), { recursive: true });
    try { fs.writeFileSync(SWEEPLOCK, String(process.pid), { flag: "wx" }); }
    catch {
      let stale = false;
      try { stale = Date.now() - fs.statSync(SWEEPLOCK).mtimeMs > 7200_000; } catch { stale = true; }
      if (!stale) { console.log("Another sweep is already running; exiting."); return; }
      try { fs.unlinkSync(SWEEPLOCK); fs.writeFileSync(SWEEPLOCK, String(process.pid), { flag: "wx" }); }
      catch { console.log("Could not acquire sweep lock; exiting."); return; }
    }
  }

  // Recursion guard for the summarizer calls captureSession spawns.
  process.env.LKHS_CAPTURE = "1";

  // Apply the configured summary model toggle (env wins if already set).
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf-8"));
    if (cfg.summaryModel && !process.env.LKHS_SUMMARY_MODEL) process.env.LKHS_SUMMARY_MODEL = cfg.summaryModel;
  } catch { /* default model */ }

  const transcripts: string[] = [];
  for (const dir of fs.readdirSync(PROJECTS_DIR)) {
    const abs = path.join(PROJECTS_DIR, dir);
    if (!fs.statSync(abs).isDirectory()) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith(".jsonl")) transcripts.push(path.join(abs, f));
    }
  }

  let considered = 0, captured = 0, skipped = 0, excl = 0, active = 0, automation = 0;
  for (const file of transcripts) {
    const mtime = fs.statSync(file).mtimeMs;
    if (mtime > settleCutoff) { active++; continue; } // still being written; let it settle
    if (!all && mtime < cutoff) continue;
    considered++;

    const head = transcriptHead(file);
    const cwd = transcriptCwd(head);
    if (excluded(cwd, exclude)) { excl++; continue; }
    if (isAutomation(head)) { automation++; continue; } // LKHS's own claude -p runs
    const sessionId = path.basename(file, ".jsonl");

    if (dry) {
      console.log(`would capture  ${path.basename(cwd)}  ${sessionId.slice(0, 8)}  (${new Date(mtime).toISOString().slice(0, 16)})`);
      continue;
    }

    const result = await captureSession({ transcript: file, cwd, sessionId, event: "sweep" });
    if (result === "ok") { captured++; console.log(`captured  ${path.basename(cwd)}  ${sessionId.slice(0, 8)}`); }
    else skipped++;
  }

  if (!dry) { try { fs.unlinkSync(SWEEPLOCK); } catch { /* gone */ } }
  console.log(`\nSweep done. considered=${considered} captured=${captured} skipped=${skipped} excluded=${excl} automation=${automation} active=${active} (window: ${all ? "all" : hours + "h"})`);
}

main().catch(e => { console.error(e); process.exit(1); });
