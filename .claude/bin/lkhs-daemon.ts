/**
 * LKHS retrieval daemon: the warm brain.
 *
 * Loads the embedding model once and answers queries against the SQLite+sqlite-vec
 * store (store.ts) in milliseconds, so the per-prompt UserPromptSubmit hook is fast.
 * SQLite means the store is no longer parsed into RAM and writes by other processes
 * (capture, watcher, ingest) are visible immediately with no reload logic.
 *
 * Endpoints (localhost only):
 *   POST /gate   {prompt}        -> {inject, query, hits:[{file,score,text,layer}], reason}
 *   GET  /query?q=...&k=...      -> {hits}
 *   GET  /health                 -> {ok, files, chunks, port, threshold}
 *
 * The /gate decision is token-free: a heuristic skip, then an intent signal (recall
 * phrasing OR a named brain-entity), then a similarity threshold. Pure similarity
 * cannot gate (a broad corpus makes generic prompts score as high as personal ones),
 * which is why intent is required before injecting.
 *
 *   npm run serve
 */
import { FlagEmbedding, EmbeddingModel } from "fastembed";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { canonKey } from "./text-normalize";
import { knn, layerKnn, stats, getDb, hybridSearch, sha256, recordInjections, decayBlend, metaDate } from "./store";
import { rerank, warm as warmReranker } from "./rerank";
import { indexSkills, latestSkillMtime } from "./skill-index";
import { matchIntentions, markFired } from "./prospective";
import {
  daemonPort, retrieveThreshold, retrieveTopK, enableRerank, rerankPool,
  rerankMaxChars, rerankHigh, rerankLow, personaBoost, factBoost, metaFloor, identityFloor,
  gateItemFloor, boostFloor, entityMidFloor, injectMaxItems,
  skillSuggestFloor, skillCosineFloor, lexicalRrf, rrfK,
  sessionHalfLifeDays, dedupJaccard, enableNudge, nudgeFloor, enableGraphHop, etiquettePersonalProjects,
  resolveProfile, scopeRank, scopeProfiles,
  TRIVIAL_RE, RECALL_RE, META_RE, IDENTITY_RE,
} from "./config";

// Gate constants + intent regexes live in config.ts (single source of truth,
// shared with lkhs-web.ts so the retrieval inspector reflects the real gate).
const PORT = daemonPort();
const THRESHOLD = retrieveThreshold();  // cosine floor (fallback gate only)
const TOPK = retrieveTopK();
// Uptime-degradation observability (2026-07-23): /health exposes uptime + a
// rolling gate-latency p50 so drift is visible without parsing decisions.jsonl.
const STARTED = Date.now();
const RECENT_MS: number[] = [];

// Reranker gate. The cross-encoder is the primary relevance signal; intent breaks
// the ambiguous middle band. Thresholds calibrated against a personal-vs-general
// battery (see calibrate-rerank.ts): clear recall ~0.95+, general ~0.00-0.05.
const ENABLE_RERANK = enableRerank();
const RERANK_POOL = rerankPool();       // bi-encoder candidates to rerank
const RERANK_MAXCHARS = rerankMaxChars(); // truncate passages before scoring (latency)
const RERANK_HIGH = rerankHigh();       // >= this: inject (confident)
const RERANK_LOW = rerankLow();         // < this: skip (confident)
const PERSONA_BOOST = personaBoost();   // additive rerank bump for the persona (identity) layer

// P5 live-quality precision levers (see config.ts + .claude/memory/eval/QUALITY.md).
const ITEM_FLOOR = gateItemFloor();     // per-item keep floor: weak tail items are not injected
const BOOST_FLOOR = boostFloor();       // boost only applies when the RAW rerank score clears this
const ENTITY_MID_FLOOR = entityMidFloor(); // mid-band entity-name injects need this top score
const MAX_ITEMS = Math.max(1, injectMaxItems()); // hard cap on injected items, all routes

