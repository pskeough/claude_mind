#!/usr/bin/env node
/**
 * install-jobs.mjs — register the four background jobs, on whatever OS this is.
 *
 *   node scripts/install-jobs.mjs            register
 *   node scripts/install-jobs.mjs --dry      print what would be registered
 *   node scripts/install-jobs.mjs --remove   unregister
 *
 * WHY THIS EXISTS. macOS had `npm run install:launchd`, one command. Windows had four
 * hand-typed `schtasks` invocations in SETUP.md carrying a caveat that reads "if schtasks
 * quoting fights you, create the four tasks in the Task Scheduler UI instead" — which is
 * a documented way of saying the install does not work. Setup parity across platforms is
 * not polish here: an install that half-completes on the most common platform produces a
 * vault that looks configured and quietly never captures anything.
 *
 * THE FOUR JOBS, and why each matters:
 *   daemon   warm retrieval server. Without it every prompt pays cold model load.
 *   watcher  re-embeds changed files. Without it the store silently goes stale.
 *   sweep    hourly session capture. Without it sessions are lost when Claude Code exits.
 *   refresh  nightly consolidation (cards, graph, miners). Without it nothing compounds.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.resolve(HERE, "..");
const DRY = process.argv.includes("--dry");
const REMOVE = process.argv.includes("--remove");

const nodeBin = process.execPath;
const JOBS = [
  { name: "ClaudeMind-Daemon", kind: "keepalive", script: ".claude/bin/lkhs-daemon.ts", tsx: true },
  { name: "ClaudeMind-Watcher", kind: "keepalive", script: ".claude/bin/ambient-watcher.ts", tsx: true },
  { name: "ClaudeMind-Sweep", kind: "hourly", script: ".claude/bin/capture-sweep.ts", tsx: true },
  { name: "ClaudeMind-Refresh", kind: "daily", at: "04:00", script: "scripts/refresh.mjs", tsx: false },
];

function windows() {
  const run = (args) => {
    if (DRY) { console.log(`  schtasks ${args.join(" ")}`); return 0; }
    // shell:false so the vault path's spaces survive as one argv entry. This is the exact
    // quoting problem the manual instructions warned about; passing argv directly removes
    // it rather than documenting a workaround.
    const r = spawnSync("schtasks", args, { encoding: "utf8", shell: false, windowsHide: true });
    if (r.status !== 0) console.error(`  ! ${(r.stderr || r.stdout || "").trim().split("\n")[0]}`);
    return r.status ?? 1;
  };

  if (REMOVE) {
    for (const j of JOBS) run(["/Delete", "/TN", j.name, "/F"]);
    console.log("scheduled tasks removed");
    return;
  }

  let ok = 0;
  for (const j of JOBS) {
    // Through scripts\run-job.cmd, which cd's into the vault first. Task Scheduler starts
    // jobs in C:\Windows\System32, and `--import tsx` resolves from the working directory,
    // so a bare `node --import tsx <abs path>` task fails with ERR_MODULE_NOT_FOUND.
    const launcher = path.join(VAULT, "scripts", "run-job.cmd");
    const rel = j.script.replace(/\//g, path.sep);
    const cmd = j.tsx
      ? `"${launcher}" "${nodeBin}" --import tsx "${rel}"`
      : `"${launcher}" "${nodeBin}" "${rel}"`;
    if (cmd.length > 261) console.error(`  ! ${j.name}: task command is ${cmd.length} chars; schtasks allows 261. Move the vault to a shorter path such as C:\\Claude.`);
    const args = ["/Create", "/TN", j.name, "/TR", cmd, "/F"];
    if (j.kind === "keepalive") args.push("/SC", "ONLOGON");
    else if (j.kind === "hourly") args.push("/SC", "HOURLY");
    else { args.push("/SC", "DAILY", "/ST", j.at); }
    // Wake the machine for the nightly consolidation; a laptop that sleeps at midnight
    // would otherwise never run it, and the vault would stop compounding without a
    // single visible error.
    if (j.kind === "daily") args.push("/RL", "LIMITED");
    // Only count it as registered if it was actually registered. A dry run that reports
    // "4/4 registered" is the same class of defect as a health check that passes on the
    // wrong artifact: it tells you the install worked when nothing ran.
    if (run(args) === 0 && !DRY) { ok++; console.log(`  + ${j.name}`); }
  }
  if (DRY) { console.log(`\nDRY RUN — ${JOBS.length} task(s) would be registered. Re-run without --dry.`); return; }
  console.log(`\n${ok}/${JOBS.length} scheduled tasks registered.`);
  if (ok === JOBS.length) {
    console.log(`Verify any time with:  schtasks /Query /TN ClaudeMind-Daemon`);
    console.log(`Note: keepalive tasks start at next logon. To start now without rebooting:`);
    console.log(`  schtasks /Run /TN ClaudeMind-Daemon`);
  }
}

function mac() {
  // The existing launchd installer already handles plists, KeepAlive and load/unload;
  // reimplementing it here would be a second source of truth for the same four jobs.
  const target = path.join(HERE, "install-launchd.mjs");
  if (!fs.existsSync(target)) { console.error("install-launchd.mjs missing"); process.exit(1); }
  const r = spawnSync(nodeBin, [target, ...(REMOVE ? ["--remove"] : []), ...(DRY ? ["--dry"] : [])], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}

function linux() {
  console.log("Linux: no installer yet. Register these as systemd user units or cron jobs:\n");
  for (const j of JOBS) {
    const target = path.join(VAULT, j.script);
    console.log(`  ${j.name.padEnd(20)} ${j.kind.padEnd(10)} ${nodeBin}${j.tsx ? " --import tsx" : ""} ${target}`);
  }
  console.log(`\nKeepalive jobs want Restart=always; sweep is hourly; refresh is daily at 04:00.`);
}

console.log(`Claude Mind background jobs — ${process.platform}\n`);
if (process.platform === "win32") windows();
else if (process.platform === "darwin") mac();
else linux();
