#!/usr/bin/env node
/**
 * LKHS global session-capture hook. Cross-platform Node port.
 *
 * Registered on SessionEnd and PreCompact in the GLOBAL ~/.claude/settings.json,
 * so it fires for every Claude Code project. It ships the finished (or compacting)
 * session into the central LKHS vault as per-project journal history + embeddings.
 *
 * Does almost nothing itself: validates, applies the exclude-list, then spawns the
 * capture worker DETACHED so it never delays session exit. All real work (parse,
 * redact, summarize via `claude -p`, embed) happens in capture-session.ts.
 *
 * Recursion guard: the worker runs `claude -p` to summarize, which would itself fire
 * this hook on its own SessionEnd. We set LKHS_CAPTURE=1 for that child and bail
 * immediately if we see it.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

async function main() {
  if (process.env.LKHS_CAPTURE) return; // recursion guard

  const raw = await readStdin();
  if (!raw) return;
  let j;
  try { j = JSON.parse(raw); } catch { return; }

  const transcript = j.transcript_path;
  const cwd = j.cwd || "";
  const sessionId = j.session_id || "unknown";
  const event = j.hook_event_name || "SessionEnd";
  if (!transcript) return;

  const cfgPath = path.join(os.homedir(), ".claude", "lkhs-capture-config.json");
  if (!fs.existsSync(cfgPath)) return;
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch { return; }
  const vault = cfg.centralVault;
  if (!vault || !fs.existsSync(vault)) return;

  // Exclude-list: skip if the triggering project is under any excluded path.
  const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (Array.isArray(cfg.exclude)) {
    const c = norm(cwd);
    for (const ex of cfg.exclude) {
      if (!ex) continue;
      const e = norm(ex);
      if (c === e || c.startsWith(e + "/")) return;
    }
  }

  // Audit line.
  try {
    const logFile = path.join(vault, ".claude", "logs", "ambient.log");
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const shortId = String(sessionId).slice(0, 8);
    fs.appendFileSync(logFile, `[${stamp}] capture-hook:fired event=${event} cwd=${cwd} session=${shortId}\n`);
  } catch {}

  // Hand off to the worker, detached. Inputs go via env (avoids arg-quoting issues
  // with spaced paths). Script path is relative to the vault, so it is space-free.
  const env = {
    ...process.env,
    LKHS_CAPTURE: "1",
    LKHS_TRANSCRIPT: transcript,
    LKHS_CWD: cwd,
    LKHS_SESSION: sessionId,
    LKHS_EVENT: event,
  };
  if (cfg.summaryModel) env.LKHS_SUMMARY_MODEL = cfg.summaryModel;

  try {
    const p = spawn("node", ["--import", "tsx", ".claude/bin/capture-session.ts"],
      { cwd: vault, detached: true, stdio: "ignore", windowsHide: true, env });
    p.unref();
  } catch {}
}

function readStdin() {
  return new Promise((resolve) => {
    let s = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => resolve(s));
    process.stdin.on("error", () => resolve(s));
  });
}

main().catch(() => {});