// P1 hot-path quality levers (LKHS-V2-UPGRADE-PATH.md).
const SESSION_HALFLIFE = sessionHalfLifeDays(); // rerank-stage decay for session chunks
const DEDUP_J = dedupJaccard();                 // near-duplicate keep-list collapse
const ENABLE_NUDGE = enableNudge();             // mid-band steering nudge on withheld injection
const NUDGE_FLOOR = nudgeFloor();
const ENABLE_GRAPH_HOP = enableGraphHop();      // mid-band graph-neighbor pool expansion
// P10 etiquette: personal-project registry. Work sessions keep personal-conversation
// journals out of topical injections; personal sessions defer date-triggered reminders.
const PERSONAL_PROJECTS = etiquettePersonalProjects();
const PERSONAL_JOURNALS = new Set(PERSONAL_PROJECTS.map(p => `journal/${p}.md`));
const isPersonalCwd = (cwd?: string) => !!cwd && PERSONAL_PROJECTS.some(p => canonKey(path.basename(cwd)) === canonKey(p));

// Synthesis P1: explicit profile lookup for the /gate body override (leak harness /
// per-session stamping). Unknown name -> null (falls through to resolveProfile).
function scopeProfilesByName(name: string) {
  return scopeProfiles().find(p => p.name.toLowerCase() === String(name).trim().toLowerCase()) || null;
}

// Live-session registry: every /gate call heartbeats its session (cwd + focus).
// SessionStart hooks read /sessions so concurrent Claude sessions know about each
// other (LKHS covers memory across time; this covers awareness across space).
// Ephemeral by design: daemon restart clears it; entries expire after 30 min.
// Etiquette: personal-project sessions are listed by project name only, no focus text.
interface SessionBeat { cwd: string; project: string; personal: boolean; focus: string; last: number; hits: number }
const REGISTRY = new Map<string, SessionBeat>();
const REGISTRY_TTL_MS = 30 * 60_000;
function heartbeat(sessionId: string | undefined, cwd: string | undefined, prompt: string): void {
  if (!sessionId || !cwd) return;
  const personal = isPersonalCwd(cwd);
  const prev = REGISTRY.get(sessionId);
  REGISTRY.set(sessionId, {
    cwd, project: path.basename(cwd.replace(/[\\/]+$/, "")), personal,
    focus: personal ? "" : prompt.slice(0, 90).replace(/\s+/g, " "),
    last: Date.now(), hits: (prev?.hits || 0) + 1
  });
  for (const [k, v] of REGISTRY) if (Date.now() - v.last > REGISTRY_TTL_MS) REGISTRY.delete(k);
}
function activeSessions(excludeSession?: string): Array<{ project: string; minutesAgo: number; focus: string; hits: number }> {
  const now = Date.now();
  return [...REGISTRY.entries()]
    .filter(([k, v]) => k !== excludeSession && now - v.last <= REGISTRY_TTL_MS)
    .map(([, v]) => ({ project: v.project, minutesAgo: Math.round((now - v.last) / 60_000), focus: v.focus, hits: v.hits }))
    .sort((a, b) => a.minutesAgo - b.minutesAgo);
}

// Semantic skill router. Scored separately from memory (never displaces it); a
// suggestion is only surfaced above the floor. Rerank primary, cosine fallback.
const SKILL_FLOOR = skillSuggestFloor();       // cross-encoder floor to suggest
const SKILL_COSINE_FLOOR = skillCosineFloor(); // cosine floor when rerank off/failed
const SKILL_POOL = 8;                           // bi-encoder candidates to consider
const SKILL_MAX = 2;                            // at most this many suggestions

let _model: Promise<FlagEmbedding> | null = null;
const getModel = () => (_model ??= FlagEmbedding.init({ model: EmbeddingModel.BGESmallENV15 }));

async function embedQuery(q: string): Promise<number[]> {
  const model = await getModel();
  for await (const batch of model.embed([`query: ${q.replace(/\s+/g, " ").trim()}`]))
    for (const v of batch) return Array.from(v as ArrayLike<number>);
  return [];
}

interface Hit { file: string; score: number; text: string; layer: string; meta?: string | null }
const FACT_BOOST = factBoost();          // additive cosine bump for embedded fact hits in the pool
// Stage timings (latency-degradation investigation, 2026-07-23): a shared `t`
// object accumulates per-stage ms through the gate path and lands in
// decisions.jsonl, so multi-day drift is attributable to a stage (embed model,
// SQLite pool, cross-encoder) instead of a single opaque number.
type StageT = Record<string, number>;
const addT = (t: StageT | undefined, k: string, ms: number) => { if (t) t[k] = (t[k] || 0) + ms; };

