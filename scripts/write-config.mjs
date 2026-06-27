#!/usr/bin/env node
/**
 * write-config.mjs — materialize the two identity/config files from an answers JSON
 * that the SETUP runbook assembles by interviewing the user:
 *
 *   <vault>/.claude/memory/core_profile.json     (ground-truth profile, gitignored)
 *   ~/.claude/lkhs-capture-config.json           (global capture/ingest/retrieval config)
 *
 * Answers JSON shape (all optional except a name):
 * {
 *   "user": { "handle","email","display_name","legal_name","age","nationality",
 *             "location_current","education":[],"core_interests":[],"expertise_areas":[],
 *             "tone","formatting","communication_preferences":[],"writing_voice" },
 *   "objectives": { "key": {"title","target","status","deadline"} },
 *   "projects":   { "key": {"focus","status","started","github"} },
 *   "domains": ["domain"],
 *   "ingestRoots": ["/Users/her/Documents/Work", "/Users/her/Projects"],
 *   "exclude": ["/abs/path/to/skip"],
 *   "summaryModel": "claude-sonnet-4-6"
 * }
 *
 * Usage: node scripts/write-config.mjs --vault PATH --answers answers.json
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const VAULT = path.resolve(flag("vault") || process.cwd());
const ANSWERS = flag("answers");
if (!ANSWERS || !fs.existsSync(ANSWERS)) { console.error("usage: --vault PATH --answers answers.json"); process.exit(1); }

const a = JSON.parse(fs.readFileSync(ANSWERS, "utf8"));
const u = a.user || {};
const today = new Date().toISOString().slice(0, 10);
const name = u.display_name || u.legal_name || u.handle || "User";
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- core_profile.json ----------------------------------------------------
const coreProfile = {
  _meta: {
    schema_version: "1.0",
    updated: today,
    instructions: "Ground-truth user profile. Background agents read this every session and must NEVER overwrite fields listed in constraints.never_overwrite without explicit user verification.",
  },
  user: {
    handle: u.handle || slug(name),
    email: u.email || "",
    display_name: u.display_name || name,
    legal_name: u.legal_name || "",
    age: u.age || 0,
    nationality: u.nationality || "",
    location_current: u.location_current || "",
    background: {
      education: u.education || [],
      core_interests: u.core_interests || [],
      expertise_areas: u.expertise_areas || [],
    },
    stylistic_fingerprint: {
      tone: u.tone || "",
      formatting: u.formatting || "",
      communication_preferences: u.communication_preferences || [],
      writing_voice: u.writing_voice || "",
    },
  },
  active_objectives: a.objectives || {},
  tracked_projects: a.projects || {},
  domains_tracked: a.domains || [],
  constraints: {
    never_overwrite: ["user", "active_objectives", "tracked_projects"],
    auto_append_allowed: ["domains_tracked", "_meta.updated"],
  },
};
const cpPath = path.join(VAULT, ".claude", "memory", "core_profile.json");
fs.mkdirSync(path.dirname(cpPath), { recursive: true });
fs.writeFileSync(cpPath, JSON.stringify(coreProfile, null, 2) + "\n");
console.log(`  + ${cpPath}`);

// ---- global lkhs-capture-config.json --------------------------------------
const globalCfg = {
  centralVault: VAULT,
  personaHub: { id: slug(u.handle || name), label: name, type: "person" },
  summaryModel: a.summaryModel || "claude-sonnet-4-6",
  chatModel: a.chatModel || a.summaryModel || "claude-sonnet-4-6",
  daemonPort: a.daemonPort || 7077,
  webPort: a.webPort || 7099,
  retrieveThreshold: 0.62,
  retrieveTopK: 4,
  enableRerank: true,
  rerankPool: 16,
  rerankMaxChars: 400,
  rerankHigh: 0.30,
  rerankLow: 0.02,
  personaBoost: 0.15,
  metaFloor: 0.5,
  exclude: a.exclude || [],
  ingestRoots: a.ingestRoots || [],
  ingestExclude: [
    "node_modules", ".git", ".venv", "venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache",
    "dist", "build", "out", ".next", ".cache", "target", ".obsidian", ".idea", ".vscode",
    "checkpoints", "wandb", ".ipynb_checkpoints", "site-packages",
  ],
  ingestSkipPatterns: ["- copy", "copy (", "_copy", " (copy)", "backup", " - bak", ".bak", " - old", "(old)"],
};
const gcPath = path.join(os.homedir(), ".claude", "lkhs-capture-config.json");
fs.mkdirSync(path.dirname(gcPath), { recursive: true });
if (fs.existsSync(gcPath)) fs.copyFileSync(gcPath, gcPath + `.bak.${Date.now()}`);
fs.writeFileSync(gcPath, JSON.stringify(globalCfg, null, 2) + "\n");
console.log(`  + ${gcPath}`);
console.log(`Config written for "${name}". Vault: ${VAULT}`);
