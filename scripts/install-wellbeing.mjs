#!/usr/bin/env node
/**
 * install-wellbeing.mjs - turn on the wellbeing module (usage rhythm + the
 * mind-companion skill). See docs/rhythm.md.
 *
 *   node scripts/install-wellbeing.mjs            enable, install skill + hook, first scan
 *   node scripts/install-wellbeing.mjs --off      disable (keeps the record; delete
 *                                                  .claude/memory/rhythm to remove it)
 *
 * Idempotent: safe to re-run after an upgrade.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setDesktopServer, removeDesktopServer, desktopPreferences, printResults } from "./desktop-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CFG = path.join(ROOT, ".claude", "lkhs.config.json");
const off = process.argv.includes("--off");

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG, "utf8")); } catch {}
cfg.rhythm = { sensitivity: "low", cooldownDays: 4, dayStartHour: 5, ...(cfg.rhythm || {}), enabled: !off };
fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2) + "\n");
console.log(`rhythm.enabled = ${!off} (${path.relative(ROOT, CFG)})`);
if (off) {
  printResults(removeDesktopServer("mind-wellbeing"));
  console.log("Off. Nothing is logged or raised. The existing record is kept.");
  console.log("Take the wellbeing sentences out of Desktop > Settings > Profile too.");
  process.exit(0);
}

const run = (label, args) => {
  console.log(`\n> ${label}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) console.error(`  ! ${label} exited ${r.status}`);
};

const plan = path.join(ROOT, "persona_clinical", "my-plan.md");
if (!fs.existsSync(plan)) {
  fs.mkdirSync(path.dirname(plan), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "extras", "wellbeing", "my-plan.template.md"), plan);
  console.log(`plan template: ${path.relative(ROOT, plan)} (fill in on a calm week, or ask Claude to go through it)`);
}

// Claude Desktop: register the mind-wellbeing MCP server (the main way in), in
// every Desktop config found: %APPDATA%\Claude and the Store build's
// %LOCALAPPDATA%\Claude-Data\claude_*, which is the one that build reads.
// Absolute node path: Desktop launches servers with a minimal PATH.
console.log("\n> Claude Desktop: mind-wellbeing MCP server");
printResults(setDesktopServer("mind-wellbeing", { command: process.execPath, args: [path.join(ROOT, ".claude", "bin", "wellbeing-mcp.mjs")] }));

run("skill: mind-companion (Claude Code)", ["extras/install-extras.mjs", "--groups", "wellbeing"]);
run("global hooks (Claude Code session-start check-in gate)", ["scripts/install-global-hooks.mjs"]);
run("first scan", [".claude/bin/rhythm.mjs", "scan"]);

// One paragraph: merged with the memory server's text when lkhs-memory is also
// registered in Desktop (Desktop has a single preferences box).
const prefs = desktopPreferences(ROOT, { wellbeing: true });
console.log(`
Done. Two things to do by hand, once:

1. Quit Claude Desktop fully and reopen it (it reads MCP servers at launch).
2. Claude Desktop > Settings > Profile > personal preferences: paste this in
   (replacing any earlier Claude Mind paragraph).

${prefs}

Optional, and the best start: claude.ai > Settings > Privacy > Export data. When the
email arrives, unzip it and tell Claude "import my export from ~/Downloads/<folder>".
That gives months of history (phone and web too), so the baseline is ready on day one
instead of after ${cfg.rhythm.minBaselineDays ?? 14} active days. Repeat whenever; it merges.

After that, nothing to remember:
  - say "I'm manic / hypomanic / low / ok now" to Claude
  - ask "how have I been?" for the read`);