async function query(q: string, k: number, ceiling?: number, t?: StageT): Promise<Hit[]> {
  let t0 = Date.now();
  const qv = await embedQuery(q);
  addT(t, "emb", Date.now() - t0);
  if (qv.length === 0) return [];
  t0 = Date.now();
  // P4a hybrid pool (store.hybridSearch): dense knn prose + factKnn facts exactly as
  // before, with FTS5 lexical lists fused in via RRF when enabled. factKnn/lexicalFactKnn
  // defaults are the safety contract: clinical facts and invalid_at-passed facts never
  // enter the gate's candidate pool. Skill-router layer excluded from the memory pool.
  // Synthesis P1: the active profile's scope ceiling filters at the source (store) level.
  const out = hybridSearch(qv, q, k, { exclude: ["skill"], factBoost: FACT_BOOST, lexical: lexicalRrf(), rrfK: rrfK(), ceiling })
    .map(h => ({ file: h.file, score: h.score, text: h.text, layer: h.layer, meta: h.meta ?? null }));
  addT(t, "pool", Date.now() - t0);
  return out;
}

// Intent regexes are shared with lkhs-web.ts via config.ts.
const TRIVIAL = TRIVIAL_RE;
const RECALL = RECALL_RE;
const META = META_RE;
const IDENTITY = IDENTITY_RE;

// Entity vocabulary from the graph: lets topical prompts (no recall phrasing) still
// trigger when they name something actually in the brain. Reloaded lazily whenever
// graph/graph.json changes on disk (mtime check per gate call), so a graph rebuild
// is picked up without restarting the daemon.
let ENTITIES: string[] = [];
let entitiesMtime = -1;
function loadEntities(): void {
  try {
    const g = path.join(__dirname, "..", "..", "graph", "graph.json");
    if (!fs.existsSync(g)) { ENTITIES = []; entitiesMtime = -1; return; }
    const mtime = fs.statSync(g).mtimeMs;
    if (mtime === entitiesMtime) return; // unchanged since last load
    const data = JSON.parse(fs.readFileSync(g, "utf-8"));
    // Canonicalize entity labels to the same key space the prompt is matched in,
    // so separator-style variants all resolve to one gate target.
    ENTITIES = [...new Set((data.nodes || []).map((n: any) => canonKey(String(n.label || ""))).filter((s: string) => s.length >= 5))] as string[];
    entitiesMtime = mtime;
  } catch { ENTITIES = []; entitiesMtime = -1; }
}

function gateHeuristic(prompt: string): string | null {
  const p = prompt.trim();
  if (p.length < 12) return "too short";
  if (TRIVIAL.test(p)) return "trivial";
  if (/BEGIN_SESSION_LOG|BEGIN_PROJECT_DIGEST|archivist instructions|LKHS ambient compile/.test(p)) return "automation";
  return null;
}
function intentSignal(prompt: string): string | null {
  if (RECALL.test(prompt.toLowerCase())) return "recall-phrasing";
  // Match entities in canon space so "Llama-3.1-8B" hits the "llama 3.1 8b" node.
  const pk = canonKey(prompt);
  for (const e of ENTITIES) if (pk.includes(e)) return `names "${e}"`;
  return null;
}

// th = hash of the ORIGINAL chunk text (pre-truncation): the stable per-chunk key
// that chunk_stats and the hindsight loop use to credit injections back to chunks.
const snippet = (h: { file: string; score: number; layer: string; text: string }) =>
  ({ file: h.file, score: Number(h.score.toFixed(3)), layer: h.layer, th: sha256(h.text).slice(0, 16), text: h.text.replace(/\s+/g, " ").slice(0, 320) });

const META_FLOOR = metaFloor();
const IDENTITY_FLOOR = identityFloor(); // lower: identity prompts are short/vague but persona passages answer them

/** P5: shared keep-list shaping for the cosine routes — text-dedup + MAX_ITEMS cap. */
function dedupCap<T extends { text: string }>(hits: T[]): T[] {
  const seen = new Set<string>();
  return hits.filter(h => { const k = h.text.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 200); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, Math.min(TOPK, MAX_ITEMS));
}

/** Overview route: cosine over the synthesized layers (themes + cards). Returns
 *  null if nothing clears the floor, so the caller falls through to the normal gate. */
