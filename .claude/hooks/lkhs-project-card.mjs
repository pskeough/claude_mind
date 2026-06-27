#!/usr/bin/env node
/**
 * LKHS SessionStart hook (global). Cross-platform Node port.
 *
 * On every session start in any project, finds that project's L2 state card
 * (cards/<project>.md in the central vault) and injects it, so you resume with
 * "here is where you left off". Also surfaces the lkhs-memory MCP tools so any
 * session reaches for the user's persistent memory, and ensures the retrieval
 * daemon is warm. Pure best-effort: only stdout is the JSON envelope.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

async function main() {
  if (process.env.LKHS_CAPTURE) return; // never inject into our own headless sessions

  const raw = await readStdin();
  let cwd = null;
  if (raw) { try { cwd = JSON.parse(raw).cwd; } catch {} }
  if (!cwd) cwd = process.cwd();

  // Central vault + identity from config.
  const cfgPath = path.join(os.homedir(), ".claude", "lkhs-capture-config.json");
  let vault = null, port = 7077, ownerLabel = "the user";
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    vault = cfg.centralVault;
    if (cfg.daemonPort) port = cfg.daemonPort;
    if (cfg.personaHub?.label) ownerLabel = cfg.personaHub.label;
  } catch {}
  if (!vault || !fs.existsSync(vault)) return;

  // Fall back to core_profile display name if config has no personaHub label.
  if (ownerLabel === "the user") {
    try {
      const cp = JSON.parse(fs.readFileSync(path.join(vault, ".claude", "memory", "core_profile.json"), "utf8"));
      ownerLabel = cp?.user?.display_name || cp?.user?.legal_name || ownerLabel;
    } catch {}
  }

  // Ensure the retrieval daemon is up.
  if (!(await daemonUp(port))) {
    try {
      const p = spawn("node", ["--import", "tsx", ".claude/bin/lkhs-daemon.ts"],
        { cwd: vault, detached: true, stdio: "ignore", windowsHide: true });
      p.unref();
    } catch {}
  }

  // Project slug = sanitized basename of cwd (matches capture-session.projectSlug).
  const base = path.basename(String(cwd).replace(/[\\/]+$/, ""));
  if (!base) return;
  const slug = base.replace(/[^A-Za-z0-9._-]/g, "-");

  const owner = ownerLabel === "the user" ? "the user" : ownerLabel;
  let ctx = `Claude Mind / LKHS persistent memory is available for ${owner}. For ANY question about past work, projects, decisions, portfolio, profile, research, or writing (including "what did I/we do", "how did I", "where did I leave X", "is X worth it for my career"), call the lkhs-memory MCP tools (search_memory, project_state, timeline, related, explore, user_profile) BEFORE answering or using generic session-history tools. Ground-truth profile lives in the ClaudeMind vault: .claude/memory/core_profile.json.`;

  const card = path.join(vault, "cards", slug + ".md");
  if (fs.existsSync(card)) {
    const body = fs.readFileSync(card, "utf8").replace(/^---[\s\S]*?---\s*/, "");
    if (body.trim()) {
      ctx += `\n\nProject state card for "${slug}" (where you left off, synthesized from past sessions; may be slightly stale, verify against the live repo):\n\n${body}`;
    }
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx },
  }));
}

async function daemonUp(port) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1000);
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
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
