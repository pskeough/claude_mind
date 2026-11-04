#!/usr/bin/env node
/**
 * upgrade.mjs — in-place upgrade of an existing Claude Mind install to the
 * latest published engine, without touching a single byte the user created.
 *
 * The whole upgrade is safe because of one property of this repo: every
 * artifact an install generates is UNTRACKED (see .gitignore) — the vector
 * store, journal/, cards/, themes/, graph/, library/, persona/, HOME.md,
 * core_profile.json, lkhs.config.json, answers.json, domain tiles and all
 * runtime state under .claude/memory. A pull therefore replaces engine code
 * and docs only.
 *
 * The three exceptions are tracked files the running system MUTATES:
 *   .claude/memory/MEMORY.md   the routing index      -> user content, kept
 *   VAULT-INDEX.md             compiled namespace map -> user content, kept
 *   CLAUDE.md                  the operating manual   -> engine doc, replaced
 * This script backs all three up, restores the first two afterwards, and
 * takes upstream's CLAUDE.md (the old one is kept in the backup folder).
 *
 * Installs reach this script in three states, and all three end on the
 * canonical repo's main branch with the user's data untouched:
 *   clone      a git clone of the canonical repo: fast-forward.
 *   diverged   a git repo whose history upstream does not contain (a private
 *              copy of the engine, or an origin that was the user's own repo):
 *              ADOPT upstream.
 *   unpacked   a folder copied from a zip, no .git at all: ADOPT upstream.
 * Adopting means: back up every local file that differs from upstream, point
 * the branch at upstream (git reset, which never touches untracked files),
 * then check out upstream's tracked files. Untracked data stays on disk; the
 * backup holds the old engine for anyone who wants to diff it.
 *
 *   node scripts/upgrade.mjs                  (run from the vault root)
 *   node scripts/upgrade.mjs --dry            (show the plan, change nothing)
 *   node scripts/upgrade.mjs --plan pro|max   (set the background model-call cap)
 *   node scripts/upgrade.mjs --remote <url>   (upgrade from a different repo)
 *   node scripts/upgrade.mjs --no-wire        (skip hooks/MCP/jobs; for tests)
 *
 * Exit 0 on a clean upgrade, 1 if a step needs a human. Every failure prints
 * the exact command that fixes it, so Claude Code can loop on it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

const VAULT = process.cwd();
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const NO_WIRE = argv.includes("--no-wire");
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const REMOTE_ARG = flag("remote");
const PLAN = (flag("plan") || "").toLowerCase();
if (PLAN && !["pro", "max"].includes(PLAN)) { console.error(`! --plan takes pro or max, got "${PLAN}"`); process.exit(1); }

// The canonical public repo. An install whose origin is something else (an
// early private copy, a dead URL) is moved onto this one; the old URL is kept
// as the `previous-origin` remote so nothing is lost.
const CANONICAL = "https://github.com/pskeough/claude_mind.git";
const BRANCH = "main";

// Tracked files the running system rewrites. `keep: true` = user content that
// is restored after the pull; `keep: false` = engine doc that upstream owns.
const MUTABLE = [
  { file: path.join(".claude", "memory", "MEMORY.md"), keep: true },
  { file: "VAULT-INDEX.md", keep: true },
  { file: "CLAUDE.md", keep: false },
];

// What a Pro plan (USD 20) can carry: 30 background calls a day, the last 12
// kept for session capture, two parallel workers. Max removes the cap.
const PLANS = {
  pro: { llmBudget: { dailyCalls: 30, captureReserve: 12 }, llmConcurrency: 2 },
  max: { llmBudget: { dailyCalls: "off", captureReserve: 12 } },
};

const STATE = path.join(VAULT, ".claude", "memory", "install_state.json");
const LOCAL_CFG = path.join(VAULT, ".claude", "lkhs.config.json");
const GLOBAL_CFG = path.join(os.homedir(), ".claude", "lkhs-capture-config.json");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const BACKUP = path.join(VAULT, ".claude", "backups", `upgrade-${stamp}`);

let failed = false;
const say = (m) => console.log(m);
const step = (n) => console.log(`\n== ${n} ==`);
const fail = (what, fix) => { failed = true; console.error(`  ! ${what}\n    FIX: ${fix}`); };
const git = (...a) => spawnSync("git", a, { cwd: VAULT, encoding: "utf8" });
const out = (r) => (r.stdout || "").trim();
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")); } catch { return null; } };
const backupFile = (rel, sub = "") => {
  const src = path.join(VAULT, rel);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return false;
  const dst = path.join(BACKUP, sub, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
};

// ---------------------------------------------------------------------------
// 0. Preconditions
// ---------------------------------------------------------------------------
step("0/8 preconditions");
if (!fs.existsSync(path.join(VAULT, "package.json")) || !fs.existsSync(path.join(VAULT, ".claude", "bin"))) {
  console.error(`! ${VAULT} is not a Claude Mind vault (no package.json + .claude/bin).\n  FIX: cd into the vault folder and re-run.`);
  process.exit(1);
}
if (spawnSync("git", ["--version"], { encoding: "utf8" }).status !== 0) {
  console.error(`! git is not installed or not on PATH.\n  FIX: install git (https://git-scm.com), open a new terminal, re-run.`);
  process.exit(1);
}
const isRepo = git("rev-parse", "--is-inside-work-tree").status === 0
  && path.resolve(out(git("rev-parse", "--show-toplevel"))) === path.resolve(VAULT);
say(`  vault: ${VAULT}`);
say(`  node:  ${process.version}`);
say(`  git:   ${isRepo ? "repository" : "no repository here (unpacked copy)"}`);

// Facts about the OLD engine, read before anything replaces it.
const oldConfigTs = (() => { try { return fs.readFileSync(path.join(VAULT, ".claude", "bin", "config.ts"), "utf8"); } catch { return ""; } })();
const oldHadDefaultCap = /export function llmBudget\(/.test(oldConfigTs) && /num\(rawDaily, 40\)/.test(oldConfigTs);

// ---------------------------------------------------------------------------
// 1. Remote. Default target is the canonical repo; anything else is kept as
//    previous-origin rather than overwritten.
// ---------------------------------------------------------------------------
step("1/8 remote");
const target = REMOTE_ARG || CANONICAL;
const origin = isRepo ? out(git("remote", "get-url", "origin")) : "";
const sameUrl = (a, b) => a.replace(/\.git$/, "").toLowerCase() === b.replace(/\.git$/, "").toLowerCase();
if (!origin) say(`  origin will be ${target}`);
else if (sameUrl(origin, target)) say(`  origin = ${origin}`);
else say(`  origin is ${origin}\n  moving it to previous-origin and using ${target}`);

if (!DRY) {
  if (!isRepo) {
    const init = git("init", "-q", "-b", BRANCH);
    if (init.status !== 0) { console.error(`! git init failed: ${(init.stderr || "").trim()}`); process.exit(1); }
  }
  if (origin && !sameUrl(origin, target)) {
    git("remote", "remove", "previous-origin");
    git("remote", "rename", "origin", "previous-origin");
  }
  if (!origin || !sameUrl(origin, target)) git("remote", "add", "origin", target);
  const ls = git("ls-remote", "--exit-code", "-h", "origin", BRANCH);
  if (ls.status !== 0) {
    console.error(`\n! ${target} is not reachable (offline, private, or renamed).`);
    console.error(`  FIX: check the network, then re-run. To use another repo: node scripts/upgrade.mjs --remote <url>`);
    process.exit(1);
  }
  const fetch = git("fetch", "-q", "origin", BRANCH);
  if (fetch.status !== 0) { console.error(`! fetch failed: ${(fetch.stderr || "").trim()}\n  FIX: re-run; if it persists, check the network.`); process.exit(1); }
  say(`  fetched origin/${BRANCH} (${out(git("rev-parse", "--short", `origin/${BRANCH}`))})`);
}

// ---------------------------------------------------------------------------
// 2. Decide: fast-forward, or adopt.
// ---------------------------------------------------------------------------
step("2/8 plan");
let mode = "adopt";
if (DRY) {
  mode = isRepo ? "fast-forward if history allows, else adopt" : "adopt";
} else if (isRepo && git("rev-parse", "--verify", "-q", "HEAD").status === 0) {
  const ff = git("merge-base", "--is-ancestor", "HEAD", `origin/${BRANCH}`).status === 0;
  if (ff) mode = "fast-forward";
}
say(`  mode: ${mode}`);
if (mode === "adopt") say("  local engine files that differ from upstream are backed up, then replaced; your data is untracked and stays put");

// ---------------------------------------------------------------------------
// 3. Backup. Mutable files and config always; in adopt mode every local file
//    upstream tracks that differs from upstream's copy.
// ---------------------------------------------------------------------------
step("3/8 backup");
say(`  ${BACKUP}`);
if (!DRY) {
  fs.mkdirSync(BACKUP, { recursive: true });
  for (const { file } of MUTABLE) if (backupFile(file)) say(`  + ${file}`);
  for (const extra of [path.join(".claude", "lkhs.config.json"), path.join(".claude", "memory", "core_profile.json"), "answers.json"]) {
    if (backupFile(extra)) say(`  + ${extra} (untracked; insurance copy)`);
  }
  if (mode === "adopt") {
    const tree = out(git("ls-tree", "-r", `origin/${BRANCH}`)).split("\n").filter(Boolean);
    let n = 0;
    for (const line of tree) {
      const [meta, rel] = line.split("\t");
      const blob = meta.split(" ")[2];
      const p = path.join(VAULT, rel);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
      if (out(git("hash-object", rel)) === blob) continue;
      if (backupFile(rel, "engine")) n++;
    }
    // Files the old copy tracked that upstream no longer has would otherwise linger
    // as untracked engine code; set them aside with the rest of the old engine.
    if (isRepo && git("rev-parse", "--verify", "-q", "HEAD").status === 0) {
      const upstream = new Set(tree.map(l => l.split("\t")[1]));
      for (const rel of out(git("ls-files")).split("\n").filter(Boolean)) {
        if (upstream.has(rel) || !/^(\.claude\/(bin|hooks|web)|scripts)\//.test(rel)) continue;
        if (backupFile(rel, "engine")) { fs.rmSync(path.join(VAULT, rel)); n++; }
      }
    }
    say(`  + ${n} engine file(s) that differ from upstream -> ${path.join(BACKUP, "engine")}`);
  }
}

// ---------------------------------------------------------------------------
// 4. Update the code.
// ---------------------------------------------------------------------------
step("4/8 update");
const beforeRev = isRepo ? out(git("rev-parse", "--short", "HEAD")) : "(none)";
if (DRY) {
  say("  (dry run: nothing fetched or changed)");
} else if (mode === "fast-forward") {
  for (const { file } of MUTABLE) git("checkout", "--", file);
  const dirty = out(git("status", "--porcelain", "--untracked-files=no"));
  if (dirty) {
    console.error(`\n! local edits to tracked engine files would be lost by the upgrade:`);
    console.error(dirty.split("\n").map((l) => `    ${l}`).join("\n"));
    console.error(`  Your own notes and data are untracked and are NOT affected by this.`);
    console.error(`  FIX: keep them  -> git stash push -m pre-upgrade   (then re-run, and git stash pop after)`);
    console.error(`       drop them  -> git checkout -- .               (then re-run)`);
    process.exit(1);
  }
  const m = git("merge", "--ff-only", "-q", `origin/${BRANCH}`);
  if (m.status !== 0) { console.error(`! fast-forward failed: ${(m.stderr || "").trim()}\n  FIX: re-run; the script will adopt upstream instead.`); process.exit(1); }
} else {
  // Mixed reset moves the branch and the index to upstream and leaves the working
  // tree alone, so untracked data is untouched by construction; the checkout then
  // writes upstream's version of every tracked file.
  if (out(git("rev-parse", "--abbrev-ref", "HEAD")) !== BRANCH) git("checkout", "-q", "-B", BRANCH);
  const r = git("reset", "-q", `origin/${BRANCH}`);
  if (r.status !== 0) { console.error(`! git reset failed: ${(r.stderr || "").trim()}`); process.exit(1); }
  const c = git("checkout", "--", ".");
  if (c.status !== 0) { console.error(`! checkout failed: ${(c.stderr || "").trim()}\n  FIX: git checkout -- .   then re-run`); process.exit(1); }
}
if (!DRY) {
  git("branch", "-q", `--set-upstream-to=origin/${BRANCH}`, BRANCH);
  const afterRev = out(git("rev-parse", "--short", "HEAD"));
  say(beforeRev === afterRev ? `  already current (${afterRev})` : `  ${beforeRev} -> ${afterRev}`);
}

// ---------------------------------------------------------------------------
// 5. Restore user content. Upstream ships empty stubs for these two, so the
//    user's always win; CLAUDE.md deliberately stays at the new version.
// ---------------------------------------------------------------------------
step("5/8 restore your content");
for (const { file, keep } of MUTABLE) {
  const saved = path.join(BACKUP, file);
  if (!keep) { say(`  ~ ${file} replaced by the new version (yours: ${saved})`); continue; }
  if (DRY) { say(`  + ${file} would be restored`); continue; }
  if (!fs.existsSync(saved)) { say(`  - ${file} (nothing backed up)`); continue; }
  fs.copyFileSync(saved, path.join(VAULT, file));
  say(`  + ${file} restored`);
}

// ---------------------------------------------------------------------------
// 6. Config. Dated model ids go stale, so they become aliases; the plan cap is
//    set on request, and an install whose old engine capped by default keeps
//    that cap rather than silently losing it.
// ---------------------------------------------------------------------------
step("6/8 config");
const alias = (v) => (typeof v === "string" ? v.replace(/^claude-(opus|sonnet|haiku)-[\d][\w.-]*$/, "$1") : v);
const editJson = (file, label, fn) => {
  const cfg = readJson(file);
  if (!cfg) return;
  const before = JSON.stringify(cfg);
  fn(cfg);
  if (JSON.stringify(cfg) === before) return;
  say(`  ~ ${label} updated`);
  if (!DRY) fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
};
for (const [file, label] of [[LOCAL_CFG, ".claude/lkhs.config.json"], [GLOBAL_CFG, "~/.claude/lkhs-capture-config.json"]]) {
  editJson(file, `${label}: model ids -> aliases`, (c) => { for (const k of ["summaryModel", "chatModel"]) if (c[k]) c[k] = alias(c[k]); });
}
let plan = PLAN;
if (!plan && oldHadDefaultCap && !readJson(LOCAL_CFG)?.llmBudget) {
  plan = "pro";
  say("  the old engine capped background calls by default; keeping that cap (use --plan max to lift it)");
}
if (plan) {
  if (!DRY && !fs.existsSync(LOCAL_CFG)) fs.writeFileSync(LOCAL_CFG, JSON.stringify({ selfContained: true }, null, 2) + "\n");
  editJson(LOCAL_CFG, `.claude/lkhs.config.json: ${plan} plan`, (c) => Object.assign(c, PLANS[plan]));
  if (DRY) say(`  would set the ${plan} plan in .claude/lkhs.config.json`);
}
const cap = readJson(LOCAL_CFG)?.llmBudget?.dailyCalls ?? readJson(GLOBAL_CFG)?.llmBudget?.dailyCalls;
say(`  background model-call cap: ${cap == null || String(cap) === "off" || Number(cap) === 0 ? "off (Max plan)" : `${cap}/day`}`);

// ---------------------------------------------------------------------------
// 7. Dependencies + rewiring. Native modules (better-sqlite3, onnxruntime) are
//    compiled per machine and per Node ABI, so a Node major bump since the last
//    run means a rebuild. Jobs are always re-registered because both launchd
//    and Task Scheduler entries embed absolute paths.
// ---------------------------------------------------------------------------
step("7/8 dependencies + rewiring");
const prev = readJson(STATE) || {};
const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
const nodeChanged = prev.nodeMajor != null && prev.nodeMajor !== nodeMajor;
if (nodeChanged) say(`  node major changed ${prev.nodeMajor} -> ${nodeMajor}: native modules need a rebuild`);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (label, cmd, args) => {
  say(`  ${label}`);
  if (DRY) return 0;
  const r = spawnSync(cmd, args, { cwd: VAULT, stdio: "inherit", shell: process.platform === "win32" && cmd === npm });
  if (r.status !== 0) fail(`${label} failed`, `${cmd} ${args.join(" ")}`);
  return r.status ?? 1;
};

run("npm install", npm, ["install", "--no-audit", "--no-fund"]);
if (nodeChanged) run("npm rebuild (native modules)", npm, ["rebuild"]);
if (NO_WIRE) say("  hooks, MCP and background jobs skipped (--no-wire)");
else {
  run("re-install global hooks", process.execPath, ["scripts/install-global-hooks.mjs", "--vault", VAULT]);
  run("re-register MCP server", process.execPath, ["scripts/register-mcp.mjs", "--vault", VAULT]);
  run("re-register background jobs", process.execPath, ["scripts/install-jobs.mjs"]);
}

if (!DRY) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({
    nodeMajor,
    lastUpgrade: new Date().toISOString(),
    mode,
    rev: out(git("rev-parse", "HEAD")),
    backup: BACKUP,
  }, null, 2));
}

// ---------------------------------------------------------------------------
// 8. Verify. doctor is the contract: if it is green the install is good, and
//    every red line it prints carries its own FIX.
// ---------------------------------------------------------------------------
step("8/8 verify");
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
  console.log(" Code upgrade complete and verified.");
  console.log(` Pre-upgrade copies kept at: ${BACKUP}`);
  console.log(" Next, bring the data up to the new engine (resumable, prints its plan first):");
  console.log("   node scripts/migrate-vault.mjs            then   node scripts/migrate-vault.mjs --apply");
  console.log(" Do not run npm run reindex: the embeddings are still valid.");
}
console.log("===========================================================");
process.exit(failed || doctorStatus !== 0 ? 1 : 0);