async function metaGate(prompt: string, ceiling?: number): Promise<any | null> {
  const qv = await embedQuery(prompt);
  if (qv.length === 0) return null;
  const hits = knn(qv, 8, { layers: ["persona", "theme", "card"], ceiling }).filter(h => h.score >= META_FLOOR);
  if (hits.length === 0) return null;
  const keep = dedupCap(hits).map(snippet);
  return { inject: true, query: prompt, hits: keep, reason: "meta-overview", signal: "meta" };
}

/** Identity route: cosine over the persona layer only. Surfaces the deep user model
 *  for "who am I / my background / how I think" style prompts. Clinical tier excluded. */
async function identityGate(prompt: string, ceiling?: number): Promise<any | null> {
  const qv = await embedQuery(prompt);
  if (qv.length === 0) return null;
  const hits = knn(qv, 8, { layers: ["persona"], ceiling }).filter(h => h.score >= IDENTITY_FLOOR);
  if (hits.length === 0) return null;
  const keep = dedupCap(hits).map(snippet);
  return { inject: true, query: prompt, hits: keep, reason: "identity", signal: "identity" };
}

// ---- semantic skill router -------------------------------------------------
// The skill index is re-run in-process when any SKILL.md is newer than the last
// run (and once on daemon start). Cheap: hash-skip means unchanged skills do no work.
let lastSkillIndex = -1;
async function refreshSkillIndexIfStale(): Promise<void> {
  const m = latestSkillMtime();
  if (m > lastSkillIndex) { await indexSkills(); lastSkillIndex = Math.max(m, lastSkillIndex); }
}

const skillEntry = (file: string, text: string, score: number) => {
  const name = file.replace(/\\/g, "/").split("/").pop() || file;
  let description = text;
  const pfx = name + ". ";
  if (description.startsWith(pfx)) description = description.slice(pfx.length);
  return { name, description, score: Number(score.toFixed(3)) };
};

/** Match the prompt against the `skill` layer only. At most SKILL_MAX suggestions
 *  above the floor. Independent of the memory gate; returns [] on no match. */
async function matchSkills(prompt: string): Promise<Array<{ name: string; description: string; score: number }>> {
  await refreshSkillIndexIfStale();
  const qv = await embedQuery(prompt);
  if (qv.length === 0) return [];
  // layerKnn (exhaustive over the tiny skill layer), not knn's post-LIMIT filter,
  // which cannot see a few-row layer inside a store of tens of thousands of chunks.
  const pool = layerKnn(qv, "skill", SKILL_POOL);
  if (pool.length === 0) return [];
  if (ENABLE_RERANK) {
    try {
      const ranked = await rerank(prompt, pool, h => h.text.slice(0, RERANK_MAXCHARS));
      return ranked.filter(r => r.score >= SKILL_FLOOR).slice(0, SKILL_MAX)
        .map(r => skillEntry(r.item.file, r.item.text, r.score));
    } catch (e: any) { log(`skill rerank failed, cosine fallback: ${e.message}`); }
  }
  return pool.filter(h => h.score >= SKILL_COSINE_FLOOR).slice(0, SKILL_MAX)
    .map(h => skillEntry(h.file, h.text, h.score));
}

/** Public gate: the existing memory decision (untouched), plus an additive skill
 *  suggestion. The skill path is fully wrapped so any error leaves the memory gate
 *  response unchanged. */
