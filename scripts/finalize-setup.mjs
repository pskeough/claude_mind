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
 * Usage: node scripts/finalize-setup.mjs --answers answers.json
 */
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const ANSWERS = flag("answers");
if (!ANSWERS) { console.error("usage: node scripts/finalize-setup.mjs --answers answers.json"); process.exit(1); }
const VAULT = process.cwd();

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
  console.log("\n== 4/4 launchd skipped (not macOS) — see SETUP.md for Task Scheduler / manual launcher ==");
}

console.log("\n===========================================================");
console.log(" Wiring complete. Next (visible) steps from SETUP.md:");
console.log("   npm run ingest:dirs      # ingest her files/projects");
console.log("   npm run persona:extract -- <export-dir>   # then synthesis");
console.log("   npm run embed && npm run graph && npm run cards && npm run moc");
console.log("===========================================================");
