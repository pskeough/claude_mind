#!/usr/bin/env node
/**
 * install-global-hooks.mjs — wire the three GLOBAL Claude Mind hooks into the user's
 * global Claude Code config so memory capture + retrieval fire in EVERY project, not
 * just the vault.
 *
 *   UserPromptSubmit -> lkhs-prompt-retrieve.mjs  (inject relevant memory per prompt)
 *   SessionStart     -> lkhs-project-card.mjs     (resume card + surface MCP tools)
 *   SessionEnd       -> lkhs-capture.mjs          (capture finished session)
 *   PreCompact       -> lkhs-capture.mjs          (capture before compaction)
 *
 * Copies the hook files to ~/.claude/hooks/ and merges the entries into
 * ~/.claude/settings.json. Idempotent (skips an event if our hook is already wired)
 * and non-destructive (backs the file up, preserves any existing hooks/settings).
 *
 * Usage: node scripts/install-global-hooks.mjs   (run from the vault, or --vault PATH)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const VAULT = path.resolve(flag("vault") || process.cwd());

const HOME_CLAUDE = path.join(os.homedir(), ".claude");
const HOOKS_DIR = path.join(HOME_CLAUDE, "hooks");
const SETTINGS = path.join(HOME_CLAUDE, "settings.json");
fs.mkdirSync(HOOKS_DIR, { recursive: true });

// 1. Copy the three global hooks next to the user's other global hooks.
const GLOBAL_HOOKS = ["lkhs-prompt-retrieve.mjs", "lkhs-project-card.mjs", "lkhs-capture.mjs"];
for (const h of GLOBAL_HOOKS) {
  fs.copyFileSync(path.join(VAULT, ".claude", "hooks", h), path.join(HOOKS_DIR, h));
}
const p = (h) => path.join(HOOKS_DIR, h);

// 2. Merge entries into global settings.json.
let settings = {};
if (fs.existsSync(SETTINGS)) {
  try { settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8")); }
  catch { console.error(`  ! ${SETTINGS} is not valid JSON; aborting so nothing is lost.`); process.exit(1); }
  fs.copyFileSync(SETTINGS, SETTINGS + `.bak.${Date.now()}`);
}
settings.hooks ||= {};

const node = "node";
const entries = [
  { event: "UserPromptSubmit", matcher: null, script: "lkhs-prompt-retrieve.mjs", timeout: 12 },
  { event: "SessionStart", matcher: "startup|resume|clear", script: "lkhs-project-card.mjs", timeout: 10 },
  { event: "SessionEnd", matcher: "", script: "lkhs-capture.mjs", timeout: 15 },
  { event: "PreCompact", matcher: "", script: "lkhs-capture.mjs", timeout: 15 },
];

const alreadyWired = (arr, script) =>
  (arr || []).some((g) => (g.hooks || []).some((h) => (h.args || []).some((a) => String(a).includes(script))));

let added = 0;
for (const e of entries) {
  settings.hooks[e.event] ||= [];
  if (alreadyWired(settings.hooks[e.event], e.script)) { console.log(`  = ${e.event} already wired`); continue; }
  const group = { hooks: [{ type: "command", command: node, args: [p(e.script)], timeout: e.timeout }] };
  if (e.matcher !== null) group.matcher = e.matcher;
  settings.hooks[e.event].push(group);
  console.log(`  + ${e.event} -> ${e.script}`);
  added++;
}

fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n");
console.log(`global hooks: ${added} added, settings at ${SETTINGS}`);
