#!/usr/bin/env node
/**
 * install-launchd.mjs — install the Claude Mind background jobs as macOS LaunchAgents.
 *
 * Four jobs:
 *   com.claudemind.daemon   keepalive  warm retrieval daemon (port from config)
 *   com.claudemind.watcher  keepalive  ambient file watcher + auto wiki-compile
 *   com.claudemind.sweep    hourly     capture/backfill recent Claude Code sessions
 *   com.claudemind.dream    daily 04:00  rebuild cards/graph/themes/moc (incremental)
 *
 * Fills the plist templates in scripts/launchd/ with this machine's real node + claude
 * paths and the vault path, writes them to ~/Library/LaunchAgents, and (re)loads them.
 * Idempotent: re-running boots out the old job first. macOS only.
 *
 * Usage: node scripts/install-launchd.mjs            (vault = cwd)
 *        node scripts/install-launchd.mjs --vault /path/to/vault
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync, spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.error("install-launchd is macOS-only. On Windows use Task Scheduler (see SETUP.md).");
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const VAULT = path.resolve(flag("vault") || process.cwd());
const TEMPLATES = path.join(VAULT, "scripts", "launchd");
const LA = path.join(os.homedir(), "Library", "LaunchAgents");
const LOGDIR = path.join(VAULT, ".claude", "logs");
fs.mkdirSync(LA, { recursive: true });
fs.mkdirSync(LOGDIR, { recursive: true });

const NODE = process.execPath; // the node binary running this script

function which(cmd) {
  const r = spawnSync("sh", ["-lc", `command -v ${cmd}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}
const claudePath = which("claude");
const claudeDir = claudePath ? path.dirname(claudePath) : "";
const PATH_ENTRIES = [
  path.dirname(NODE), claudeDir,
  path.join(os.homedir(), ".local", "bin"),
  "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
].filter(Boolean);
const PLIST_PATH = [...new Set(PATH_ENTRIES)].join(":");

const JOBS = ["daemon", "watcher", "sweep", "dream"];
const uid = process.getuid();

for (const job of JOBS) {
  const label = `com.claudemind.${job}`;
  const tplFile = path.join(TEMPLATES, `${label}.plist`);
  if (!fs.existsSync(tplFile)) { console.error(`  ! missing template ${tplFile}`); continue; }
  const filled = fs.readFileSync(tplFile, "utf8")
    .replaceAll("__NODE__", NODE)
    .replaceAll("__VAULT__", VAULT)
    .replaceAll("__LOGDIR__", LOGDIR)
    .replaceAll("__PATH__", PLIST_PATH);
  const dest = path.join(LA, `${label}.plist`);
  fs.writeFileSync(dest, filled);

  // Reload: boot out any existing instance (ignore failure), then bootstrap.
  try { execSync(`launchctl bootout gui/${uid}/${label}`, { stdio: "ignore" }); } catch {}
  try {
    execSync(`launchctl bootstrap gui/${uid} ${JSON.stringify(dest)}`, { stdio: "ignore" });
    console.log(`  + loaded ${label}`);
  } catch (e) {
    // Older macOS fallback.
    try { execSync(`launchctl load -w ${JSON.stringify(dest)}`, { stdio: "ignore" }); console.log(`  + loaded ${label} (legacy)`); }
    catch { console.error(`  ! failed to load ${label}: ${e?.message || e}`); }
  }
}

if (claudeDir) console.log(`  claude CLI: ${claudePath}`);
else console.warn("  ! 'claude' not found on PATH — sweep/dream summaries need the Claude Code CLI installed.");
console.log("launchd jobs installed. Check: launchctl list | grep claudemind");
