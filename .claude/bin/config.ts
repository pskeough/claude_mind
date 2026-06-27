/**
 * LKHS configuration: the single source of truth for "where am I" and "what are my
 * knobs". Every bin/ script imports from here instead of re-deriving the vault root
 * or re-reading the config file, so the whole system computes its environment one way.
 *
 * Resolution order is consistent everywhere:
 *   vault root : env LKHS_VAULT_ROOT  >  config.centralVault  >  this file's ../..
 *   config     : ~/.claude/lkhs-capture-config.json  <-(overlaid)-  <vault>/.claude/lkhs.config.json
 *   scalars    : env  >  config  >  built-in default
 *
 * This file lives at <vault>/.claude/bin/config.ts, so `path.resolve(__dirname,
 * "..", "..")` is the vault root deterministically, independent of process.cwd().
 * That is strictly more robust than the old `process.cwd()` pattern (which only
 * worked when a script happened to be launched from the vault directory) and equals
 * it in normal use, so adopting it cannot regress the current setup.
 *
 * Identity (personaHub) and the clinical-quarantine lexicon are data-driven so the
 * persona pipeline is not soldered to one person. Defaults reproduce the current
 * behavior exactly; a user overrides them via core_profile.json / config.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// <vault>/.claude/bin/config.ts -> <vault>
const DERIVED_ROOT = path.resolve(__dirname, "..", "..");
const GLOBAL_CONFIG = path.join(os.homedir(), ".claude", "lkhs-capture-config.json");

function readJson(file: string): any | null {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

let _cfg: any | undefined;
/** Merged config: global (~/.claude) as the base, repo-local (.claude/lkhs.config.json)
 *  overlaid on top. Repo-local lets a shipped clone carry its own config without a
 *  global file; on this machine the repo-local file is absent so behavior is unchanged. */
export function config(): any {
  if (_cfg !== undefined) return _cfg;
  const base = readJson(GLOBAL_CONFIG) || {};
  // resolve repo-local against the env/global-derived root so a centralVault override is honored
  const root = process.env.LKHS_VAULT_ROOT?.trim() || base.centralVault || DERIVED_ROOT;
  const local = readJson(path.join(path.resolve(root), ".claude", "lkhs.config.json"));
  _cfg = local ? { ...base, ...local } : base;
  return _cfg;
}

/** The vault root. env LKHS_VAULT_ROOT > config.centralVault > derived (../..). */
export function vaultRoot(): string {
  const env = process.env.LKHS_VAULT_ROOT;
  if (env && env.trim()) return path.resolve(env.trim());
  const cv = config().centralVault;
  if (cv && String(cv).trim()) return path.resolve(String(cv).trim());
  return DERIVED_ROOT;
}

const num = (v: any, d: number): number => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// ---- paths ----------------------------------------------------------------
export function memDir(): string { return path.join(vaultRoot(), ".claude", "memory"); }
export function dbPath(): string {
  return process.env.LKHS_DB_PATH || path.join(memDir(), "vector_store.db");
}
/** Transformers.js model cache. Anchored to the vault (not cwd) so the cross-encoder
 *  is not re-downloaded when a script runs from a different directory. */
export function cacheDir(): string {
  return process.env.LKHS_CACHE_DIR || path.join(vaultRoot(), "local_cache", "transformers");
}
export function logFile(): string { return path.join(vaultRoot(), ".claude", "logs", "ambient.log"); }

// ---- ports ----------------------------------------------------------------
export function daemonPort(): number { return num(process.env.LKHS_DAEMON_PORT ?? config().daemonPort, 7077); }
export function webPort(): number { return num(process.env.LKHS_WEB_PORT ?? config().webPort, 7099); }

// ---- models ---------------------------------------------------------------
export function summaryModel(): string { return process.env.LKHS_SUMMARY_MODEL || config().summaryModel || "claude-sonnet-4-6"; }
export function chatModel(): string { return process.env.LKHS_CHAT_MODEL || config().chatModel || summaryModel(); }

// ---- identity -------------------------------------------------------------
export interface PersonaHub { id: string; label: string; type: string }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The graph hub / identity owner, data-driven instead of a hardcoded name.
 * Order: env > config.personaHub > existing persona/entities.json hub (sticky, so
 * identity stays stable across rebuilds) > core_profile.json user block > generic.
 */