async function gate(prompt: string, cwd?: string, profileName?: string): Promise<any> {
  const personal = isPersonalCwd(cwd);
  // Synthesis P1: resolve the active profile (request body.profile > env LKHS_PROFILE >
  // cwd pin > `full`). The request override exists for the leak harness and future
  // per-session stamping; an unknown name falls through to normal resolution.
  // `full` (ceiling private) = today's behavior exactly, so with no config this is inert.
  const byName = profileName ? scopeProfilesByName(profileName) : null;
  const profile = byName || resolveProfile(cwd);
  const ceiling = scopeRank(profile.ceiling);
  const t: StageT = {};
  const result = await gateMemory(prompt, personal, ceiling, t);
  result.profile = profile.name;
  if (Object.keys(t).length) result._t = t;
  try {
    if (!gateHeuristic(prompt)) {                 // skip skill match for trivial/short/automation prompts
      const skills = await matchSkills(prompt);
      if (skills.length) result.skills = skills;
    }
  } catch (e: any) { log(`skill route failed (memory gate unaffected): ${e.message}`); }
  // P2 prospective memory: fire stored intentions whose condition just became true.
  // Additive and fully wrapped; each fires exactly once (markFired before returning).
  try {
    const fired = matchIntentions(prompt, cwd, Date.now(), { noDateTriggers: personal });
    if (fired.length) {
      result.intentions = fired.slice(0, 3).map(i => ({ note: i.note, set: i.created.slice(0, 10), trigger: `${i.when.type}:${i.when.value}` }));
      markFired(fired.slice(0, 3).map(i => i.id));
      log(`gate:intentions fired ${fired.slice(0, 3).map(i => i.id).join(",")}`);
    }
  } catch (e: any) { log(`prospective failed (gate unaffected): ${e.message}`); }
  return result;
}

async function gateMemory(prompt: string, personal = false, ceiling?: number, t?: StageT): Promise<any> {
  loadEntities(); // mtime-guarded no-op unless graph.json changed (keeps vocab fresh)
  // Identity / self queries route to the persona layer first. P5: checked BEFORE the
  // length heuristic — "who am I" is 8 chars and was bounced as "too short" while being
  // exactly the prompt the persona layer exists for. Safe: identityFloor still gates.
  if (IDENTITY.test(prompt) && !TRIVIAL.test(prompt.trim())) { const id = await identityGate(prompt, ceiling); if (id) return id; }

  const skip = gateHeuristic(prompt);
  if (skip) return { inject: false, reason: skip };

  // Aggregative "overview" queries route to the synthesized layers (the reranker
  // cannot score them). Falls through to the normal path if nothing clears the floor.
  if (META.test(prompt)) { const m = await metaGate(prompt, ceiling); if (m) return m; }

  // Bi-encoder pulls a broad candidate pool (cheap, high recall). The cross-encoder
  // then judges true relevance. Pool is wider when reranking, just TOPK otherwise.
  const pool = await query(prompt, ENABLE_RERANK ? RERANK_POOL : TOPK, ceiling, t);
  if (pool.length === 0) return { inject: false, reason: "no-candidates" };

  if (ENABLE_RERANK) {
    try { return await rerankGate(prompt, pool, false, personal, ceiling, t); }
    catch (e: any) { log(`rerank failed, falling back to cosine+intent: ${e.message}`); }
  }
  return cosineIntentGate(prompt, pool);
}

/**
 * Hybrid gate: the reranker decides confident cases (high -> inject, low -> skip);
 * the ambiguous middle falls back to an intent signal. This separates "needs my
 * memory" from "shares vocabulary" far better than any single threshold, and the
 * injected hits are in true relevance order.
 */
/** P6 graph second-hop (GraphSearch local step, HippoRAG-lite): entities named in the
 *  prompt seed a one-hop neighbor expansion over graph.json; neighbor labels widen a
 *  second bi-encoder pull whose candidates merge into the pool for ONE re-gate. No
 *  LLM in the loop; runs only when the first pass lands mid-band. */
let _graph: any = null, _graphMtime = -1;
function loadGraphCached(): any | null {
  try {
    const g = path.join(__dirname, "..", "..", "graph", "graph.json");
    const mtime = fs.statSync(g).mtimeMs;
    if (mtime !== _graphMtime) { _graph = JSON.parse(fs.readFileSync(g, "utf-8")); _graphMtime = mtime; }
    return _graph;
  } catch { return null; }
}

function graphNeighborTerms(prompt: string, maxSeeds = 2, maxNbrs = 6): string[] {
  const g = loadGraphCached();
  if (!g?.nodes?.length) return [];
  const pk = canonKey(prompt);
  const seeds = g.nodes.filter((n: any) => { const k = canonKey(String(n.label || "")); return k.length >= 5 && pk.includes(k); }).slice(0, maxSeeds);
  if (!seeds.length) return [];
  const label = new Map(g.nodes.map((n: any) => [n.id, n.label]));
  const terms = new Set<string>();
  for (const s of seeds) {
    (g.edges || [])
      .filter((e: any) => e.source === s.id || e.target === s.id)
      .sort((a: any, b: any) => (b.weight || 0) - (a.weight || 0))
      .slice(0, maxNbrs)
      .forEach((e: any) => { const o = e.source === s.id ? e.target : e.source; const l = label.get(o); if (l) terms.add(String(l)); });
  }
  return [...terms].slice(0, 8);
}

