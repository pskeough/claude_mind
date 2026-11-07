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
 *
 * Also sweeps Claude Desktop Cowork transcripts (local-agent-mode-sessions), which
 * land in journal/Cowork.md with source claude-cowork.
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

/** Claude Desktop's Cowork mode runs a Claude Code agent per task and keeps its
 *  transcripts (same .jsonl format) under local-agent-mode-sessions, inside the
 *  Desktop data folder rather than ~/.claude/projects:
 *    Windows  %LOCALAPPDATA%\Claude-Data\<claude_hash>\local-agent-mode-sessions (Store build)
 *             %APPDATA%\Claude\local-agent-mode-sessions (classic installer)
 *    macOS    ~/Library/Application Support/Claude/local-agent-mode-sessions
 *    Linux    ~/.config/Claude/local-agent-mode-sessions
 *  Returns every <...>/.claude/projects directory found below those roots. */
function coworkProjectDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const roots: string[] = [];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    try {
      for (const d of fs.readdirSync(path.join(local, "Claude-Data"))) roots.push(path.join(local, "Claude-Data", d, "local-agent-mode-sessions"));
    } catch { /* no Store build */ }
    roots.push(path.join(appData, "Claude", "local-agent-mode-sessions"));
  } else if (process.platform === "darwin") {
    roots.push(path.join(home, "Library", "Application Support", "Claude", "local-agent-mode-sessions"));
  } else {
    roots.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude", "local-agent-mode-sessions"));
  }
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8) return;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name === "node_modules") continue;
      const abs = path.join(dir, e.name);
      if (e.name === ".claude") { const p = path.join(abs, "projects"); if (fs.existsSync(p)) out.push(p); continue; }
      walk(abs, depth + 1);
    }
  };
  for (const r of roots) if (fs.existsSync(r)) walk(r, 0);
  return out;
}

const HEAD_BYTES = 262144;

/** Read a transcript's head once (cwd is on the first turn; automation markers
 *  are in the first user message), so large transcripts are not loaded whole. */
