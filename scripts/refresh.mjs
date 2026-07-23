#!/usr/bin/env node
/**
 * refresh.mjs — the nightly "dream" refresh, cross-platform (replaces the
 * vault's lkhs-refresh.ps1 for the portable install; launchd/Task Scheduler
 * templates call this one script on every OS).
 *
 * Sequence (mirrors the vault, 2026-07-23 state):
 *   hindsight -> preference miner -> persona scope floors -> sleep-reconcile
 *   -> reindex -> cards -> tier -> graph -> themes -> moc -> env-scan
 *   -> state rollup -> salience -> rehearsal -> state rollup
 *   -> [Sundays: voice recalibration -> memory eval point -> store hygiene
 *       -> weekly report]
 *   -> scope-leak smoke (SKIPPED cleanly if daemon down)
 *   -> daemon recycle (uptime latency mitigation)
 *   -> git backup (only when a remote is configured)
 *
 * Every step is logged with its exit code to .claude/logs/refresh.log; a
 * failing step never blocks the rest (same contract as the ps1).
 */
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(ROOT, ".claude", "logs", "refresh.log");
const LOCK = path.join(ROOT, ".claude", "refresh.lock");
process.env.LKHS_CAPTURE = "1"; // never capture our own maintenance sessions

const log = (m) => { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `[${new Date().toISOString()}] refresh: ${m}\n`); };

function step(name, script, args = []) {
  log(`${name} start`);
  const r = spawnSync(process.execPath, ["--import", "tsx", script, ...args], { cwd: ROOT, encoding: "utf8", timeout: 30 * 60_000 });
  fs.appendFileSync(LOG, (r.stdout || "") + (r.stderr || ""));
  log(`${name} done (exit ${r.status})`);
  return r.status;
}

// singleton
if (fs.existsSync(LOCK)) {
  const age = (Date.now() - fs.statSync(LOCK).mtimeMs) / 60_000;
  if (age < 120) { log("another run active, exiting"); process.exit(0); }
}
fs.writeFileSync(LOCK, String(process.pid));

try {
  step("hindsight (grade injections)", ".claude/bin/hindsight.ts");
  step("preference miner (voice signal)", ".claude/bin/preference-miner.ts", ["--apply", "--hours", "26"]);
  step("persona scope floors", ".claude/bin/persona-scope.ts", ["--apply"]);
  step("sleep (reconcile)", ".claude/bin/sleep-reconcile.ts");
  step("reindex", ".claude/bin/vector-engine.ts");
  step("cards", ".claude/bin/build-cards.ts");
  step("tier (episodic retirement)", ".claude/bin/promote-tier.ts");
  step("graph", ".claude/bin/graph-build.ts");
  step("themes", ".claude/bin/build-themes.ts");
  step("moc", ".claude/bin/build-moc.ts");
  step("environment scan", ".claude/bin/env-scan.ts");
  step("state rollup", ".claude/bin/state-rollup.ts");
  step("salience", ".claude/bin/salience.ts");
  step("rehearsal (lane packs)", ".claude/bin/build-rehearsal.ts");
  step("state rollup (TODAY.md)", ".claude/bin/state-rollup.ts");

  if (new Date().getDay() === 0) { // Sunday
    step("voice recalibration (learning curve)", ".claude/bin/voice-recalibrate.ts");
    step("memory eval (weekly regression point)", ".claude/bin/eval-memory.ts");
    step("store hygiene (integrity + drift)", ".claude/bin/store-hygiene.ts");
    step("weekly report", ".claude/bin/weekly-report.ts");
  }

  step("scope-leak smoke", ".claude/bin/eval-scope-leak.ts", ["--smoke"]);

  // Daemon recycle: gate latency degrades over multi-day uptime; a nightly
  // kill + detached restart caps it at 24h and keeps mornings warm.
  log("daemon recycle start");
  try {
    const port = process.env.LKHS_DAEMON_PORT || "7077";
    if (os.platform() === "win32") {
      const ns = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
      const line = (ns.stdout || "").split("\n").find(l => l.includes(`:${port}`) && l.includes("LISTENING"));
      const pid = line?.trim().split(/\s+/).pop();
      if (pid) spawnSync("taskkill", ["/F", "/PID", pid], { encoding: "utf8" });
    } else {
      const lsof = spawnSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" });
      for (const pid of (lsof.stdout || "").split("\n").filter(Boolean)) { try { process.kill(Number(pid), "SIGKILL"); } catch { /* */ } }
    }
    const child = spawn(process.execPath, ["--import", "tsx", ".claude/bin/lkhs-daemon.ts"], { cwd: ROOT, detached: true, stdio: "ignore" });
    child.unref();
    log("daemon recycle done");
  } catch (e) { log(`daemon recycle FAILED: ${e.message}`); }

  // Backup: only when the user wired a remote (delivery-channel pattern).
  const remote = spawnSync("git", ["remote"], { cwd: ROOT, encoding: "utf8" });
  if ((remote.stdout || "").trim()) {
    log("backup start");
    spawnSync("git", ["add", "-A"], { cwd: ROOT });
    const staged = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: ROOT });
    if (staged.status !== 0) spawnSync("git", ["commit", "-m", `nightly backup ${new Date().toISOString().slice(0, 16).replace("T", " ")}`], { cwd: ROOT });
    const push = spawnSync("git", ["push"], { cwd: ROOT, encoding: "utf8" });
    log(`backup done (push exit ${push.status})`);
  } else log("backup skipped (no git remote configured)");
} finally {
  try { fs.unlinkSync(LOCK); } catch { /* */ }
}
