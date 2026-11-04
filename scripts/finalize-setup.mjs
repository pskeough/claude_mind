#!/usr/bin/env node
/**
 * finalize-setup.mjs — run the deterministic install WIRING in one ordered step,
 * after the SETUP runbook has assembled an answers.json by interviewing the user.
 *
 * Order:
 *   1. write-config         core_profile.json + global capture config
 *   2. install-global-hooks capture/retrieval hooks in every project
 *   3. register-mcp         lkhs-memory MCP tools at user scope
 *   4. install-launchd      always-on daemon/watcher + hourly sweep + daily dream (macOS)
 *
 * It does NOT run ingestion or persona synthesis — those are heavier, visible steps
 * the runbook runs explicitly so the user can watch them.
 *
 * Usage: node scripts/finalize-setup.mjs --answers answers.json [--dry]
 *
 * WHAT THIS TOUCHES OUTSIDE THE VAULT, and why --dry exists. Steps 2-4 write to the
 * user's HOME, not to this folder: `~/.claude/settings.json` (hooks), `~/.claude.json`
 * (MCP registration), `~/.claude/hooks/` (copied hook scripts), and LaunchAgents on
 * macOS. That is correct for a real install — the whole point is that memory follows you
 * into every project — but it means running this to "see what it does" silently
 * repoints an existing install at whatever folder you ran it from. That happened during
 * testing: a throwaway install in a temp directory took over the live MCP registration
 * and double-registered a PreToolUse hook. `--dry` prints the same plan and writes
 * nothing, so the installer can be inspected before it is trusted.
 */
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = argv.includes("--dry");
const ANSWERS = flag("answers");
if (!ANSWERS) { console.error("usage: node scripts/finalize-setup.mjs --answers answers.json [--dry]"); process.exit(1); }
const VAULT = process.cwd();

if (DRY) {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  console.log(`DRY RUN — nothing will be written.\n`);
  console.log(`Vault:   ${VAULT}`);
  console.log(`Answers: ${ANSWERS}\n`);
  console.log(`Would write INSIDE the vault:`);
  console.log(`  .claude/memory/core_profile.json`);
  console.log(`  .claude/lkhs.config.json\n`);
  console.log(`Would write OUTSIDE the vault (these affect every project, not just this one):`);
  console.log(`  ${path.join(home, ".claude", "lkhs-capture-config.json")}   <- points the capture hooks at THIS vault`);
  console.log(`  ${path.join(home, ".claude", "settings.json")}              <- adds 5 global hooks (backed up first)`);
  console.log(`  ${path.join(home, ".claude", "hooks", "*.mjs")}             <- copies the hook scripts`);
  console.log(`  ${path.join(home, ".claude.json")}                          <- registers the lkhs-memory MCP server`);
  if (process.platform === "darwin") console.log(`  ~/Library/LaunchAgents/com.lkhs.*.plist        <- background jobs`);
  console.log(`\nIf you already have Claude Mind installed from another folder, running this`);
  console.log(`for real will REPOINT it at ${VAULT}.`);
  console.log(`\nRe-run without --dry to install.`);
  process.exit(0);
}

function run(label, args) {
  console.log(`\n== ${label} ==`);
  const r = spawnSync(process.execPath, args, { stdio: "inherit", cwd: VAULT });
  if (r.status !== 0) { console.error(`\n! step failed: ${label} (continuing would leave a half-install; fix and re-run)`); process.exit(r.status || 1); }
}

run("1/4 write config", ["scripts/write-config.mjs", "--vault", VAULT, "--answers", ANSWERS]);
run("2/4 install global hooks", ["scripts/install-global-hooks.mjs", "--vault", VAULT]);
run("3/4 register MCP server", ["scripts/register-mcp.mjs", "--vault", VAULT]);
if (process.platform === "darwin") {
  run("4/4 install launchd jobs", ["scripts/install-launchd.mjs", "--vault", VAULT]);
} else {
  console.log("\n== 4/4 background jobs: run  npm run install:jobs  (Task Scheduler on Windows, cron/systemd on Linux) ==");
}

console.log("\n===========================================================");
console.log(" Wiring complete. Next (visible) steps from SETUP.md:");
console.log("   npm run ingest:dirs      # ingest their files/projects");
console.log("   npm run persona:extract -- <export-dir>   # then synthesis");
console.log("   npm run embed && npm run graph && npm run cards && npm run moc");
console.log("===========================================================");
