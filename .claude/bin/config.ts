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

// ---- retrieval gate (single source of truth) --------------------------------
// Shared by lkhs-daemon.ts (the live gate) and lkhs-web.ts (the retrieval
// inspector) so the inspector always reflects the real gate. Config keys override
// the defaults; defaults match the calibrated values (see calibrate-rerank.ts).
export function retrieveThreshold(): number { return num(config().retrieveThreshold, 0.62); }
export function retrieveTopK(): number { return num(config().retrieveTopK, 4); }
export function enableRerank(): boolean { return (config().enableRerank ?? true) !== false; }
export function rerankPool(): number { return num(config().rerankPool, 16); }
export function rerankMaxChars(): number { return num(config().rerankMaxChars, 400); }
/** Confident-inject threshold. Raised 0.30 -> 0.45 (P5 live-quality): on the live
 *  prompt set every legitimate confident inject scored >= 0.578 while a generic
 *  "convert JSON to YAML" prompt cleared 0.30 at 0.391 via a prompt-template chunk.
 *  Env-overridable for A/B (LKHS_RERANK_HIGH). */
export function rerankHigh(): number { return num(process.env.LKHS_RERANK_HIGH ?? config().rerankHigh, 0.45); }
export function rerankLow(): number { return num(config().rerankLow, 0.02); }
export function personaBoost(): number { return num(config().personaBoost, 0.15); }
/** Additive cosine bump for embedded fact hits when pooled with prose (P2): facts
 *  are the precise answer unit, so they outrank a prose chunk at equal similarity. */
export function factBoost(): number { return num(config().factBoost, 0.05); }
export function metaFloor(): number { return num(config().metaFloor, 0.5); }
export function identityFloor(): number { return num(config().identityFloor, 0.42); }

// ---- live-gate precision levers (P5, tuned by eval-live-quality.ts) -----------
// The offline recall eval cannot see over-injection: generic prompts pulling 4
// persona facts whose entire score is the +0.15 boost, or a mid-band inject flipped
// by a generic entity token ("python", "research"). These levers tune the gate for
// restraint. Each is env-overridable (LKHS_*) for A/B runs without a config write.
// Measured on the 30-prompt live_quality set (see .claude/memory/eval/QUALITY.md):
// baseline over-injection 40% / 78 injected items -> tuned 10% / 57 items, with
// recall@8 on the offline guard unchanged at 91.7% and abstention 83.3% -> 100%.
/** Per-item keep floor in the rerank gate: an item is only injected if its (boosted)
 *  rerank score clears this. Two strong hits beat four weak ones. Old behavior = rerankLow. */
export function gateItemFloor(): number { return num(process.env.LKHS_GATE_ITEM_FLOOR ?? config().gateItemFloor, 0.25); }
/** personaBoost/factBoost are only applied when the RAW cross-encoder score is at
 *  least this; a fact at raw ~0.000 must not ride the boost into the mid band.
 *  0 = old behavior (always boost). */
export function boostFloor(): number { return num(process.env.LKHS_BOOST_FLOOR ?? config().boostFloor, 0.02); }
/** Mid-band injects flipped by an entity-name intent (not recall phrasing) must
 *  additionally clear this top-score floor: naming a generic token in the entity
 *  vocab ("python", "chain") is a much weaker signal than "where did I leave off".
 *  0 = old behavior. */
export function entityMidFloor(): number { return num(process.env.LKHS_ENTITY_MID_FLOOR ?? config().entityMidFloor, 0.20); }
/** Hard cap on injected items across all gate routes (rerank/meta/identity). */
export function injectMaxItems(): number { return num(process.env.LKHS_INJECT_MAX_ITEMS ?? config().injectMaxItems, retrieveTopK()); }

// ---- P4 hybrid retrieval levers ----------------------------------------------
// Each lever is independently flag-gated so a lever that regresses the eval can be
// switched off without a code revert (env > config > default).
/** 4a: FTS5 lexical recall fused with the vector pool via Reciprocal Rank Fusion.
 *  Catches exact names/numbers/rare tokens that dense vectors miss.
 *  DEFAULT OFF (measured): on the 42-item memory eval this lever REGRESSED both
 *  naive RRF (composite 0.8778 -> 0.7083) and confirmation-only RRF (-> 0.8250).
 *  The eval's questions are paraphrases with almost no exact-token anchors, so
 *  lexical votes are mostly common-token noise that evicts current facts from the
 *  top-k (e.g. fiction chunks matching "relationship/dated" displaced the live
 *  breakup fact). It did fix 3 exact-name/number recall items (+2.8pp recall), so
 *  the lever stays available for corpora/queries where exact tokens matter:
 *  enable via LKHS_LEXICAL_RRF=1 or config lexicalRrf:true. */
