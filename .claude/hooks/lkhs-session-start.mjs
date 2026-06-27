#!/usr/bin/env node
/**
 * LKHS SessionStart hook (repo-scoped). Cross-platform Node port of the original
 * PowerShell hook so it runs identically on macOS, Linux, and Windows.
 *
 * Two jobs on every session start in this vault:
 *   1. Ensure the ambient watcher + warm retrieval daemon are running (singleton;
 *      the watcher's own PID lock prevents duplicates, this just avoids redundant procs).
 *   2. Emit an additionalContext JSON envelope so every session boots grounded in
 *      the live vault: watcher status, memory pointers, the retrieval command, the
 *      current namespace map from VAULT-INDEX.md, and the always-on persona card.
 *
 * The ONLY thing written to stdout is the JSON envelope. Failures are swallowed so
 * they never break a session.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

function emit(ctx) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx },
  }));
}

function spawnDetached(scriptRel, cwd) {
  try {
    const p = spawn("node", ["--import", "tsx", scriptRel], {
      cwd, detached: true, stdio: "ignore", windowsHide: true,
    });
    p.unref();
    return true;
  } catch { return false; }
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

try {
  // Resolve vault root: prefer the env var Claude Code sets, else walk up from here.
  let root = process.env.CLAUDE_PROJECT_DIR;
  if (!root || !fs.existsSync(root)) {
    root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
    // On Windows the pathname has a leading slash before the drive; normalize.
    if (process.platform === "win32" && /^[/\\][A-Za-z]:/.test(root)) root = root.slice(1);
  }

  // --- 1. Ensure watcher running ------------------------------------------
  const lock = path.join(root, ".claude", "watcher.lock");
  let watcherStatus = "unknown";
  let alive = false;
  if (fs.existsSync(lock)) {
    const pid = parseInt(String(fs.readFileSync(lock, "utf8")).trim(), 10);
    if (Number.isInteger(pid)) {
      try { process.kill(pid, 0); alive = true; watcherStatus = `running (pid ${pid})`; } catch {}
    }
  }
  if (!alive) {
    watcherStatus = spawnDetached(".claude/bin/ambient-watcher.ts", root)
      ? "started this session" : "start failed";
  }

  // --- 1b. Ensure the warm retrieval daemon is up -------------------------
  let port = 7077;
  try {
    const cfg = JSON.parse(fs.readFileSync(
      path.join(process.env.HOME || process.env.USERPROFILE, ".claude", "lkhs-capture-config.json"), "utf8"));
    if (cfg.daemonPort) port = cfg.daemonPort;
  } catch {}
  if (!(await daemonUp(port))) spawnDetached(".claude/bin/lkhs-daemon.ts", root);

  // --- 2. Gather live vault state -----------------------------------------
  let namespace = "";
  const indexPath = path.join(root, "VAULT-INDEX.md");
  if (fs.existsSync(indexPath)) {
    const idx = fs.readFileSync(indexPath, "utf8");
    const m = idx.match(/AUTO-NAMESPACE-START -->([\s\S]*?)<!-- AUTO-NAMESPACE-END/);
    if (m) namespace = m[1].trim();
  }

  const domainDir = path.join(root, ".claude", "memory", "domains");
  let tiles = [];
  if (fs.existsSync(domainDir)) {
    tiles = fs.readdirSync(domainDir)
      .filter((f) => f.endsWith(".json") && f !== "_schema.json")
      .map((f) => f.replace(/\.json$/, ""));
  }
  const tileList = tiles.length ? tiles.join(", ") : "(none)";

  // --- 2b. Always-on persona card -----------------------------------------
  let persona = "";
  const profilePath = path.join(root, "persona", "PROFILE.md");
  if (fs.existsSync(profilePath)) persona = fs.readFileSync(profilePath, "utf8").trim();

  // --- 3. Build + emit context --------------------------------------------
  let ctx = `LKHS ACTIVE (Local Knowledge Hybridization System) for this vault.

Ambient watcher: ${watcherStatus}. It embeds every changed markdown file and runs an autonomous wiki-compile pass when a file is added under raw/. Activity log: .claude/logs/ambient.log.

Ground truth lives in .claude/memory/ (MEMORY.md router, core_profile.json protected profile, domain tiles). Structural map: VAULT-INDEX.md. Do not walk directories blindly; use the namespace map below, then semantic search.

Semantic retrieval (use before reading wiki files):
  npx tsx .claude/bin/vector-query.ts "<query>"

Workflow: drop a markdown file in raw/ and the watcher auto-ingests it into wiki/ and regenerates the index. Manual passes: npm run wiki:fix, npm run dream, npm run embed (full reindex).

Domain tiles available: ${tileList}

Vault namespace map:
${namespace}`;

  if (persona) {
    ctx += `\n\n\n=== PERSONA (deep user model, heavily weighted; full layer at persona/, query for biography/psychology/values/etc.) ===\n${persona}`;
  }

  emit(ctx);
} catch (e) {
  emit(`LKHS SessionStart hook error: ${e?.message || e}. Memory in .claude/memory/; query via npx tsx .claude/bin/vector-query.ts.`);
}
