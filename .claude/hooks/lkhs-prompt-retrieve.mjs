#!/usr/bin/env node
/**
 * LKHS UserPromptSubmit hook (global). Cross-platform Node port.
 *
 * On every prompt (in any project), asks the warm daemon whether the user's own
 * knowledge base is relevant to this prompt. If so, injects the top deduped sources
 * as optional context and asks the model to cite what it used.
 *
 * The daemon does the real work (intent gate + warm retrieval). This hook is a thin,
 * fast bridge. If the daemon is down it starts it detached and skips injection for
 * this one turn (warm by the next). Only stdout is the JSON envelope; failures never
 * block the prompt.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

async function main() {
  // Never retrieve for our own summarizer/automation sessions.
  if (process.env.LKHS_CAPTURE) return;

  const raw = await readStdin();
  if (!raw) return;
  let j;
  try { j = JSON.parse(raw); } catch { return; }
  const prompt = j.prompt;
  if (!prompt || prompt.length < 12) return;

  // config: daemon port + vault path (for lazy start)
  let port = 7077, vault = null;
  try {
    const cfg = JSON.parse(fs.readFileSync(
      path.join(os.homedir(), ".claude", "lkhs-capture-config.json"), "utf8"));
    if (cfg.daemonPort) port = cfg.daemonPort;
    vault = cfg.centralVault;
  } catch {}

  let resp = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`http://127.0.0.1:${port}/gate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (r.ok) resp = await r.json();
  } catch {
    // daemon not up: start it detached, skip injection this turn (warm next time)
    if (vault && fs.existsSync(vault)) {
      try {
        const p = spawn("node", ["--import", "tsx", ".claude/bin/lkhs-daemon.ts"],
          { cwd: vault, detached: true, stdio: "ignore", windowsHide: true });
        p.unref();
      } catch {}
    }
    return;
  }

  if (!resp || !resp.inject) return;

  const lines = (resp.hits || [])
    .map((h) => `- (source: ${h.file}, score ${h.score}) ${h.text}`)
    .join("\n");
  const ctx = `[LKHS memory] Possibly relevant material from the user's own knowledge base (past Claude Code sessions + ingested project files), retrieved for this request. Use ONLY what is genuinely relevant; ignore the rest; do not fabricate from it.
${lines}

If you draw on any of the above, begin your reply with a single line: [memory: <comma-separated source paths you used>] so the user can see and verify what was pulled from their knowledge base.`;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx },
  }));
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