export function lexicalRrf(): boolean {
  const env = process.env.LKHS_LEXICAL_RRF;
  if (env !== undefined) return env !== "0" && env.toLowerCase() !== "false";
  return (config().lexicalRrf ?? false) === true;
}
/** RRF constant k (Cormack et al.; Mimesis uses 60). */
export function rrfK(): number { return num(config().rrfK, 60); }
/** 4b: graph-aware expansion — supersession-chain forwarding: when an invalidated
 *  fact matches the query semantically, its superseding (current) fact is promoted
 *  as a candidate carrying the matched cosine. */
export function graphExpansion(): boolean {
  const env = process.env.LKHS_GRAPH_EXPANSION;
  if (env !== undefined) return env !== "0" && env.toLowerCase() !== "false";
  return (config().graphExpansion ?? true) !== false;
}
/** Attenuation on the cosine a superseding fact inherits from the invalidated fact
 *  that matched the query (it answers the same question, but indirectly). Tuned to
 *  the store's compressed cosine band: fact pools span only ~0.06 cosine across 25
 *  ranks, so 0.9 attenuation dropped every forwarded candidate below the valid-fact
 *  floor (measured, no-op); 0.95 lands it a few ranks under the stale match. */
export function supersedeCarry(): number { return num(config().supersedeCarry, 0.95); }

// ---- semantic skill router --------------------------------------------------
// Skill descriptions are embedded as their own `skill` layer; the daemon scores
// each prompt against them separately from memory. A suggestion is only surfaced
// above these floors, so unrelated prompts silently produce nothing.
export function skillSuggestFloor(): number { return num(config().skillSuggestFloor, 0.30); } // cross-encoder rerank floor
export function skillCosineFloor(): number { return num(config().skillCosineFloor, 0.55); }   // cosine fallback floor (rerank off/failed)

// Intent regexes (shared). Previously duplicated (and divergent) between the
// daemon and the web console; these are the daemon's authoritative versions.
export const TRIVIAL_RE = /^(y|n|yes|no|ok|okay|sure|thanks|thank you|continue|go|go ahead|do it|next|stop|nvm|nevermind)[.!]?$/i;
// Recall phrasing: the prompt is asking about the user's own past work, not general knowledge.
export const RECALL_RE = /\b(did i|have i|how did|where did|when did|did we|have we|last time|previously|earlier|we discussed|we built|i already|i built|i wrote|i made|i found|i created|i set up|i decided|remember|recall|my notes|my previous|my last|my earlier|carry on|pick(ing)? up where)\b/i;
// Broad / aggregative "overview" queries, routed to the synthesized layers.
export const META_RE = /\b(what am i working on|what are my|overview of|across (all )?my|my (\w+ )?(projects|research|writing|work|notes)|themes? (across|in|of|for)|state of my|summar(ize|y) of (my|all)|big picture|how do my .* (connect|relate))\b/i;
// Identity / self queries, routed to the persona (deep user model) layer first.
export const IDENTITY_RE = /\b(who am i|about (me|myself)|tell me about (me|myself)|what do you know about me|my (background|personality|psycholog|cognitive|values|worldview|biograph|history|life|identity|self|voice|writing style|mind|decision)|how does my mind|how i think|communicate with me|talk(ing)? to me|work with me|advise me|decision[- ]?(making|patterns?)|make decisions|how should (you|i) .* me)\b/i;

// ---- models ---------------------------------------------------------------
export function summaryModel(): string { return process.env.LKHS_SUMMARY_MODEL || config().summaryModel || "claude-sonnet-4-6"; }

/** Absolute path to the claude CLI. Spawned shells (scheduled tasks, hooks, tools)
 *  do not reliably carry ~\.local\bin on PATH, so bare "claude" is intermittent on
 *  Windows; probe the known install locations and fall back to PATH resolution. */
let _claudeBin: string | null = null;
export function claudeBin(): string {
  if (_claudeBin) return _claudeBin;
  const env = process.env.LKHS_CLAUDE_BIN || config().claudeBin;
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const candidates = [
    env,
    path.join(home, ".local", "bin", "claude.exe"),
    path.join(home, "AppData", "Roaming", "npm", "claude.cmd"),
    path.join(home, ".claude", "local", "claude.exe"),
  ].filter(Boolean) as string[];
  for (const c of candidates) { try { if (fs.existsSync(c)) { _claudeBin = c; return c; } } catch { /* */ } }
  _claudeBin = "claude";
  return _claudeBin;
}
export function chatModel(): string { return process.env.LKHS_CHAT_MODEL || config().chatModel || summaryModel(); }

