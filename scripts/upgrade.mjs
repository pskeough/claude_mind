#!/usr/bin/env node
/**
 * upgrade.mjs — in-place upgrade of an existing Claude Mind install to the
 * latest published engine, without touching a single byte the user created.
 *
 * The whole upgrade is safe because of one property of this repo: every
 * artifact an install generates is UNTRACKED (see .gitignore) — the vector
 * store, journal/, cards/, themes/, graph/, library/, persona/, HOME.md,
 * core_profile.json, lkhs.config.json, answers.json, domain tiles and all v2
 * runtime state. A pull therefore replaces engine code and docs only.
 *
 * The three exceptions are tracked files the running system MUTATES:
 *   .claude/memory/MEMORY.md   the routing index      -> user content, kept
 *   VAULT-INDEX.md             compiled namespace map -> user content, kept
 *   CLAUDE.md                  the operating manual   -> engine doc, replaced
 * Left alone these are exactly what makes `git pull` conflict on a live vault,
 * so this script backs all three up, restores the first two afterwards, and
 * takes upstream's CLAUDE.md (the old one is kept in the backup folder).
 *
 *   node scripts/upgrade.mjs                 (run from the vault root)
 *   node scripts/upgrade.mjs --dry           (show the plan, change nothing)
 *   node scripts/upgrade.mjs --remote <url>  (repoint origin, then upgrade)
 *
 * Exit 0 on a clean upgrade, 1 if a step needs a human. Every failure prints
 * the exact command that fixes it, so Claude Code can loop on it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const VAULT = process.cwd();
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const REMOTE_ARG = flag("remote");

// The canonical public repo. Only ever used when NO origin exists at all; an
// existing-but-broken origin stops the run instead (repointing someone's repo
// at a guess is how you silently install the wrong codebase).
const CANONICAL = "https://github.com/pskeough/claude_mind.git";

// Tracked files the running system rewrites. `keep: true` = user content that
// is restored after the pull; `keep: false` = engine doc that upstream owns.
const MUTABLE = [
  { file: path.join(".claude", "memory", "MEMORY.md"), keep: true },
  { file: "VAULT-INDEX.md", keep: true },
  { file: "CLAUDE.md", keep: false },
];

const STATE = path.join(VAULT, ".claude", "memory", "install_state.json");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const BACKUP = path.join(VAULT, ".claude", "backups", `upgrade-${stamp}`);

let failed = false;
const say = (m) => console.log(m);
const step = (n) => console.log(`\n== ${n} ==`);
const fail = (what, fix) => { failed = true; console.error(`  ! ${what}\n    FIX: ${fix}`); };
const git = (...a) => spawnSync("git", a, { cwd: VAULT, encoding: "utf8" });
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

// ---------------------------------------------------------------------------
// 0. Preconditions
// ---------------------------------------------------------------------------
step("0/7 preconditions");
if (!fs.existsSync(path.join(VAULT, "package.json")) || !fs.existsSync(path.join(VAULT, ".claude", "bin"))) {
  console.error(`! ${VAULT} is not a Claude Mind vault (no package.json + .claude/bin).\n  FIX: cd into the vault folder and re-run.`);
  process.exit(1);
}
if (git("rev-parse", "--is-inside-work-tree").status !== 0) {
  console.error(`! this vault is not a git clone, so there is nothing to pull from.\n  FIX: back it up, clone ${CANONICAL} fresh, and copy your untracked data (.claude/memory/, journal/, wiki/, persona/) across.`);
  process.exit(1);
}
say(`  vault: ${VAULT}`);
say(`  node:  ${process.version}`);

// ---------------------------------------------------------------------------
// 1. Resolve the remote. Origin is frequently unknown on an old install
//    (an early build shipped before the public repo existed), so this both
//    reports what it found and refuses to guess.
// ---------------------------------------------------------------------------
step("1/7 remote");
const origin = (git("remote", "get-url", "origin").stdout || "").trim();
let target = origin;

if (REMOTE_ARG) {
  say(`  repointing origin -> ${REMOTE_ARG}`);
  if (!DRY) {
    const r = origin ? git("remote", "set-url", "origin", REMOTE_ARG) : git("remote", "add", "origin", REMOTE_ARG);
    if (r.status !== 0) fail(`could not set origin: ${(r.stderr || "").trim()}`, `git remote set-url origin ${REMOTE_ARG}`);
  }
  target = REMOTE_ARG;
} else if (!origin) {
  say(`  no origin configured; setting the canonical public repo`);
  say(`    ${CANONICAL}`);
  if (!DRY) git("remote", "add", "origin", CANONICAL);
  target = CANONICAL;
} else {
  say(`  origin = ${origin}`);
}

// Reachability. A dead origin on an old install is the single most likely
// blocker, and the fix is a flag, not a mystery.
if (!DRY) {
  const ls = git("ls-remote", "--exit-code", "-h", "origin");
  if (ls.status !== 0) {
    console.error(`\n! origin is not reachable: ${target}`);
    console.error(`  It may be private, renamed, deleted, or never created.`);
    console.error(`  FIX: re-run pointing at the current public repo:`);
    console.error(`       node scripts/upgrade.mjs --remote ${CANONICAL}`);
    process.exit(1);
  }
  say(`  reachable`);
}

// ---------------------------------------------------------------------------
// 2. Back up the mutable tracked files (plus config, which is untracked and so
//    never at risk from git — copied purely as cheap insurance).
// ---------------------------------------------------------------------------
step("2/7 backup");
say(`  ${BACKUP}`);
if (!DRY) fs.mkdirSync(BACKUP, { recursive: true });
for (const { file } of MUTABLE) {
  const src = path.join(VAULT, file);
  if (!fs.existsSync(src)) { say(`  - ${file} (absent, skipped)`); continue; }
  say(`  + ${file}`);
  if (!DRY) {
    const dst = path.join(BACKUP, file);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}
for (const extra of [path.join(".claude", "lkhs.config.json"), path.join(".claude", "memory", "core_profile.json"), "answers.json"]) {
  const src = path.join(VAULT, extra);
  if (!fs.existsSync(src)) continue;
  say(`  + ${extra} (untracked; insurance copy)`);
  if (!DRY) {
    const dst = path.join(BACKUP, extra);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

// ---------------------------------------------------------------------------
// 3. Clear the way for a fast-forward. Only the known-mutable files are
//    discarded (they are backed up above and restored below). Any OTHER dirty
//    tracked file is a real local edit and stops the run — silently reverting
//    someone's deliberate change is worse than making them look at it.
// ---------------------------------------------------------------------------
step("3/7 clean tree");
if (!DRY) for (const { file } of MUTABLE) git("checkout", "--", file);
const dirty = (git("status", "--porcelain", "--untracked-files=no").stdout || "").trim();
if (dirty) {
  console.error(`\n! local edits to tracked engine files would be lost by the upgrade:`);
  console.error(dirty.split("\n").map((l) => `    ${l}`).join("\n"));
  console.error(`  Your own notes and data are untracked and are NOT affected by this.`);
  console.error(`  FIX: keep them  -> git stash push -m pre-upgrade   (then re-run, and git stash pop after)`);
  console.error(`       drop them  -> git checkout -- .               (then re-run)`);
  process.exit(1);
}
say(DRY ? "  (dry run: would reset the mutable files listed above)" : "  tree clean");

// ---------------------------------------------------------------------------
// 4. Pull. Fast-forward only: a merge commit on someone's unattended install
//    is a state nobody will ever untangle.
// ---------------------------------------------------------------------------
step("4/7 pull");
const beforeRev = (git("rev-parse", "--short", "HEAD").stdout || "").trim();
if (DRY) {
  say("  (dry run: no fetch/pull performed)");
} else {
  const branch = (git("rev-parse", "--abbrev-ref", "HEAD").stdout || "main").trim();
  git("fetch", "origin", "--tags");
  const pull = git("pull", "--ff-only", "origin", branch);
  if (pull.status !== 0) {
    console.error(`\n! fast-forward pull failed:\n${(pull.stderr || pull.stdout || "").trim()}`);
    console.error(`  This means the local branch has commits upstream does not.`);
    console.error(`  FIX: git log --oneline origin/${branch}..HEAD    (see what is local)`);
    console.error(`       git reset --hard origin/${branch}           (adopt upstream; untracked data is untouched)`);
    process.exit(1);
  }
  const afterRev = (git("rev-parse", "--short", "HEAD").stdout || "").trim();
  say(beforeRev === afterRev ? `  already current (${afterRev})` : `  ${beforeRev} -> ${afterRev}`);
}

// ---------------------------------------------------------------------------
// 5. Restore user content. Upstream ships empty stubs for these two, so hers
//    always wins; CLAUDE.md deliberately stays at the new upstream version.
// ---------------------------------------------------------------------------
step("5/7 restore your content");
for (const { file, keep } of MUTABLE) {
  const saved = path.join(BACKUP, file);
  if (!keep) { say(`  ~ ${file} replaced by the new version (yours: ${path.join(BACKUP, file)})`); continue; }
  if (!fs.existsSync(saved) && !DRY) { say(`  - ${file} (nothing backed up)`); continue; }
  say(`  + ${file} restored`);
  if (!DRY) fs.copyFileSync(saved, path.join(VAULT, file));
}

// ---------------------------------------------------------------------------
// 6. Dependencies + rewiring. Native modules (better-sqlite3, onnxruntime) are
//    compiled per machine and per Node ABI, so a Node major bump since the last
//    run means a rebuild, not just an install. The launchd plists embed an
//    absolute node path, so they are always rewritten.
// ---------------------------------------------------------------------------
step("6/7 dependencies + rewiring");
const prev = readJson(STATE) || {};
const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
const nodeChanged = prev.nodeMajor != null && prev.nodeMajor !== nodeMajor;
if (nodeChanged) say(`  node major changed ${prev.nodeMajor} -> ${nodeMajor}: native modules need a rebuild`);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (label, cmd, args) => {
  say(`  ${label}`);
  if (DRY) return 0;
  const r = spawnSync(cmd, args, { cwd: VAULT, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) fail(`${label} failed`, `${cmd} ${args.join(" ")}`);
  return r.status ?? 1;
};

run("npm install", npm, ["install"]);
if (nodeChanged) run("npm rebuild (native modules)", npm, ["rebuild"]);
run("re-install global hooks", process.execPath, ["scripts/install-global-hooks.mjs", "--vault", VAULT]);
run("re-register MCP server", process.execPath, ["scripts/register-mcp.mjs", "--vault", VAULT]);
if (process.platform === "darwin") run("re-install launchd jobs", process.execPath, ["scripts/install-launchd.mjs", "--vault", VAULT]);
else say("  launchd skipped (not macOS)");

if (!DRY) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({
    nodeMajor,
    lastUpgrade: new Date().toISOString(),
    rev: (git("rev-parse", "HEAD").stdout || "").trim(),
    backup: BACKUP,
  }, null, 2));
}

// ---------------------------------------------------------------------------
// 7. Verify. doctor is the contract: if it is green the install is good, and
//    every red line it prints carries its own FIX.
// ---------------------------------------------------------------------------
step("7/7 verify");
let doctorStatus = 0;
if (DRY) say("  (dry run: doctor not run)");
else doctorStatus = spawnSync(process.execPath, ["scripts/doctor.mjs"], { cwd: VAULT, stdio: "inherit" }).status ?? 1;

console.log("\n===========================================================");
if (DRY) {
  console.log(" Dry run complete. Nothing was changed.");
  console.log(" Run it for real:  npm run upgrade");
} else if (failed || doctorStatus !== 0) {
  console.log(" Upgrade finished with problems.");
  console.log(" Apply the FIX lines above, then: npm run doctor");
  console.log(` Your pre-upgrade copies: ${BACKUP}`);
} else {
  console.log(" Upgrade complete and verified.");
  console.log(` Pre-upgrade copies kept at: ${BACKUP}`);
  console.log(" Re-embed if the chunker changed:  npm run reindex");
}
console.log("===========================================================");
process.exit(failed || doctorStatus !== 0 ? 1 : 0);