function transcriptHead(file: string): string {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
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
// the user's own headless -p sessions match none of these and stay captured
// (they are exactly what the sweep exists to cover).
// The marker list was enumerated by hand and went stale: salience, hindsight, drift,
// reconcile, cluster, card and counterfactual runs all grew their own BEGIN_ markers
// that were never added here, so their transcripts entered the ledger as real
// sessions. Each such capture spawns another `claude -p` summarizer, which writes
// another transcript, which the next sweep captures — a self-feeding loop that pinned
// the CPU for hours (2026-08-13). Match the BEGIN_ marker FAMILY rather than a fixed
// list so a new automation kind is covered the day it is written. The miners whose
// prompts carry no BEGIN_ marker are matched on their opening instruction line.
const AUTOMATION_RE = /BEGIN_[A-Z][A-Z_]{3,}|output ONLY the requested JSON|LKHS ambient compile|archivist instructions|injected by a personal memory system under a privacy profile|You are writing entries for a procedural-memory ledger|You are extracting BEHAVIOURAL PREFERENCES|You are building an (evaluation question set|episodic record)|You are mining a developer's past AI-assistant sessions|<scheduled-task name="hearth-calendar-cache"|Review this change for security vulnerabilities\./;
function matchesAutomationPrompt(head: string): boolean {
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
  // No COMPLETE user turn inside the head buffer. An automation payload is a single
  // JSON line carrying a whole pasted session log, and the big ones overflow the
  // buffer, so every line fails to parse and the loop above falls through. Those are
  // precisely the largest automation runs, and returning false here sent them to the
  // summarizer as if they were the user's own sessions. Scan the raw head instead:
  // the markers are distinctive enough to be safe as a last resort.
  return AUTOMATION_RE.test(head);
}

/** The human turns in the head, in order. Tool results, system-injected blocks and
 *  interrupt notices are not things a person typed. */
function humanTurns(head: string): string[] {
  const turns: string[] = [];
  for (const l of head.split("\n")) {
    if (!l.trim()) continue;
    let o: any; try { o = JSON.parse(l); } catch { continue; }
    if (o.type !== "user") continue;
    const c = o.message?.content;
    let t = "";
    if (typeof c === "string") t = c;
    else if (Array.isArray(c)) {
      if (c.some((b: any) => b?.type === "tool_result")) continue;
      t = c.map((b: any) => (b?.type === "text" ? b.text || "" : "")).join("\n");
    }
    t = t.trim();
    if (!t || t.startsWith("<")) continue;                       // system-shaped injection
    if (/^(Caveat:|\[Request interrupted)/.test(t)) continue;
    turns.push(t);
  }
  return turns;
}

// A prompt payload and a worked session have inverse SHAPES, and the shape holds for
// automation nobody has named yet. A `claude -p` call is one enormous instruction
// followed by a handful of reply lines; a session someone sat through opens with a
// short line and accumulates turns. All three conditions have to hold together, so a
// long opening prompt is not enough on its own to disqualify a real session: it also
// has to be the ONLY human turn and the transcript has to end almost immediately.
// The whole file must fit in the head buffer, because the line count is otherwise
// unknown and a guess in that direction would discard real work.
const SOLO_PROMPT_CHARS = 600;
const SHORT_TRANSCRIPT_LINES = 20;
function isPromptPayload(head: string, bytes: number): boolean {
  if (bytes > HEAD_BYTES) return false;
  if (head.split("\n").filter(l => l.trim()).length >= SHORT_TRANSCRIPT_LINES) return false;
  const turns = humanTurns(head);
  return turns.length === 1 && turns[0]!.length > SOLO_PROMPT_CHARS;
}

async function main() {
  if (!fs.existsSync(PROJECTS_DIR) && coworkProjectDirs().length === 0) { console.error("No projects dir:", PROJECTS_DIR); process.exit(1); }

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
      // Stale = the holder is dead. Age alone was the old test, and a 2.4h burst sweep
      // (2026-10-26) outlived the 2h window, so the next hourly run started a second
      // concurrent sweep beside it. Age still frees a lock whose PID was reused.
      try {
        const holder = Number(fs.readFileSync(SWEEPLOCK, "utf-8").trim());
        let alive = false;
        try { if (holder > 0) { process.kill(holder, 0); alive = true; } } catch { alive = false; }
        stale = !alive || Date.now() - fs.statSync(SWEEPLOCK).mtimeMs > 6 * 3600_000;
      } catch { stale = true; }
      if (!stale) { console.log("Another sweep is already running; exiting."); return; }
      try { fs.unlinkSync(SWEEPLOCK); fs.writeFileSync(SWEEPLOCK, String(process.pid), { flag: "wx" }); }
      catch { console.log("Could not acquire sweep lock; exiting."); return; }
    }
    // Release on ANY exit path, not just the happy one. A throw mid-loop used to
    // skip the unlink at the end of main(), so the next hourly run found a live
    // lock and refused to start until the 2h staleness window expired.
    process.on("exit", () => { try { fs.unlinkSync(SWEEPLOCK); } catch { /* already gone */ } });
  }

  // Recursion guard for the summarizer calls captureSession spawns.
  process.env.LKHS_CAPTURE = "1";

  // Apply the configured summary model toggle (env wins if already set).
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf-8"));
    if (cfg.summaryModel && !process.env.LKHS_SUMMARY_MODEL) process.env.LKHS_SUMMARY_MODEL = cfg.summaryModel;
  } catch { /* default model */ }

  const transcripts: string[] = [];
  const cowork = new Set<string>();
  const projectRoots = [PROJECTS_DIR, ...coworkProjectDirs()];
  for (const root of projectRoots) {
    let dirs: string[] = [];
    try { dirs = fs.readdirSync(root); } catch { continue; }
    for (const dir of dirs) {
      const abs = path.join(root, dir);
      try { if (!fs.statSync(abs).isDirectory()) continue; } catch { continue; }
      for (const f of fs.readdirSync(abs)) {
        if (!f.endsWith(".jsonl")) continue;
        transcripts.push(path.join(abs, f));
        if (root !== PROJECTS_DIR) cowork.add(path.join(abs, f));
      }
    }
  }

  let considered = 0, captured = 0, skipped = 0, excl = 0, active = 0, automation = 0, structural = 0, vanished = 0;
  for (const file of transcripts) {
    // A transcript can disappear between the readdir scan above and this stat.
    // An unhandled ENOENT here aborted the whole sweep mid-run and left the lock
    // behind, which then blocked every later run for two hours.
    let mtime: number, bytes: number;
    try { const st = fs.statSync(file); mtime = st.mtimeMs; bytes = st.size; } catch { vanished++; continue; }
    if (mtime > settleCutoff) { active++; continue; } // still being written; let it settle
    if (!all && mtime < cutoff) continue;
    considered++;

    const head = transcriptHead(file);
    const cwd = transcriptCwd(head);
    if (excluded(cwd, exclude)) { excl++; continue; }
    // Named prompt families first (one regex test), then the shape test that covers
    // every other pipeline's `claude -p` calls without needing their prompts enumerated.
    if (matchesAutomationPrompt(head)) { automation++; continue; }
    if (isPromptPayload(head, bytes)) { automation++; structural++; continue; }
    const sessionId = path.basename(file, ".jsonl");

    if (dry) {
      console.log(`would capture  ${cowork.has(file) ? "Cowork" : path.basename(cwd)}  ${sessionId.slice(0, 8)}  (${new Date(mtime).toISOString().slice(0, 16)})`);
      continue;
    }

    const result = await captureSession(cowork.has(file)
      ? { transcript: file, cwd, sessionId, event: "sweep", project: "Cowork", source: "claude-cowork" }
      : { transcript: file, cwd, sessionId, event: "sweep" });
    if (result === "ok") { captured++; console.log(`captured  ${cowork.has(file) ? "Cowork" : path.basename(cwd)}  ${sessionId.slice(0, 8)}`); }
    else skipped++;
  }

  if (!dry) { try { fs.unlinkSync(SWEEPLOCK); } catch { /* gone */ } }
  console.log(`\nSweep done. considered=${considered} captured=${captured} skipped=${skipped} excluded=${excl} automation=${automation} (${structural} by shape) active=${active} vanished=${vanished} (window: ${all ? "all" : hours + "h"})`);
}

// Exit explicitly: once the embedder has loaded, a handle keeps the loop alive, and the
// finished sweep sat idle until Task Scheduler's 45-minute limit killed it, so the task
// read "Running" most of every hour (2026-10-30).
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
