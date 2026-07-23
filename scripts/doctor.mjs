#!/usr/bin/env node
/**
 * doctor.mjs — full health + install diagnostic for Claude Mind. Checks every part of
 * the install and prints, for each failure, the exact one-line fix. Designed to be run
 * (and re-run) by Claude Code: read the output, apply the FIX lines, run again until
 * everything is green.
 *
 *   node scripts/doctor.mjs          (run from the vault)
 *   node scripts/doctor.mjs --deep   (also runs the engine round-trip, npm run smoke)
 *
 * Exit code: 0 if no FAILs (warnings allowed), 1 if any hard FAIL. Diagnostic only —
 * it never changes anything, it tells you what to change.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

const VAULT = process.cwd();
const HOME_CLAUDE = path.join(os.homedir(), ".claude");
const deep = process.argv.includes("--deep");
const results = [];
const add = (status, name, detail, fix) => results.push({ status, name, detail, fix });
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const has = (cmd) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" }).status === 0;
// Safe command capture: never throws, always returns a string (Windows shims can
// return undefined stdout, and a missing binary yields an error, not a crash).
const sh = (cmd, args) => { try { return spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" }).stdout || ""; } catch { return ""; } };

// 1. Node version
const major = parseInt(process.versions.node.split(".")[0], 10);
major >= 18
  ? add("PASS", "node", `v${process.versions.node}`)
  : add("FAIL", "node", `v${process.versions.node} too old`, "install Node 18 or newer, then re-run setup");

// 2. Dependencies installed (native deps must be built for THIS machine)
const deps = ["tsx", "better-sqlite3", "sqlite-vec", "@huggingface/transformers"];
const missing = deps.filter((d) => !fs.existsSync(path.join(VAULT, "node_modules", d)));
missing.length === 0
  ? add("PASS", "dependencies", "node_modules present (tsx + native deps)")
  : add("FAIL", "dependencies", `missing: ${missing.join(", ")}`, "npm install   (or: npm rebuild   if you upgraded Node)");

// 3. claude CLI
has("claude")
  ? add("PASS", "claude CLI", sh("claude", ["--version"]).trim() || "found")
  : add("FAIL", "claude CLI", "not on PATH", "install Claude Code and sign in (Max subscription), then re-run");

// 4. core_profile.json personalized (not the example template)
const cp = readJson(path.join(VAULT, ".claude", "memory", "core_profile.json"));
if (!cp) add("FAIL", "profile", "core_profile.json missing", "run setup: node scripts/finalize-setup.mjs --answers answers.json");
else if (!cp.user?.display_name || cp.user.display_name === "First") add("WARN", "profile", "exists but looks unfilled", "re-run write-config with a real answers.json");
else add("PASS", "profile", `core_profile.json for "${cp.user.display_name}"`);

// 5. Global config points at THIS vault
const gcPath = path.join(HOME_CLAUDE, "lkhs-capture-config.json");
const gc = readJson(gcPath);
if (!gc) add("FAIL", "global config", `${gcPath} missing`, "node scripts/write-config.mjs --vault \"$PWD\" --answers answers.json");
else if (!gc.centralVault || real(gc.centralVault) !== real(VAULT))
  add("FAIL", "global config", `centralVault = ${gc.centralVault || "(unset)"} but this vault is ${VAULT}`, "re-run from this folder: node scripts/finalize-setup.mjs --answers answers.json");
else add("PASS", "global config", `centralVault -> this vault; ${(gc.ingestRoots || []).length} ingest root(s)`);

// 6. Global hooks: files present + wired in settings.json
const hookFiles = ["lkhs-prompt-retrieve.mjs", "lkhs-project-card.mjs", "lkhs-capture.mjs"];
const hooksThere = hookFiles.every((h) => fs.existsSync(path.join(HOME_CLAUDE, "hooks", h)));
const gs = readJson(path.join(HOME_CLAUDE, "settings.json")) || {};
const wired = (event, script) => ((gs.hooks?.[event]) || []).some((g) => (g.hooks || []).some((h) => (h.args || []).some((a) => String(a).includes(script))));
const allWired = wired("UserPromptSubmit", "lkhs-prompt-retrieve") && wired("SessionStart", "lkhs-project-card") && wired("SessionEnd", "lkhs-capture") && wired("PreCompact", "lkhs-capture");
hooksThere && allWired
  ? add("PASS", "global hooks", "capture + retrieval wired in ~/.claude/settings.json")
  : add("FAIL", "global hooks", hooksThere ? "files present but not all wired" : "hook files not installed", "npm run install:hooks");

// 7. Repo SessionStart hook
fs.existsSync(path.join(VAULT, ".claude", "settings.json"))
  ? add("PASS", "vault hook", ".claude/settings.json present")
  : add("WARN", "vault hook", ".claude/settings.json missing", "restore it from the repo (git checkout .claude/settings.json)");

// 8. MCP registered
if (has("claude")) {
  const list = sh("claude", ["mcp", "list"]);
  /lkhs-memory/.test(list)
    ? add("PASS", "MCP server", "lkhs-memory registered")
    : add("FAIL", "MCP server", "lkhs-memory not registered", "npm run install:mcp");
} else add("WARN", "MCP server", "skipped (claude CLI missing)", "install claude, then npm run install:mcp");

// 9. launchd jobs (macOS)
if (process.platform === "darwin") {
  const list = spawnSync("launchctl", ["list"], { encoding: "utf8" }).stdout || "";
  const jobs = ["daemon", "watcher", "sweep", "dream"];
  const loaded = jobs.filter((j) => list.includes(`com.claudemind.${j}`));
  loaded.length === jobs.length
    ? add("PASS", "launchd jobs", "all 4 loaded (daemon, watcher, sweep, dream)")
    : add("FAIL", "launchd jobs", `loaded: ${loaded.join(", ") || "none"}`, "npm run install:launchd");
} else add("WARN", "background jobs", "not macOS — launchd skipped", "use the manual launcher: ./launch.command");

// 10. Daemon responding + store populated
const port = gc?.daemonPort || 7077;
let health = null;
try {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2000);
  const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal });
  clearTimeout(t);
  if (r.ok) health = await r.json();
} catch {}
if (health?.ok) add("PASS", "retrieval daemon", `up on :${port} (${health.files} files, ${health.chunks} chunks)`);
else add("FAIL", "retrieval daemon", `no response on :${port}`, process.platform === "darwin" ? "npm run install:launchd   (or start once: npm run serve)" : "start it: npm run serve");

// 11. Vector store has content
const dbPath = path.join(VAULT, ".claude", "memory", "vector_store.db");
if (health?.chunks > 0) add("PASS", "memory store", `${health.chunks} chunks indexed`);
else if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 20000) add("WARN", "memory store", "db exists; daemon down so count unknown", "start daemon, re-run doctor");
else add("WARN", "memory store", "empty or missing — nothing ingested yet", "npm run ingest:dirs && npm run embed");

// 12. Persona (optional)
fs.existsSync(path.join(VAULT, "persona", "PROFILE.md"))
  ? add("PASS", "persona", "deep user model present")
  : add("WARN", "persona", "not built (optional)", "see docs/persona-synthesis.md (export chats -> persona:extract -> synthesis)");

// 13. Scope layer + modules (synthesis backport)
const mergedCfg = { ...(readJson(path.join(HOME_CLAUDE, "lkhs-capture-config.json")) || {}), ...(readJson(path.join(VAULT, ".claude", "lkhs.config.json")) || {}) };
{
  const SCOPES = ["clinical", "private", "personal", "professional", "public"];
  const profs = Array.isArray(mergedCfg.profiles) ? mergedCfg.profiles : null;
  if (!profs) add("PASS", "scope profiles", "built-in registry (full/work/public)");
  else {
    const bad = profs.filter((p) => !p?.name || !SCOPES.includes(p.ceiling));
    bad.length === 0
      ? add("PASS", "scope profiles", profs.map((p) => `${p.name}:${p.ceiling}`).join(", "))
      : add("FAIL", "scope profiles", `invalid entries: ${bad.map((p) => p?.name || "?").join(", ")}`, "fix `profiles` in .claude/lkhs.config.json (ceiling must be one of " + SCOPES.join("/") + ")");
  }
  if (fs.existsSync(dbPath)) {
    try {
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(dbPath, { readonly: true });
      const cols = db.prepare("PRAGMA table_info(fact)").all().map((c) => c.name);
      db.close();
      cols.includes("scope")
        ? add("PASS", "scope schema", "fact.scope column present")
        : add("FAIL", "scope schema", "fact.scope missing", "npx tsx .claude/bin/migrate-store.ts --schema");
    } catch (e) { add("WARN", "scope schema", `could not open store: ${e.message}`, "close other processes and re-run"); }
  }
  const mim = process.env.LKHS_MIMESIS_PROFILES || mergedCfg.mimesisProfilesRoot;
  if (!mim) add("PASS", "voice module", "off (no mimesisProfilesRoot — miner/recalibration dormant)");
  else fs.existsSync(String(mim))
    ? add("PASS", "voice module", `on -> ${mim}`)
    : add("FAIL", "voice module", `mimesisProfilesRoot not found: ${mim}`, "fix the path in .claude/lkhs.config.json or remove the key");
  fs.existsSync(path.join(VAULT, "evals", "scope-leak", "probes.jsonl"))
    ? add("PASS", "leak probes", "probe set present (nightly smoke active)")
    : add("WARN", "leak probes", "no probe set yet — nightly smoke skips", "scaffold per docs/evals.md once the vault has content");
  fs.existsSync(path.join(VAULT, ".claude", "memory", "eval", "memory_eval.jsonl"))
    ? add("PASS", "memory eval set", "question set present (weekly drift alarm active)")
    : add("WARN", "memory eval set", "no question set yet — weekly eval skips", "scaffold per docs/evals.md once the vault has content");
}

// ---- optional deep engine test ----
if (deep) {
  console.log("Running engine round-trip (npm run smoke) — may download models on first run...\n");
  const smoke = spawnSync(process.execPath, ["--import", "tsx", ".claude/bin/smoke-test.ts"], { cwd: VAULT, stdio: "inherit" });
  smoke.status === 0
    ? add("PASS", "engine round-trip", "embed -> query -> retrieve OK")
    : add("FAIL", "engine round-trip", "smoke test failed (see output above)", "check the error; usually npm rebuild fixes native-dep issues");
}

// ---- report ----
const icon = { PASS: "✓", WARN: "!", FAIL: "✗" };
console.log("\n  Claude Mind — doctor\n  " + "-".repeat(60));
for (const r of results) {
  console.log(`  [${icon[r.status]} ${r.status}] ${r.name.padEnd(18)} ${r.detail}`);
  if (r.status === "FAIL" || (r.status === "WARN" && r.fix)) console.log(`           ${r.status === "FAIL" ? "FIX" : "hint"}: ${r.fix}`);
}
const n = (s) => results.filter((r) => r.status === s).length;
console.log("  " + "-".repeat(60));
console.log(`  ${n("PASS")} passed, ${n("WARN")} warnings, ${n("FAIL")} failed\n`);
if (n("FAIL") > 0) { console.log("  Apply the FIX line for each ✗, then re-run: npm run doctor\n"); process.exit(1); }
console.log("  Healthy. " + (deep ? "Engine round-trip passed too." : "For a deep engine test: npm run doctor -- --deep") + "\n");
