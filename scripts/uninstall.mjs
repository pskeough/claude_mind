#!/usr/bin/env node
/**
 * uninstall.mjs — cleanly remove everything setup installed OUTSIDE the vault folder:
 * the launchd jobs, the global hook wiring + copied hook files, and the MCP
 * registration. Leaves the vault folder and its memory intact (delete the folder by
 * hand if you want that gone too). Backs up global settings before editing.
 *
 * Usage: node scripts/uninstall.mjs
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync, spawnSync } from "node:child_process";

const HOME_CLAUDE = path.join(os.homedir(), ".claude");

// 1. launchd jobs (macOS).
if (process.platform === "darwin") {
  const uid = process.getuid();
  for (const job of ["daemon", "watcher", "sweep", "dream"]) {
    const label = `com.claudemind.${job}`;
    const plist = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
    try { execSync(`launchctl bootout gui/${uid}/${label}`, { stdio: "ignore" }); } catch {}
    try { fs.rmSync(plist, { force: true }); } catch {}
    console.log(`  - launchd ${label}`);
  }
}

// 2. Global hook wiring + copied hook files.
const SETTINGS = path.join(HOME_CLAUDE, "settings.json");
const HOOK_SCRIPTS = ["lkhs-prompt-retrieve.mjs", "lkhs-project-card.mjs", "lkhs-capture.mjs"];
if (fs.existsSync(SETTINGS)) {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
    fs.copyFileSync(SETTINGS, SETTINGS + `.bak.${Date.now()}`);
    for (const event of Object.keys(s.hooks || {})) {
      s.hooks[event] = (s.hooks[event] || []).filter(
        (g) => !(g.hooks || []).some((h) => (h.args || []).some((arg) => HOOK_SCRIPTS.some((hs) => String(arg).includes(hs)))));
      if (s.hooks[event].length === 0) delete s.hooks[event];
    }
    fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + "\n");
    console.log("  - global hook entries removed");
  } catch (e) { console.error(`  ! could not edit ${SETTINGS}: ${e?.message || e}`); }
}
for (const h of HOOK_SCRIPTS) {
  try { fs.rmSync(path.join(HOME_CLAUDE, "hooks", h), { force: true }); } catch {}
}

// 3. MCP registration.
if (spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" }).status === 0) {
  spawnSync("claude", ["mcp", "remove", "lkhs-memory", "-s", "user"], { stdio: "ignore" });
  console.log("  - MCP lkhs-memory removed");
}

console.log("\nUninstalled. The global capture config (~/.claude/lkhs-capture-config.json) and the");
console.log("vault folder were left in place; delete them by hand if you want a full removal.");
