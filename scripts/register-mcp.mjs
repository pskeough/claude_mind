#!/usr/bin/env node
/**
 * register-mcp.mjs - register the lkhs-memory MCP server so its tools (search_memory,
 * project_state, timeline, related, explore, user_profile, recall_persona,
 * save_session) are available everywhere:
 *
 *   1. Claude Desktop: written into every claude_desktop_config.json found
 *      (scripts/desktop-config.mjs knows the per-OS and Store-build paths).
 *   2. Claude Code: `claude mcp add` at user scope (needs the `claude` CLI).
 *
 * Idempotent: removes any existing registration first, and leaves an unchanged
 * Desktop entry alone.
 *
 * Usage: node scripts/register-mcp.mjs                (run from the vault, or --vault PATH)
 *        node scripts/register-mcp.mjs --no-desktop   Claude Code only
 *        node scripts/register-mcp.mjs --desktop-only Claude Desktop only
 *        node scripts/register-mcp.mjs --off          remove the Claude Desktop entry
 *                                                     (the Claude Code one: npm run uninstall)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { setDesktopServer, removeDesktopServer, lkhsMemoryEntry, printResults, desktopPreferences } from "./desktop-config.mjs";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const VAULT = path.resolve(flag("vault") || process.cwd());
const NAME = "lkhs-memory";

if (argv.includes("--off")) {
  console.log(`Claude Desktop: removing '${NAME}'`);
  printResults(removeDesktopServer(NAME));
  console.log("Quit and reopen Claude Desktop for it to take effect.");
  process.exit(0);
}

if (!argv.includes("--no-desktop")) {
  console.log(`Claude Desktop: '${NAME}'`);
  printResults(setDesktopServer(NAME, lkhsMemoryEntry(VAULT)));
  console.log("  Quit and reopen Claude Desktop to load it, then paste this into Desktop > Settings >");
  console.log("  Profile > personal preferences (replacing any earlier Claude Mind paragraph) so chats");
  console.log("  are saved to memory. See docs/desktop.md.\n");
  console.log(desktopPreferences(VAULT, { memory: true }) + "\n");
}
if (argv.includes("--desktop-only")) process.exit(0);

const claude = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" });
if (claude.status !== 0) {
  console.error("  ! 'claude' CLI not found on PATH. Install Claude Code first, then re-run.");
  process.exit(1);
}

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