// ---- identity -------------------------------------------------------------
export interface PersonaHub { id: string; label: string; type: string }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The graph hub / identity owner, data-driven instead of hardcoded to one person.
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
/** Recency-decay half-life (days) for persona fact ranking in recall_persona:
 *  sort key = confidence * exp(-ageDays / halflife). ~540d = old facts at half weight
 *  after 18 months; validity (invalid_at) is a hard filter, this only orders. */
export function personaHalfLifeDays(): number { return num(process.env.LKHS_PERSONA_HALFLIFE_DAYS ?? config().personaHalfLifeDays, 540); }

// P1 hot-path quality knobs (LKHS-V2-UPGRADE-PATH.md). Session chunks are the
// volatile "what am I doing now" layer: short half-life at the rerank stage,
// query-gated off for recall/identity/meta prompts, floored via decayBlend.
export function sessionHalfLifeDays(): number { return num(process.env.LKHS_SESSION_HALFLIFE_DAYS ?? config().sessionHalfLifeDays, 30); }
// Near-duplicate collapse at the keep-list: word-set Jaccard at/above this drops the
// lower-scored duplicate (personal stores are near-duplicate-heavy; two strong
// distinct hits beat four recaps of the same event).
export function dedupJaccard(): number { return num(process.env.LKHS_DEDUP_JACCARD ?? config().dedupJaccard, 0.7); }
// Mid-band steering nudge: when the gate is uncertain and withholds injection, tell
// the model memory likely exists so it can search actively. Floor keeps weak mids quiet.
export function enableNudge(): boolean { return (config().enableNudge ?? true) !== false; }
export function nudgeFloor(): number { return num(process.env.LKHS_NUDGE_FLOOR ?? config().nudgeFloor, 0.15); }
// P6 graph second-hop: when the gate lands mid-band, expand the candidate pool once
// via knowledge-graph neighbors of entities named in the prompt, then re-gate. One
// extra embed+knn+rerank, only on the uncertain band (GraphSearch local step).
export function enableGraphHop(): boolean { return (config().enableGraphHop ?? true) !== false; }
// P10 injection etiquette: sessions in these projects are PERSONAL. In work sessions,
// personal-conversation journals stay out of topical injections (reachable via
// explicit recall/identity phrasing); in personal sessions, date-triggered reminders
// hold until the next work session instead of intruding at 1am.
export function etiquettePersonalProjects(): string[] {
  const v = config().etiquettePersonalProjects;
  return Array.isArray(v) ? v.map(String) : [];  // portable default: none; set etiquettePersonalProjects in config
}

/** Build/stamp date. Defaults to the clock so a persona rebuild stamps facts with the
 *  day it ran, not a frozen literal. Overridable for reproducible rebuilds. */
export function today(): string {
  return process.env.LKHS_BUILD_DATE || config().buildDate || new Date().toISOString().slice(0, 10);
}

// ---- audience scopes + profiles (synthesis P1) ------------------------------
// Every memory item has a scope on an ordered privacy ladder; a PROFILE carries a
// ceiling and only items at-or-above the ceiling are retrievable under it. The
// default profile (`full`, ceiling `private`) reproduces today's behavior exactly:
// everything except the clinical tier, which keeps its own harder quarantine
// (explicit-query only) on top of scope. Fail-closed convention everywhere: an
// unknown/missing scope resolves to `personal`, never `public`.
export const SCOPE_ORDER = ["clinical", "private", "personal", "professional", "public"] as const;
export type Scope = (typeof SCOPE_ORDER)[number];

/** Rank on the ladder (0 = most private). Unknown/missing = personal. */
export function scopeRank(s: string | null | undefined): number {
  const i = SCOPE_ORDER.indexOf(String(s || "personal").toLowerCase() as Scope);
  return i >= 0 ? i : SCOPE_ORDER.indexOf("personal");
}

export interface ScopeProfile { name: string; ceiling: Scope; pin_cwds: string[] }

const DEFAULT_PROFILES: ScopeProfile[] = [
  { name: "full", ceiling: "private", pin_cwds: [] },          // = current behavior (clinical still quarantined)
  { name: "work", ceiling: "professional", pin_cwds: [] },
  { name: "public", ceiling: "public", pin_cwds: [] },
];

/** Profile registry. config `profiles: [{name, ceiling, pin_cwds}]` replaces the
 *  defaults wholesale (a partial list is a complete registry for that user). */
