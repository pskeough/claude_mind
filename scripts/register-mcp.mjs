#!/usr/bin/env node
/**
 * register-mcp.mjs — register the lkhs-memory MCP server with Claude Code at user
 * scope, so its tools (search_memory, project_state, timeline, related, explore,
 * user_profile, recall_persona) are available in every project. Idempotent: removes
 * any existing registration first. Requires the `claude` CLI on PATH.
 *
 * Usage: node scripts/register-mcp.mjs   (run from the vault, or --vault PATH)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const VAULT = path.resolve(flag("vault") || process.cwd());

const claude = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" });
if (claude.status !== 0) {
  console.error("  ! 'claude' CLI not found on PATH. Install Claude Code first, then re-run.");
  process.exit(1);
}

const NAME = "lkhs-memory";
let target;
if (process.platform === "win32") {
  // Windows: register node + tsx directly (cwd handled by the launcher pattern is not
  // needed because we pass an absolute script path and tsx resolves from the vault).
  target = ["--", "node", "--import", "tsx", path.join(VAULT, ".claude", "bin", "lkhs-mcp.ts")];
} else {
  const launcher = path.join(VAULT, "scripts", "lkhs-mcp-launch.sh");
  try { fs.chmodSync(launcher, 0o755); } catch {}
  target = ["--", launcher];
}

// Remove any prior registration (ignore failure), then add fresh.
spawnSync("claude", ["mcp", "remove", NAME, "-s", "user"], { stdio: "ignore" });
const add = spawnSync("claude", ["mcp", "add", NAME, "-s", "user", ...target], { stdio: "inherit" });
if (add.status !== 0) { console.error("  ! claude mcp add failed."); process.exit(add.status || 1); }
console.log(`MCP server '${NAME}' registered at user scope.`);
console.log("Verify with: claude mcp list");