async function rerankGate(prompt: string, pool: Hit[], hopped = false, personal = false, ceiling?: number, t?: StageT): Promise<any> {
  const tR = Date.now();
  const ranked = await rerank(prompt, pool, h => h.text.slice(0, RERANK_MAXCHARS));
  addT(t, "rr", Date.now() - tR);
  // Persona layer is the deep user model: weight it heavier so identity/biography/
  // psychology context clears the inject gate even when phrased obliquely. The boost
  // is additive on the cross-encoder score, then we re-sort so order stays truthful.
  // P5: the boost only applies when the RAW score clears BOOST_FLOOR — a persona fact
  // the cross-encoder scored ~0.000 must not ride the boost into the mid band and get
  // injected on a generic prompt (measured: "write a python debounce" pulled 4 such facts).
  for (const r of ranked) if ((r.item.layer === "persona" || r.item.layer === "fact") && r.score >= BOOST_FLOOR) r.score += PERSONA_BOOST; // facts are the persona's atomic layer
  // P1 recency at the rerank stage: knn's cosine-stage decay is discarded once the
  // cross-encoder re-orders, so dated session chunks decay here too (short half-life;
  // floored inside decayBlend, never zeroing). Query-gated OFF for recall/identity/meta
  // prompts: blanket recency buries the past exactly when the user is asking for it.
  if (!RECALL.test(prompt) && !IDENTITY.test(prompt) && !META.test(prompt)) {
    const now = Date.now();
    for (const r of ranked) {
      if (r.item.layer !== "session" || r.score <= 0) continue;
      const d = metaDate(r.item.meta);
      if (d) r.score *= decayBlend(d, now, SESSION_HALFLIFE);
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  const top = ranked[0]!.score;
  // P0 instrumentation: the decision log records the ranked pool head regardless of
  // outcome, so skipped-but-close candidates are visible to the hindsight loop later.
  const topk = ranked.slice(0, 8).map(r => ({ f: r.item.file, l: r.item.layer, s: Number(r.score.toFixed(4)) }));
  const band = top >= RERANK_HIGH ? "high" : top < RERANK_LOW ? "low" : "mid";
  let inject: boolean, reason: string;
  if (top >= RERANK_HIGH) { inject = true; reason = "rerank-high"; }
  else if (top < RERANK_LOW) { inject = false; reason = "rerank-low"; }
  else {
    const sig = intentSignal(prompt);
    // P5: an entity-name intent (vs explicit recall phrasing) is a weak signal — a
    // generic vocab token ("python", "chain") flips it. It must also clear a top-score floor.
    inject = !!sig && (sig === "recall-phrasing" || top >= ENTITY_MID_FLOOR);
    reason = !sig ? "rerank-mid-no-intent" : inject ? `rerank-mid+${sig}` : `rerank-mid-entity-below-floor(${sig})`;
  }

  if (!inject) {
    // P6 graph second-hop: an uncertain first pass earns ONE neighbor-expanded retry.
    // The expanded query only widens the candidate pool; the cross-encoder still
    // judges against the ORIGINAL prompt, so scores stay on the calibrated scale.
    if (!hopped && ENABLE_GRAPH_HOP && band === "mid") {
      const terms = graphNeighborTerms(prompt);
      if (terms.length) {
        try {
          const extra = await query(`${prompt}\nRelated: ${terms.join(", ")}`, RERANK_POOL, ceiling, t);
          const have = new Set(pool.map(h => h.file));
          const merged = [...pool, ...extra.filter(h => !have.has(h.file))];
          if (merged.length > pool.length) {
            const second = await rerankGate(prompt, merged, true, personal, ceiling, t);
            if (second.inject) { second.reason = `graph-hop+${second.reason}`; second.signal = second.reason; return second; }
          }
        } catch (e: any) { log(`graph-hop failed (mid-band skip stands): ${e.message}`); }
      }
    }
    const out: any = { inject: false, reason, band, topk, topScore: Number(top.toFixed(3)) };
    // P1 steering nudge (When2Tool port): the gate's uncertainty is an externally
    // computable probe. Instead of a silent mid-band skip, tell the model that
    // memory likely exists so it can choose to search actively. No content injected.
    if (ENABLE_NUDGE && band === "mid" && top >= NUDGE_FLOOR)
      out.nudge = `The user's personal memory store scored this prompt in the uncertain band (top relevance ${top.toFixed(2)}): related prior material may exist. If past context would change your answer, call mcp__lkhs-memory__search_memory (or explore) with a focused query before answering.`;
    return out;
  }
  // P5: per-item floor (ITEM_FLOOR, was RERANK_LOW) — two strong hits beat four weak
  // ones — plus dedup and the MAX_ITEMS cap. Dedup is two-stage: exact 200-char prefix
  // (contextual chunking can index near-identical passages twice), then P1 word-set
  // Jaccard >= DEDUP_J (personal stores are near-duplicate-heavy: the same event
  // recapped across sessions should cost one slot, not three; dropped slots backfill
  // with the next distinct candidate).
  // P10 etiquette: in a WORK session with no recall/identity phrasing, personal-
  // conversation journals stay out of topical injections. They remain one explicit
  // "what did we talk about" away; they just don't ambush a research session.
  const etiquetteGuard = !personal && !RECALL.test(prompt) && !IDENTITY.test(prompt);
  const seen = new Set<string>();
  const keptWords: Array<Set<string>> = [];
  const wordsOf = (t: string) => new Set(t.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 3));
  const nearDup = (w: Set<string>) => keptWords.some(kw => {
    let inter = 0; for (const x of w) if (kw.has(x)) inter++;
    return inter / (kw.size + w.size - inter || 1) >= DEDUP_J;
  });
  let keep = ranked.filter(r => r.score >= ITEM_FLOOR)
    .filter(r => !(etiquetteGuard && PERSONAL_JOURNALS.has(r.item.file)))
    .filter(r => {
      const t = r.item.text.replace(/\s+/g, " ").trim().toLowerCase();
      if (seen.has(t.slice(0, 200))) return false;
      const w = wordsOf(t);
      if (nearDup(w)) return false;
      seen.add(t.slice(0, 200)); keptWords.push(w);
      return true;
    })
    .slice(0, Math.min(TOPK, MAX_ITEMS))
    .map(r => snippet({ file: r.item.file, score: r.score, layer: r.item.layer, text: r.item.text }));
  if (keep.length === 0) keep = [snippet({ file: ranked[0]!.item.file, score: top, layer: ranked[0]!.item.layer, text: ranked[0]!.item.text })];
  return { inject: true, query: prompt, hits: keep, reason, signal: reason, band, topk };
}

/** Fallback (reranker disabled or failed): the original cosine + intent gate. */
function cosineIntentGate(prompt: string, pool: Hit[]): any {
  const sig = intentSignal(prompt);
  const topk = pool.slice(0, 8).map(h => ({ f: h.file, l: h.layer, s: Number(h.score.toFixed(4)) }));
  if (!sig) return { inject: false, reason: "no-personal-intent", topk };
  const top = pool[0]!.score;
  if (top < THRESHOLD) return { inject: false, reason: "below-threshold", topk, topScore: Number(top.toFixed(3)) };
  const keep = pool.filter(h => h.score >= Math.max(THRESHOLD, top - 0.08)).slice(0, TOPK).map(snippet);
  return { inject: true, query: prompt, hits: keep, reason: "relevant", signal: sig, topk };
}

// ---- logging + http -------------------------------------------------------
const LOG = path.join(__dirname, "..", "logs", "ambient.log");
function log(m: string) { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `[${new Date().toISOString()}] daemon:${m}\n`); } catch { /* */ } }