export function scopeProfiles(): ScopeProfile[] {
  const v = config().profiles;
  if (!Array.isArray(v) || v.length === 0) return DEFAULT_PROFILES;
  return v
    .filter((p: any) => p && p.name && SCOPE_ORDER.includes(String(p.ceiling) as Scope))
    .map((p: any) => ({ name: String(p.name), ceiling: p.ceiling as Scope, pin_cwds: Array.isArray(p.pin_cwds) ? p.pin_cwds.map(String) : [] }));
}

/** Active profile: env LKHS_PROFILE > per-project pin (cwd basename match) > `full`.
 *  An unknown LKHS_PROFILE name falls through to the pin/default path rather than
 *  failing open. Default = `full`, so with no config the system is unchanged. */
export function resolveProfile(cwd?: string): ScopeProfile {
  const profiles = scopeProfiles();
  const env = process.env.LKHS_PROFILE?.trim().toLowerCase();
  if (env) { const p = profiles.find(x => x.name.toLowerCase() === env); if (p) return p; }
  if (cwd) {
    const base = path.basename(String(cwd).replace(/[\\/]+$/, "")).toLowerCase();
    for (const p of profiles) if (p.pin_cwds.some(c => String(c).toLowerCase() === base)) return p;
  }
  return profiles.find(p => p.name === "full") || DEFAULT_PROFILES[0]!;
}

// Chunk scope is DERIVED (layer + path rules), not stored: chunks carry file+layer
// in every retrieval row already, so deriving at filter time keeps scope always
// consistent with config with zero migration/backfill. Facts, whose scope is
// content-based, carry a real judged `scope` column instead (fact.scope).
// Defaults (config `chunkScopes: { layers: {...}, prefixes: [{prefix, scope}] }`
// overrides): persona tiers are private; personal-project journals/cards are
// private (reuses etiquettePersonalProjects); knowledge layers (wiki/library/
// cards) are professional so a `work` profile keeps its research memory; themes
// synthesize across personal material and stay personal.
const DEFAULT_LAYER_SCOPES: Record<string, Scope> = {
  "persona-clinical": "clinical",
  persona: "private",
  memory: "private",
  session: "personal",
  theme: "personal",
  raw: "personal",
  other: "personal",
  card: "professional",
  wiki: "professional",
  project: "professional",
  skill: "public",
};

let _chunkScopeRules: { layers: Record<string, Scope>; prefixes: Array<{ prefix: string; scope: Scope }> } | null = null;
function chunkScopeRules() {
  if (_chunkScopeRules) return _chunkScopeRules;
  const c = config().chunkScopes || {};
  const layers = { ...DEFAULT_LAYER_SCOPES, ...(c.layers && typeof c.layers === "object" ? c.layers : {}) };
  const prefixes: Array<{ prefix: string; scope: Scope }> = Array.isArray(c.prefixes)
    ? c.prefixes.filter((p: any) => p && p.prefix && SCOPE_ORDER.includes(String(p.scope) as Scope))
        .map((p: any) => ({ prefix: String(p.prefix).replace(/\\/g, "/"), scope: p.scope as Scope }))
    : [];
  // personal-project etiquette list doubles as privacy routing: those projects'
  // journals and cards are private regardless of layer default.
  for (const proj of etiquettePersonalProjects()) {
    prefixes.push({ prefix: `journal/${proj}`, scope: "private" });
    prefixes.push({ prefix: `cards/${proj}`, scope: "private" });
  }
  _chunkScopeRules = { layers, prefixes };
  return _chunkScopeRules;
}

/** Scope of a prose chunk, derived from its file path + layer. Prefix rules win
 *  over layer defaults; unknown layers are `personal` (fail-closed). */
export function scopeOfChunk(file: string, layer: string | null | undefined): Scope {
  const f = String(file || "").replace(/\\/g, "/");
  const rules = chunkScopeRules();
  for (const p of rules.prefixes) if (f.startsWith(p.prefix)) return p.scope;
  return rules.layers[String(layer || "other")] || "personal";
}

// ---- Mimesis bridge (synthesis P3) ------------------------------------------
/** Root of the Mimesis voice profiles (profiles/<slug>/...), where the preference
 *  miner writes mined accepts/edit-pairs. null = miner runs report-only. */
export function mimesisProfilesRoot(): string | null {
  const v = process.env.LKHS_MIMESIS_PROFILES || config().mimesisProfilesRoot;
  return v && String(v).trim() ? path.resolve(String(v).trim()) : null;
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
