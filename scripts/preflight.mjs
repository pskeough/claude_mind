#!/usr/bin/env node
/**
 * preflight.mjs — verify this machine can run Claude Mind before setup proceeds.
 * Prints a checklist and exits non-zero if a hard requirement is missing.
 */
import { spawnSync } from "node:child_process";
import * as os from "node:os";

const ok = (s) => console.log(`  ✓ ${s}`);
const bad = (s) => console.log(`  ✗ ${s}`);
const warn = (s) => console.log(`  ! ${s}`);
let fatal = false;

// Node >= 18 (global fetch, native deps).
const major = parseInt(process.versions.node.split(".")[0], 10);
if (major >= 18) ok(`Node ${process.versions.node}`);
else { bad(`Node ${process.versions.node} — need >= 18`); fatal = true; }

const has = (cmd) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" }).status === 0;

if (has("npm")) ok("npm"); else { bad("npm not found"); fatal = true; }
if (has("git")) ok("git"); else warn("git not found (only needed to clone/update)");
if (has("claude")) ok("claude CLI (Claude Code)");
else { bad("claude CLI not found — capture/summaries/persona need it. Install Claude Code, sign in with the Max subscription."); fatal = true; }

if (process.platform === "darwin") {
  const xc = spawnSync("xcode-select", ["-p"], { encoding: "utf8" });
  if (xc.status === 0) ok("Xcode Command Line Tools (native build deps)");
  else { bad("Xcode CLT missing — better-sqlite3/onnxruntime won't compile. Run: xcode-select --install"); fatal = true; }
} else if (process.platform === "win32") {
  warn("Windows detected: launchd jobs are macOS-only; use Task Scheduler or the manual launcher.");
}

console.log(`\n  platform: ${process.platform} ${os.arch()}   home: ${os.homedir()}`);
if (fatal) { console.error("\nPreflight FAILED. Resolve the ✗ items above, then re-run."); process.exit(1); }
console.log("\nPreflight OK.");