// P0 decision log: one JSONL row per /gate call, inject or not. This is the raw
// material for gate recalibration (propensities need the decision-time scores) and
// the hindsight loop (which injections led to what). Same 60-char prompt-slice
// exposure as ambient.log; ph is the stable prompt key for joining to transcripts.
const DECISIONS = path.join(__dirname, "..", "logs", "decisions.jsonl");
function logDecision(prompt: string, result: any, ms: number): void {
  try {
    const rec = {
      ts: new Date().toISOString(),
      ph: sha256(prompt).slice(0, 12),
      p: prompt.slice(0, 60).replace(/\s+/g, " "),
      inject: !!result.inject,
      profile: result.profile || "full",
      t: result._t || null,   // per-stage ms (emb/pool/rr) for the latency investigation
      band: result.band || null,
      reason: result.reason || result.signal || "",
      n: Array.isArray(result.hits) ? result.hits.length : 0,
      top: result.topk || (Array.isArray(result.hits) ? result.hits.map((h: any) => ({ f: h.file, l: h.layer, s: h.score })) : []),
      ms
    };
    fs.appendFileSync(DECISIONS, JSON.stringify(rec) + "\n");
  } catch { /* never block the gate */ }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise(res => { let b = ""; req.on("data", c => b += c); req.on("end", () => res(b)); });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const u = new URL(req.url || "/", `http://localhost:${PORT}`);
    if (u.pathname === "/health") {
      const s = stats();
      const sorted = [...RECENT_MS].sort((a, b) => a - b);
      return res.end(JSON.stringify({
        ok: true, files: s.files, chunks: s.chunks, entities: ENTITIES.length, rerank: ENABLE_RERANK, port: PORT, threshold: THRESHOLD,
        uptime_h: Number(((Date.now() - STARTED) / 3600_000).toFixed(2)),
        gate_p50_recent: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null, gate_n_recent: sorted.length,
      }));
    }
    if (u.pathname === "/query") {
      const hits = await query(u.searchParams.get("q") || "", Number(u.searchParams.get("k") || TOPK));
      return res.end(JSON.stringify({ hits }));
    }
    if (u.pathname === "/sessions") {
      return res.end(JSON.stringify({ sessions: activeSessions(u.searchParams.get("exclude") || undefined) }));
    }
    if (u.pathname === "/gate" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      try { heartbeat(body.session_id ? String(body.session_id) : undefined, body.cwd ? String(body.cwd) : undefined, String(body.prompt || "")); } catch { /* */ }
      const t0 = Date.now();
      const result = await gate(String(body.prompt || ""), body.cwd ? String(body.cwd) : undefined, body.profile ? String(body.profile) : undefined);
      const elapsed = Date.now() - t0;
      RECENT_MS.push(elapsed); if (RECENT_MS.length > 200) RECENT_MS.shift();
      logDecision(String(body.prompt || ""), result, elapsed);
      if (result.inject && Array.isArray(result.hits)) {
        try { recordInjections(result.hits.filter((h: any) => h.th).map((h: any) => ({ file: h.file, th: h.th }))); }
        catch (e: any) { log(`chunk-stats write failed (gate unaffected): ${e.message}`); }
      }
      if (result.inject) log(`gate:inject ${result.hits.length} src top=${result.hits[0].score} (${result.signal}) :: ${String(body.prompt).slice(0, 60).replace(/\n/g, " ")}`);
      if (result.skills?.length) log(`gate:skill ${result.skills.map((s: any) => `${s.name}@${s.score}`).join(",")} :: ${String(body.prompt).slice(0, 60).replace(/\n/g, " ")}`);
      return res.end(JSON.stringify(result));
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: "not found" }));
  } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
});

async function main() {
  getDb();           // open SQLite + load vec extension + ensure schema
  loadEntities();
  try { await indexSkills(); lastSkillIndex = latestSkillMtime(); }  // seed the skill-router layer on boot
  catch (e: any) { log(`skill index on boot failed (router disabled until a SKILL.md changes): ${e.message}`); }
  await getModel();  // warm the bi-encoder
  if (ENABLE_RERANK) { try { await warmReranker(); } catch (e: any) { log(`rerank warm failed (gate will fall back to cosine+intent): ${e.message}`); } }
  const s = stats();
  server.listen(PORT, "127.0.0.1", () => {
    log(`listening on 127.0.0.1:${PORT} (${s.files} files, ${s.chunks} chunks, ${ENTITIES.length} entities)`);
    console.log(`LKHS daemon on http://127.0.0.1:${PORT} | ${s.files} files, ${s.chunks} chunks, threshold ${THRESHOLD}`);
  });
  server.on("error", (e: any) => { log(`server error: ${e.message}`); if (e.code === "EADDRINUSE") { console.log("daemon already running on this port; exiting."); process.exit(0); } });
}
main();
