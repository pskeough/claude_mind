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

const PROJECTS_DIR = path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "projects");
const CONFIG = path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "lkhs-capture-config.json");

function has(flag: string): boolean { return process.argv.includes(`--${flag}`); }
function val(flag: string): string | undefined { const i = process.argv.indexOf(`--${flag}`); return i >= 0 ? process.argv[i + 1] : undefined; }

function loadExclude(): string[] {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf-8"));
    return (cfg.exclude || []).map((e: string) => e.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase());
  } catch { return []; }
}

function excluded(cwd: string, list: string[]): boolean {
  const c = cwd.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return list.some(ex => ex && (c === ex || c.startsWith(ex + "\\")));
}

/** Read the cwd recorded inside a transcript. Only reads the file head (cwd
 *  appears on the first turn), so large transcripts are not loaded whole. */
function transcriptCwd(file: string): string {
  let head = "";
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    head = buf.toString("utf-8", 0, n);
  } finally { fs.closeSync(fd); }
  for (const l of head.split("\n")) {
    if (!l.trim()) continue;
    try { const o = JSON.parse(l); if (o.cwd) return o.cwd; } catch { /* partial last line */ }
  }
  return "unknown";
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
  const SWEEPLOCK = path.join(process.cwd(), "journal", ".sweep.lock");
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

  let considered = 0, captured = 0, skipped = 0, excl = 0, active = 0;
  for (const file of transcripts) {
    const mtime = fs.statSync(file).mtimeMs;
    if (mtime > settleCutoff) { active++; continue; } // still being written; let it settle
    if (!all && mtime < cutoff) continue;
    considered++;

    const cwd = transcriptCwd(file);
    if (excluded(cwd, exclude)) { excl++; continue; }
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
  console.log(`\nSweep done. considered=${considered} captured=${captured} skipped=${skipped} excluded=${excl} active=${active} (window: ${all ? "all" : hours + "h"})`);
}

main().catch(e => { console.error(e); process.exit(1); });
