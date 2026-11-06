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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CFG = path.join(ROOT, ".claude", "lkhs.config.json");
const off = process.argv.includes("--off");

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG, "utf8")); } catch {}
cfg.rhythm = { sensitivity: "low", cooldownDays: 4, dayStartHour: 5, ...(cfg.rhythm || {}), enabled: !off };
fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2) + "\n");
console.log(`rhythm.enabled = ${!off} (${path.relative(ROOT, CFG)})`);
if (off) { console.log("Off. Nothing is logged or raised. The existing record is kept."); process.exit(0); }

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

run("skill: mind-companion", ["extras/install-extras.mjs", "--groups", "wellbeing"]);
run("global hooks (session-start check-in gate)", ["scripts/install-global-hooks.mjs"]);
run("first scan", [".claude/bin/rhythm.mjs", "scan"]);

console.log(`
Done. From here it runs in the nightly refresh. Nothing to remember:
  - say "I'm manic / hypomanic / low / ok now" to Claude in any project
  - ask "how have I been?" for the read
  - it learns her usual pattern for ${cfg.rhythm.minBaselineDays ?? 14} active days before it ever flags anything`);