export function personaHub(): PersonaHub {
  const envLabel = process.env.LKHS_PERSONA_LABEL?.trim();
  if (envLabel) return { id: process.env.LKHS_PERSONA_ID?.trim() || slug(envLabel), label: envLabel, type: "person" };

  const h = config().personaHub;
  if (h && h.label) return { id: h.id || slug(h.label), label: h.label, type: h.type || "person" };

  const existing = readJson(path.join(vaultRoot(), "persona", "entities.json"));
  if (existing?.hub?.label) return { id: existing.hub.id || slug(existing.hub.label), label: existing.hub.label, type: existing.hub.type || "person" };

  const cp = readJson(path.join(memDir(), "core_profile.json"));
  const u = cp?.user || {};
  const label = u.legal_name || u.display_name || u.name || (u.handle ? String(u.handle) : "");
  if (label) return { id: u.handle ? slug(String(u.handle)) : slug(label), label, type: "person" };

  return { id: "me", label: "Me", type: "person" };
}

// ---- temporal -------------------------------------------------------------
/** Build/stamp date. Defaults to the clock so a persona rebuild stamps facts with the
 *  day it ran, not a frozen literal. Overridable for reproducible rebuilds. */
export function today(): string {
  return process.env.LKHS_BUILD_DATE || config().buildDate || new Date().toISOString().slice(0, 10);
}

// ---- clinical quarantine lexicon ------------------------------------------
// Data-driven so another user's sensitive terms govern their own quarantine. The
// defaults below reproduce the original hardcoded behavior byte-for-byte; supplying
// `clinical: { med:[...], crisis:[...], coping:[...], advocacyGuard:[...], academicGuard:[...] }`
// in config replaces the corresponding list (word-OR, case-insensitive).
export interface ClinicalLexicon { med: RegExp; crisis: RegExp; coping: RegExp; advocacyGuard: RegExp; academicGuard: RegExp }

const DEFAULT_CLINICAL: ClinicalLexicon = {
  med: /\b(wellbutrin|bupropion|vyvanse|lisdexamfetamine|adderall|ssri|snri|antidepressant|stimulant medication)\b|\b\d{1,4}\s?mg\b/i,
  crisis: /\b(suicidal|suicide|suicidality|self[- ]harm(ed|ing)?|self[- ]destruct|death[- ]wish|wanting to die|cessation of (thought|consciousness)|major depressive|psychiatric (hospital|admission|ward)|hospitaliz(ed|ation) for|inpatient|overdosed|panic attack|bipolar)\b/i,
  coping: /\b(getting high (daily|to)|high (daily|to avoid|to cope)|drink(ing)? to (cope|forget|numb)|self[- ]medicat|smoking weed to (cope|avoid|numb))\b/i,
  advocacyGuard: /\b(naloxone|narcan|harm reduction|overdose (response|prevention)|distribution (site|station)|ssdp|drug policy|training)\b/i,
  academicGuard: /\b(psych ?\d|literature review|lit[- ]review|coursework|paper|study|tbi|traumatic brain|course|class\b|essay|assignment|rubric|research|lecture|exam)\b/i,
};

function reFromList(list: string[], extra = ""): RegExp {
  const body = list.map(s => String(s).trim()).filter(Boolean).join("|");
  return new RegExp(`\\b(${body})\\b${extra}`, "i");
}

export function clinicalLexicon(): ClinicalLexicon {
  const c = config().clinical;
  if (!c) return DEFAULT_CLINICAL;
  return {
    med: Array.isArray(c.med) ? reFromList(c.med, "|\\b\\d{1,4}\\s?mg\\b") : DEFAULT_CLINICAL.med,
    crisis: Array.isArray(c.crisis) ? reFromList(c.crisis) : DEFAULT_CLINICAL.crisis,
    coping: Array.isArray(c.coping) ? reFromList(c.coping) : DEFAULT_CLINICAL.coping,
    advocacyGuard: Array.isArray(c.advocacyGuard) ? reFromList(c.advocacyGuard) : DEFAULT_CLINICAL.advocacyGuard,
    academicGuard: Array.isArray(c.academicGuard) ? reFromList(c.academicGuard) : DEFAULT_CLINICAL.academicGuard,
  };
}
