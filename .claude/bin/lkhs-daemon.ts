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
import { knn, layerKnn, stats, getDb, hybridSearch, sha256, recordInjections, ensureChunkStats, tuneForServing, enableMemoryIndex, decayBlend, metaDate, filesKnn, lexicalKnn } from "./store";
import { rerank, warm as warmReranker } from "./rerank";
import { indexSkills, latestSkillMtime } from "./skill-index";
import { matchIntentions, markFired } from "./prospective";
import { pprQuery, connectPaths, loadIndex, seedsFor } from "./graph-ppr";
import {
  daemonPort, retrieveThreshold, retrieveTopK, enableRerank, rerankPool,
  rerankMaxChars, rerankHigh, rerankLow, personaBoost, factBoost, metaFloor, identityFloor,
  gateItemFloor, boostFloor, entityMidFloor, injectMaxItems,
  injectMaxBytes, rescueCosFloor, rescueMaxItems, enableRescue, automemoryRescueFloor,
  skillSuggestFloor, skillCosineFloor, lexicalRrf, rrfK,
  methodInjectMaxTokens, methodInjectMax,
  sessionHalfLifeDays, dedupJaccard, enableNudge, nudgeFloor, enableGraphHop, etiquettePersonalProjects,
  enablePpr, pprAlpha, pprBeta, pprMaxFiles, pprMaxTerms, pprMaxCandidates, pprGraphBoost,
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
let WARM = false;   // models + method vectors loaded; the port is bound before this

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
/* Server-side gate deadline. Sits under the hook's client timeout so an overrun is
 * recorded as a decision here instead of vanishing as a connection error there. */
const GATE_TIMEOUT_MS = Number(process.env.LKHS_GATE_TIMEOUT_MS ?? 8000);
/* Hand-written beats derived. Sits above personaBoost deliberately; see the comment
 * at the boost site for why provenance, not recency, is the argument. */
const AUTOMEMORY_BOOST = Number(process.env.LKHS_AUTOMEMORY_BOOST ?? 0.20);
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
// 8 is enough: measured 2026-08-11 over the 24-row skill layer, the bi-encoder is NOT
// the binding stage. On a prompt the router missed ("which test should i use to compare
// severity scores across the three conditions") the correct skill was cosine rank 3 of
// 24 and still lost, because the CROSS-ENCODER scored it 0.143 against a 0.30 floor.
// Widening this to 32 changed nothing except rerank cost. What binds is rerankMaxChars
// (400): the cross-encoder only ever sees the first 400 chars of `name. description`,
// so a skill's domain nouns have to live inside that window or they are invisible.
const SKILL_POOL = 8;                           // bi-encoder candidates to consider
const SKILL_MAX = 2;                            // at most this many suggestions

let _model: Promise<FlagEmbedding> | null = null;
const getModel = () => (_model ??= FlagEmbedding.init({ model: EmbeddingModel.BGESmallENV15 }));

// Tiny prompt->vector memo. A single /gate call could embed the SAME prompt up to
// three times (identity route, meta route, then the main pool, plus the graph-hop
// retry and now the PPR channel). The embed is the second-most expensive stage after
// the cross-encoder, and the prompt does not change within a call.
const EMB_CACHE = new Map<string, number[]>();
const EMB_CACHE_MAX = 16;
async function embedQuery(q: string): Promise<number[]> {
  const key = q.replace(/\s+/g, " ").trim();
  const hit = EMB_CACHE.get(key);
  if (hit) return hit;
  const model = await getModel();
  let out: number[] = [];
  for await (const batch of model.embed([`query: ${key}`]))
    for (const v of batch) { out = Array.from(v as ArrayLike<number>); break; }
  if (out.length) {
    EMB_CACHE.set(key, out);
    if (EMB_CACHE.size > EMB_CACHE_MAX) EMB_CACHE.delete(EMB_CACHE.keys().next().value as string);
  }
  return out;
}

interface Hit { file: string; score: number; text: string; layer: string; meta?: string | null; via?: string; graph?: number }
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
const snippet = (h: { file: string; score: number; layer: string; text: string; via?: string }) =>
  ({ file: h.file, score: Number(h.score.toFixed(3)), layer: h.layer, th: sha256(h.text).slice(0, 16),
     ...(h.via ? { via: h.via } : {}), text: h.text.replace(/\s+/g, " ").slice(0, 320) });

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

/**
 * TASK-ONSET route: deliver METHOD principles when a kind of work begins.
 *
 * The action-trigger hook fires on a pending tool call, which is the right event for
 * tool hygiene and the wrong one for method. "Verify every number against the raw
 * output file before calling a revision reviewer-ready" does not apply to an Edit
 * call; it applies to the DECISION to start revising. Measured consequence of getting
 * this wrong: 0 of 62 action-trigger rules were tier 2, and 7 of 11 method principles
 * reached nothing at all.
 *
 * So tier 2 gets its own event. When a prompt reads as the start of a piece of work
 * rather than a question about the past, match it against the method principles by
 * meaning and surface the ones that govern this kind of task.
 *
 * Deliberately NOT routed through the normal gate: the cross-encoder judges "I'm
 * about to revise the paper" as not-a-memory-question and withholds, which is correct
 * for memory and fatal for method. Same reason tier 1 needed a hook rather than
 * better retrieval. Principles are few (tens, not thousands), so they are embedded
 * once and matched directly.
 */
const TASK_ONSET_RE = /\b(let'?s|i'?m (going to|about to|gonna)|i (want|need) to|help me|next (i|we)|time to|start(ing)? (on|the|a)?|begin|set ?up|build|write|draft|revis(e|ing)|audit|analyz|analys|refactor|implement|design|run the|work on|clean up|go through|put together)\b/i;

/* A prompt that OPENS with an interrogative is asking, not starting work.
 *
 * The onset regex above matches bare verbs, so it fired on "what movies did I want to
 * watch" (via "want to") and "how am I supposed to draft emails" (via "draft") and
 * answered both with paper-audit methodology. It also fired on "write a short
 * paragraph about the weather in sydney" and "help me write a regex", where the verb
 * is the whole signal and there is no work in the vault to have learned from.
 *
 * Two guards, both necessary and neither sufficient. A question is never a task onset,
 * however many onset verbs it contains. And a genuine onset carries enough of the task
 * to describe it: measured over the probe set, every false fire was under 12 words and
 * every true onset was longer. */
const QUESTION_LEAD = /^\s*(what|where|when|who|which|whose|how|why|did|do|does|is|are|was|were|can|could|should|would|will|have|has|had|am|remind|tell)\b/i;
const ONSET_MIN_WORDS = 12;

function isTaskOnset(prompt: string): boolean {
  const p = prompt.trim();
  if (!TASK_ONSET_RE.test(p) || TRIVIAL.test(p)) return false;
  if (QUESTION_LEAD.test(p)) return false;
  return p.split(/\s+/).length >= ONSET_MIN_WORDS;
}

/* Content words for the lexical half of the rescue test. Deliberately a fixed stop
 * list rather than IDF over the corpus: the discriminating words in these prompts are
 * proper nouns and domain terms that are rare in the corpus anyway, and an IDF table
 * is one more thing to keep in sync with the store. */
const RESCUE_STOP = new Set(("a an the and or but if then than that this these those of in on to for with from by as at is are was were be been being am do does did done have has had can could should would will shall may might must i me my mine you your it its we our they them their what where when who whom which whose how why not no yes about into over under again just now right actually really some any all more most other else thing things stuff get got make made take took go going went know knew think thought want wanted need needed like also very much many").split(/\s+/));

function contentWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,}/g)?.filter(w => !RESCUE_STOP.has(w)) ?? []
  );
}

function lexOverlap(words: Set<string>, text: string): number {
  const body = text.toLowerCase();
  let n = 0;
  for (const w of words) if (body.includes(w)) n++;
  return n;
}

interface MethodLesson { id: string; domain: string; action: string; statement: string; falsifier: string; scope: string; trigger: string; vec?: number[] }
let _method: MethodLesson[] = [];
let _methodMtime = -1;

function loadMethodLessons(): MethodLesson[] {
  try {
    const f = path.join(__dirname, "..", "memory", "lessons.jsonl");
    const mtime = fs.statSync(f).mtimeMs;
    if (mtime === _methodMtime) return _method;
    const byId = new Map<string, any>();
    for (const line of fs.readFileSync(f, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try { const l = JSON.parse(line); byId.set(l.id, l); } catch { /* */ }
    }
    _method = [...byId.values()]
      .filter(l => !l.invalid_at && l.status === "active" && (l.tier ?? 1) >= 2)
      .map(l => ({ id: l.id, domain: l.domain, action: l.action, statement: l.statement, falsifier: l.falsifier, scope: l.scope || "professional", trigger: String(l.trigger?.match || l.domain) }));
    _methodMtime = mtime;
    return _method;
  } catch { return []; }
}

// RECALL floor, not a precision floor.
//
// This was 0.52, raised from 0.42 to stop a multi-agent-audit principle outranking the
// paper-revision ones on "lets get a paper draft ready to submit". That tuning was
// solving the wrong problem. Ranking mattered only because delivery was capped at 2, and
// the cap existed because the ledger was expected to be large. It is not: the full active
// tier-2 set is 14 principles and renders to roughly 3,300 tokens.
//
// So the cap goes, and with it the need for a scorer that can rank 14 items correctly -
// a problem a cross-encoder and an LLM judge have both already failed (d-013), because
// whether a principle GOVERNS a situation is not a relation either was trained on. The
// session model is already loaded and already reading the prompt; it makes the
// applicability call for free, and it is the only judge here that has ever worked.
// Cosine's remaining job is recall: keep out what is plainly unrelated, admit the rest,
// and let the budget decide how much fits.
const METHOD_FLOOR = 0.35;

async function taskOnsetGate(prompt: string, ceiling?: number): Promise<any | null> {
  const all = loadMethodLessons().filter(l => ceiling === undefined || scopeRank(l.scope) >= ceiling);
  if (!all.length) return null;
  const qv = await embedQuery(prompt);
  if (!qv.length) return null;
  // Embed the principles once per ledger change; there are tens of them.
  // Embed the SITUATION, not the remedy. Matching on statement+action embeds what to
  // DO, so a principle about enumerating claim values across document layers does not
  // resemble "ready to submit" even though that is exactly when it applies. The
  // trigger and domain describe the moment; the statement describes what is true at
  // that moment. Both are situational; the action is not. Same lesson the tier-1
  // trigger work taught - a token describing the fix does not predict the moment.
  for (const l of all) if (!l.vec) l.vec = await embedQuery(`${l.trigger}. ${l.domain}. ${l.statement}`);
  const nrm = (v: number[]) => { let n = 0; for (const x of v) n += x * x; return Math.sqrt(n) || 1; };
  const qn = nrm(qv);
  const scored = all.map(l => {
    let d = 0; for (let i = 0; i < qv.length; i++) d += qv[i]! * l.vec![i]!;
    return { l, s: d / (qn * nrm(l.vec!)) };
  }).filter(x => x.s >= METHOD_FLOOR).sort((a, b) => b.s - a.s);
  if (!scored.length) return null;

  // NOT reranked. Tried and reverted 2026-08-05: the cross-encoder scored EVERY method
  // principle below 0.10 against task-onset prompts, silencing the route completely.
  // Second confirmation of the same thing - it is why this route bypasses the main gate
  // at all. The reranker judges "does this passage ANSWER this query"; whether a
  // principle GOVERNS a situation is a different relation it was never trained on.
  //
  // Truncate by TOKEN BUDGET, not by rank. Cosine still orders the list, so if the
  // budget binds the best-matching principles are the ones that survive - but while the
  // whole set fits, nothing is dropped on the strength of a signal that cannot reliably
  // separate 0.61 from 0.65. Order still carries information for the reader even when it
  // is not deciding inclusion, which is why `fit` stays printed.
  const maxItems = methodInjectMax();
  const budget = methodInjectMaxTokens();
  const render = ({ l, s }: { l: any; s: number }) => [
    `- ${l.action}`,
    `    why: ${l.statement}`,
    `    stale if: ${l.falsifier}`,
    `    [${l.domain}, fit ${s.toFixed(2)}]`,
  ].join("\n");
  const finalTop: typeof scored = [];
  let tokens = 0;
  for (const x of scored) {
    if (finalTop.length >= maxItems) break;
    const cost = Math.ceil(render(x).length / 4);   // ~4 chars/token, good enough to budget
    if (tokens + cost > budget && finalTop.length) break;
    finalTop.push(x); tokens += cost;
  }
  // Truncation is the moment this route stops being "inject everything" and goes back to
  // "rank, then drop the tail" — using a ranking measured at 46.2% top-1 with negative
  // separation. That transition must never be silent, so it is logged with the gate
  // decision. If this starts appearing, raise methodInjectMaxTokens or prune the ledger;
  // do not let it quietly discard principles on a signal that cannot order them.
  const truncated = finalTop.length < scored.length;

  const body = finalTop.map(render).join("\n");
  return {
    inject: true, query: prompt, reason: "task-onset-method", signal: "method",
    methodIds: finalTop.map(x => x.l.id),
    methodTokens: tokens,
    methodTruncated: truncated,
    ...(truncated ? { methodDropped: scored.length - finalTop.length } : {}),
    hits: [{
      file: "lessons/method", score: Number(finalTop[0]!.s.toFixed(3)), layer: "method",
      text: [
        "Method principles synthesized from how this kind of work has actually gone before.",
        "These are patterns across many past sessions, not rules. Weigh them against what",
        "you are actually doing; the 'stale if' line is the observation that would mean a",
        "principle no longer holds, so check for it rather than assuming either way.",
        body,
        // Loud to the gate decision is not loud to the reader: a consumer handed a
        // silently-subset list treats it as the whole set. Say so in the payload too.
        ...(truncated
          ? [`(${scored.length - finalTop.length} further principle(s) omitted: the ${budget}-token budget bound. Raise methodInjectMaxTokens or prune the ledger.)`]
          : []),
      ].join("\n"),
    }],
  };
}

/**
 * Connector route: "how does X connect to Y", "what links A and B".
 *
 * Structurally unanswerable by retrieval — the answer is a route through the graph,
 * and no single passage contains it. Previously these prompts fell into the meta
 * route and came back with four topically-adjacent cards that never stated the
 * relationship. Now the gate computes the actual routes and the shared neighbours,
 * then backs them with the passages behind the endpoints.
 *
 * Requires TWO distinct entities from the prompt, so it cannot hijack ordinary
 * "related work" phrasing that names only one thing.
 */
const CONNECT_RE = /\b(connect(s|ed|ion|ions)?|relate[sd]?|relationship|link(s|ed)?|tie(s|d)? (in)?to|overlap|(in|have in) common|bridge|thread between|do .* share)\b/i;
const CONNECT_STRIP = new RegExp(CONNECT_RE.source, "gi");

async function connectorGate(prompt: string, ceiling?: number): Promise<any | null> {
  const idx = loadIndex();
  if (!idx) return null;
  // Seed on the OPERANDS, not the question. The vault has nodes called
  // "Relationship" and "Research", so "what is the relationship between X and Y"
  // otherwise seeds on the word "relationship" and answers about the wrong thing.
  const seeds = seedsFor(prompt.replace(CONNECT_STRIP, " "), idx, 4);
  if (seeds.length < 2) return null;
  const [a, b] = [idx.label[seeds[0]!]!, idx.label[seeds[1]!]!];
  const r = connectPaths(a, b, 3, 4);
  if (!r || (!r.paths.length && !r.shared.length)) return null;

  const lines = [`Knowledge-graph connection between ${r.from} and ${r.to}:`];
  if (r.viaHubs) lines.push(`(no specific route: these two only meet through the graph's biggest hubs, i.e. they are barely connected)`);
  for (const p of r.paths) lines.push(`  route: ${p.path.map(h => h.label).join(" -> ")}`);
  if (r.shared.length) lines.push(`  both touch: ${r.shared.map(s => s.label).join(", ")}`);
  const routeHit = { file: "graph/connections", score: 1, layer: "graph", text: lines.join("\n") };

  // Back the route with real passages from around both endpoints, so the model gets
  // the evidence and not just the topology.
  const support: any[] = [];
  try {
    const qv = await embedQuery(prompt);
    const walk = pprQuery(prompt, { alpha: pprAlpha(), beta: pprBeta(), maxFiles: 6, maxTerms: 0 });
    if (qv.length && walk?.files.length)
      support.push(...filesKnn(qv, walk.files.map(f => f.file), { ceiling }).slice(0, 3)
        .map(h => snippet({ file: h.file, score: h.score, layer: h.layer, text: h.text, via: "ppr-file" })));
  } catch { /* the topology alone is still a real answer */ }
  return { inject: true, query: prompt, hits: [routeHit, ...support], reason: "graph-connector", signal: "connector",
    ppr: { seeds: [a, b], terms: [], added: support.length } };
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
  if (m <= lastSkillIndex) return;
  // With the daemon's 250ms busy_timeout a concurrent writer can make this throw;
  // the stale index still serves, and the next gate call retries.
  try { await indexSkills(); lastSkillIndex = Math.max(m, lastSkillIndex); }
  catch (e: any) { log(`skill reindex deferred: ${e.message}`); }
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

/**
 * The method tier and the memory tier answer different questions, and the route that
 * carried the method tier used to `return` the moment it matched.
 *
 * That made it a REPLACEMENT for retrieval rather than an addition to it. Measured
 * 2026-09-02: it was 70% of all injections, and on "what movies did I want to watch"
 * it returned method principles while the correct answer sat at bi-encoder rank 1,
 * unreached, because the early return fired before any other route ran.
 *
 * So the two now compose. Memory leads when it has something, method rides along, and
 * method alone stands only when nothing else did. Both are then trimmed to one byte
 * budget, because the hook has one envelope and the routes were each sized as if they
 * owned it.
 */
async function gateMemory(prompt: string, personal = false, ceiling?: number, t?: StageT): Promise<any> {
  let method: any = null;
  if (isTaskOnset(prompt)) {
    try { method = await taskOnsetGate(prompt, ceiling); }
    catch (e: any) { log(`task-onset route failed (memory gate unaffected): ${e.message}`); }
  }

  const base = await gateMemoryInner(prompt, personal, ceiling, t);

  try { await questionRescue(prompt, ceiling, base, t); }
  catch (e: any) { log(`rescue failed (base result stands): ${e.message}`); }

  let out = base;
  if (method) {
    if (base.inject) {
      out = { ...base, hits: [...(base.hits || []), ...method.hits], reason: `${base.reason}+method` };
    } else {
      out = { ...method, memorySkipped: base.reason };
    }
    out.methodIds = method.methodIds;
    out.methodTokens = method.methodTokens;
    if (method.methodTruncated) out.methodDropped = method.methodDropped;
  }
  return capPayload(out);
}

/**
 * Trim the rendered payload to the hook's envelope, dropping whole hits from the tail.
 *
 * A hit is dropped rather than truncated: half a passage reads as a complete one and
 * misleads, and the tail hits are the weakest by construction since every route sorts
 * before it returns. What was dropped goes into the decision row, so a route that
 * routinely overflows is visible rather than quietly losing its tail.
 */
function capPayload(result: any): any {
  const max = injectMaxBytes();
  if (!result?.inject || !Array.isArray(result.hits)) return result;
  const cost = (h: any) => Buffer.byteLength(`- (source: ${h.file}, score ${h.score}) ${h.text}\n`, "utf8");
  let used = 0;
  const kept: any[] = [];
  for (const h of result.hits) {
    const c = cost(h);
    if (used + c > max && kept.length) { continue; }
    kept.push(h); used += c;
  }
  if (kept.length < result.hits.length) {
    result.payloadDropped = result.hits.length - kept.length;
    result.hits = kept;
    log(`gate:payload-capped kept=${kept.length} dropped=${result.payloadDropped} bytes=${used}`);
  }
  result.payloadBytes = used;
  return result;
}

/**
 * Put the bi-encoder's answer back when the cross-encoder threw it away.
 *
 * Additive by construction: it only ever appends hits the result does not already
 * carry, so it cannot displace a route that worked. Runs on questions only, and needs
 * both a cosine floor and a shared content word with the passage, because on this
 * corpus cosine alone rates "what is the capital of France" above four real questions
 * about the user's own life. See rescueCosFloor() in config for the measurement.
 */
async function questionRescue(prompt: string, ceiling: number | undefined, base: any, t?: StageT): Promise<void> {
  if (!enableRescue()) return;
  const p = prompt.trim();
  if (!QUESTION_LEAD.test(p) || TRIVIAL.test(p)) return;

  const words = contentWords(p);
  if (!words.size) return;

  // Pool of 25, not 8. The project layer is 48,072 of 70,734 chunks (an ingested
  // creative-writing corpus and book PDFs), so it fills the head of almost any
  // literary or personal query: "remind me what my writing feedback rules are" put
  // the hand-written rules file at rank 15 behind eleven corpus chunks. A short pool
  // is a bet that the right answer is near the top, and on this store it is not.
  const pool = await query(prompt, 25, ceiling, t);
  const already = new Set<string>((base?.hits || []).map((h: any) => h.file));
  const floor = rescueCosFloor();
  const amFloor = automemoryRescueFloor();

  // Two ways in. The lexical gate is what keeps generic questions from pulling random
  // corpus text, and it stays the rule for every derived layer. An automemory file is
  // not corpus text though: it exists because the user wrote it down, so the layer
  // itself is the evidence the lexical test was standing in for, and requiring a word
  // match on top of it loses correct answers to vocabulary drift ("meds" in the file,
  // "medication" in the question). It gets a higher cosine bar instead.
  //
  // Measured over the probe set, top automemory score: 0.818 / 0.824 / 0.834 on real
  // questions, 0.746 / 0.678 / none on the controls. The floor sits in that gap.
  const picks = pool
    .filter(h => !already.has(h.file))
    .filter(h => h.layer === "automemory"
      ? h.score >= amFloor
      : (h.score >= floor && lexOverlap(words, h.text) >= 1))
    // Pool order is cosine order, and cosine order is dominated by the 48,072-chunk
    // project corpus. On "remind me what my writing feedback rules are" the three
    // rescue slots filled with two journals and a fact before reaching the file that
    // actually holds the rules, at rank 15. Rank the qualifying candidates by how much
    // the layer is worth rather than by a score that already failed to order them.
    .sort((a, b) => (a.layer === "automemory" ? 0 : 1) - (b.layer === "automemory" ? 0 : 1))
    .slice(0, rescueMaxItems());
  if (!picks.length) return;

  const added = picks.map(h => snippet({ file: h.file, score: h.score, layer: h.layer, text: h.text, via: "rescue" }));
  if (base.inject) {
    base.hits = [...(base.hits || []), ...added];
    base.reason = `${base.reason}+rescue`;
  } else {
    base.inject = true;
    base.query = prompt;
    base.hits = added;
    base.reason = `rescue(${base.reason})`;
    base.signal = "rescue";
  }
  log(`gate:rescue ${picks.length} hit(s) for "${p.slice(0, 40)}" cos=${picks[0]!.score.toFixed(3)}`);
}

async function gateMemoryInner(prompt: string, personal = false, ceiling?: number, t?: StageT): Promise<any> {
  loadEntities(); // mtime-guarded no-op unless graph.json changed (keeps vocab fresh)

  // Connector queries go to the graph first. They otherwise get eaten by two other
  // routes: META reads "how does X connect to Y" as an overview and answers with
  // cards that are each about X or Y and never about the relationship, and IDENTITY
  // claims "what do MY bias work and MY voice work have in common" as a self-query
  // and returns biography. The route is self-limiting — connectorGate returns null
  // unless the prompt resolves to TWO distinct graph entities — so a false positive
  // on the regex costs one cheap index lookup and falls through.
  if (CONNECT_RE.test(prompt) && !TRIVIAL.test(prompt.trim())) {
    try { const c = await connectorGate(prompt, ceiling); if (c) return c; }
    catch (e: any) { log(`connector route failed (falling through): ${e.message}`); }
  }

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

  // G1: the graph channel runs alongside, not instead. Two recall systems with
  // different blind spots feed one judged pool: similarity finds what the prompt
  // looks like, the walk finds what it is connected to.
  let ppr: { hits: Hit[]; seeds: string[]; terms: string[] } = { hits: [], seeds: [], terms: [] };
  // The dense pool's best files anchor the walk when the prompt names nothing.
  const anchors = pool.slice(0, 3).map(h => h.file);
  try { ppr = await pprCandidates(prompt, ceiling, t, anchors); }
  catch (e: any) { log(`ppr channel failed (vector pool unaffected): ${e.message}`); }
  const have = new Set(pool.map(h => h.file));
  const added = ppr.hits.filter(h => !have.has(h.file));
  const merged = added.length ? [...pool, ...added] : pool;

  if (merged.length === 0) return { inject: false, reason: "no-candidates" };
  const via = added.length ? { seeds: ppr.seeds, terms: ppr.terms, added: added.length } : null;

  if (ENABLE_RERANK) {
    try {
      const r = await rerankGate(prompt, merged, false, personal, ceiling, t);
      if (via) r.ppr = via;
      return r;
    }
    catch (e: any) { log(`rerank failed, falling back to cosine+intent: ${e.message}`); }
  }
  const r = cosineIntentGate(prompt, merged);
  if (via) r.ppr = via;
  return r;
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

/**
 * G1 graph recall channel (HippoRAG-style). The bi-encoder can only return passages
 * that LOOK like the prompt; this returns passages the prompt is CONNECTED to.
 *
 * prompt -> entities named in it -> personalized-PageRank walk -> file-backed nodes
 * -> their best chunks (filesKnn, scored against the same query vector so the merged
 * pool stays on one scale) + high-lift concept labels -> one FTS5 lexical pull.
 *
 * Everything it returns is a CANDIDATE. The cross-encoder still judges each passage
 * against the original prompt at the calibrated thresholds, so a bad walk costs
 * latency, never a bad injection. Scope ceiling is enforced inside filesKnn and
 * lexicalKnn, so the graph is not a way around the audience ladder.
 */
async function pprCandidates(prompt: string, ceiling?: number, t?: StageT, anchorFiles?: string[]): Promise<{ hits: Hit[]; seeds: string[]; terms: string[] }> {
  const empty = { hits: [] as Hit[], seeds: [] as string[], terms: [] as string[] };
  if (!enablePpr()) return empty;
  const t0 = Date.now();
  const r = pprQuery(prompt, { alpha: pprAlpha(), beta: pprBeta(), maxFiles: pprMaxFiles(), maxTerms: pprMaxTerms(), anchorFiles });
  if (!r || (!r.files.length && !r.terms.length)) { addT(t, "ppr", Date.now() - t0); return empty; }
  const qv = await embedQuery(prompt);   // memoized: the main pool already paid for this
  if (qv.length === 0) { addT(t, "ppr", Date.now() - t0); return empty; }

  const cap = pprMaxCandidates();
  // Carry the walk's own confidence forward. The graph score is independent evidence
  // of relevance; using it only to CHOOSE candidates and then discarding it throws
  // half the signal away. Normalized to [0,1] over this query's own file set so it
  // is a rank signal, not an absolute one.
  const topMass = Math.max(...r.files.map(f => f.mass), 1e-9);
  const massOf = new Map(r.files.map(f => [f.file, f.mass / topMass]));
  const hits: Hit[] = filesKnn(qv, r.files.map(f => f.file), { ceiling })
    .map(h => ({ file: h.file, score: h.score, text: h.text, layer: h.layer, meta: h.meta ?? null, via: "ppr-file", graph: massOf.get(h.file) ?? 0 }));

  // Concept nodes carry no file of their own. They are reached lexically instead:
  // FTS5 over the expansion terms finds the passages that actually name them.
  if (r.terms.length) {
    try {
      const lex = lexicalKnn(r.terms.map(x => x.label).join(" "), 6, { exclude: ["skill"], ceiling }, qv)
        .map(h => ({ file: h.file, score: h.score, text: h.text, layer: h.layer, meta: h.meta ?? null, via: "ppr-term" }));
      hits.push(...lex);
    } catch { /* lexical is additive; a missing FTS index must not break the channel */ }
  }
  const seen = new Set<string>();
  const out = hits.filter(h => { const k = `${h.file}#${h.text.slice(0, 80)}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.score - a.score).slice(0, cap);
  addT(t, "ppr", Date.now() - t0);
  return { hits: out, seeds: r.seeds.map(s => s.label), terms: r.terms.map(x => x.label) };
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
  // The automemory layer is the user's own hand-written corrections, mirrored from
  // Claude Code's per-project memory. It gets a larger boost than the persona layer
  // for one reason: provenance. Persona facts are bulk-extracted, 83% of them from a
  // single 2026-06-09 run, and carry a confidence that takes two values and is never
  // revised by observation. An automemory file exists because he stopped and wrote it,
  // usually to correct something this vault already had wrong. When the two disagree
  // about his visa, his medication or his PhD plans, the written one is right, and
  // before this layer existed the derived one won on volume.
  for (const r of ranked) if (r.item.layer === "automemory" && r.score >= BOOST_FLOOR) r.score += AUTOMEMORY_BOOST;
  // G1 graph-signal fusion, on exactly the same discipline as the persona boost: it
  // only applies when the RAW cross-encoder score already clears BOOST_FLOOR, so the
  // graph can promote a passage the reranker already finds plausible but cannot
  // manufacture relevance for one it scored at zero. Without the floor this would be
  // a way for a well-connected but irrelevant document to ride the walk into context.
  const GB = pprGraphBoost();
  if (GB > 0) for (const r of ranked) if (r.item.graph && r.score >= BOOST_FLOOR) r.score += GB * r.item.graph;
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
  const topk = ranked.slice(0, 8).map(r => ({ f: r.item.file, l: r.item.layer, s: Number(r.score.toFixed(4)), ...(r.item.via ? { v: r.item.via } : {}) }));
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
    .map(r => snippet({ file: r.item.file, score: r.score, layer: r.item.layer, text: r.item.text, via: r.item.via }));
  if (keep.length === 0) keep = [snippet({ file: ranked[0]!.item.file, score: top, layer: ranked[0]!.item.layer, text: ranked[0]!.item.text, via: ranked[0]!.item.via })];
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
      // G1 attribution: what the graph channel contributed, and how much of it
      // survived to injection. This is what makes the channel's value measurable
      // in hindsight instead of assumed.
      ppr: result.ppr || null,
      pprKept: Array.isArray(result.hits) ? result.hits.filter((h: any) => h.via).length : 0,
      n: Array.isArray(result.hits) ? result.hits.length : 0,
      top: result.topk || (Array.isArray(result.hits) ? result.hits.map((h: any) => ({ f: h.file, l: h.layer, s: h.score })) : []),
      // Skill-router attribution. The route already logs a line to ambient.log, but
      // that is prose: it cannot be joined to ph, profile, or the hindsight pass, so
      // "is this skill ever used" was greppable and not measurable. Null when nothing
      // matched, which is the common case and keeps the record small.
      skills: Array.isArray(result.skills) && result.skills.length
        ? result.skills.map((s: any) => ({ n: s.name, s: s.score }))
        : null,
      // Delivery-side accounting. Retrieval quality was measurable and delivery was
      // not, which is how a route could be 70% of injections while every byte of it
      // was being truncated out of the payload before the model saw it.
      bytes: result.payloadBytes ?? null,
      capped: result.payloadDropped ?? null,
      // Which principles actually fired. This was computed and discarded, so the one
      // channel carrying the best content in the system was unattributable: no way to
      // join a principle to the prompt it reached or to a hindsight grade.
      method: Array.isArray(result.methodIds) && result.methodIds.length ? result.methodIds : null,
      ms
    };
    fs.appendFileSync(DECISIONS, JSON.stringify(rec) + "\n");
  } catch { /* never block the gate */ }
}

// Chunk-stat writes are buffered and flushed off the request path. They used to run
// inside /gate, and better-sqlite3 waits on a busy lock SYNCHRONOUSLY: with capture
// and sweep writers holding the lock, the whole event loop slept in busy_timeout.
// Measured 2026-10-30: the 8s gate deadline timer fired 230-570s late at near-idle
// CPU and /health went unanswered for 20s. Stats are advisory, so a busy lock keeps
// the batch for the next tick instead of waiting.
const PENDING_INJECTIONS: Array<{ file: string; th: string }> = [];
function queueInjections(items: Array<{ file: string; th: string }>): void {
  PENDING_INJECTIONS.push(...items);
  if (PENDING_INJECTIONS.length > 5000) PENDING_INJECTIONS.splice(0, PENDING_INJECTIONS.length - 5000);
}
function flushInjections(): void {
  if (!PENDING_INJECTIONS.length) return;
  const batch = PENDING_INJECTIONS.splice(0);
  try { recordInjections(batch); }
  catch (e: any) {
    if (e?.code === "SQLITE_BUSY") queueInjections(batch);
    else log(`chunk-stats write failed (gate unaffected): ${e.message}`);
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise(res => { let b = ""; req.on("data", c => b += c); req.on("end", () => res(b)); });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  // DNS-rebinding guard (2026-10-30): /gate and /query return memory text, so a web
  // page that rebinds its name to 127.0.0.1 must not reach them. It arrives with a
  // foreign Host header and, on a cross-site POST, an Origin; hooks and local tools
  // send Host 127.0.0.1/localhost and no Origin.
  const host = String(req.headers.host || "");
  if ((host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) || req.headers.origin) {
    res.statusCode = 403; return res.end(JSON.stringify({ error: "forbidden" }));
  }
  try {
    const u = new URL(req.url || "/", `http://localhost:${PORT}`);
    if (u.pathname === "/health") {
      const s = stats();
      const sorted = [...RECENT_MS].sort((a, b) => a - b);
      return res.end(JSON.stringify({
        ok: true, warm: WARM, files: s.files, chunks: s.chunks, entities: ENTITIES.length, rerank: ENABLE_RERANK, port: PORT, threshold: THRESHOLD,
        rss_mb: Math.round(process.memoryUsage().rss / 1048576), pending_stats: PENDING_INJECTIONS.length,
        uptime_h: Number(((Date.now() - STARTED) / 3600_000).toFixed(2)),
        gate_p50_recent: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null, gate_n_recent: sorted.length,
      }));
    }
    if (u.pathname === "/query") {
      const hits = await query(u.searchParams.get("q") || "", Number(u.searchParams.get("k") || TOPK));
      return res.end(JSON.stringify({ hits }));
    }
    if (u.pathname === "/ppr") {
      // Debug/inspection: what the graph channel sees for a prompt, without the
      // rerank stage. Used by the retrieval inspector and the multi-hop eval.
      const q = u.searchParams.get("q") || "";
      const t0 = Date.now();
      const r = pprQuery(q, { alpha: pprAlpha(), beta: pprBeta(), maxFiles: pprMaxFiles(), maxTerms: pprMaxTerms() });
      return res.end(JSON.stringify({ ms: Date.now() - t0, enabled: enablePpr(), ...(r || { seeds: [], files: [], terms: [] }) }));
    }
    if (u.pathname === "/sessions") {
      return res.end(JSON.stringify({ sessions: activeSessions(u.searchParams.get("exclude") || undefined) }));
    }
    if (u.pathname === "/gate" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      try { heartbeat(body.session_id ? String(body.session_id) : undefined, body.cwd ? String(body.cwd) : undefined, String(body.prompt || "")); } catch { /* */ }
      const t0 = Date.now();
      // Bound the gate HERE rather than leaving it to the client.
      //
      // The hook's timeout was the only limit, and when it tripped the injection was
      // lost with no record anywhere the daemon could see: a slow gate and a healthy
      // skip were indistinguishable downstream. Measured over 4,257 calls: p90 13.7s,
      // p99 179s, one call at 27 minutes, and 315 client-side drops in 30 days.
      //
      // Deciding "no injection" in bounded time is strictly better than deciding
      // correctly after the reader has gone. The timeout resolves to a normal skip so
      // it lands in the decision log and is countable, which the client-side drop
      // never was. Set below the hook's own timeout so this fires first and is ours.
      const result = await Promise.race([
        gate(String(body.prompt || ""), body.cwd ? String(body.cwd) : undefined, body.profile ? String(body.profile) : undefined),
        new Promise<any>(r => setTimeout(() => r({ inject: false, reason: "gate-timeout", timedOut: true }), GATE_TIMEOUT_MS)),
      ]);
      const elapsed = Date.now() - t0;
      if (result.timedOut) log(`gate:timeout after ${elapsed}ms :: ${String(body.prompt).slice(0, 60).replace(/\n/g, " ")}`);
      RECENT_MS.push(elapsed); if (RECENT_MS.length > 200) RECENT_MS.shift();
      logDecision(String(body.prompt || ""), result, elapsed);
      if (result.inject && Array.isArray(result.hits)) queueInjections(result.hits.filter((h: any) => h.th).map((h: any) => ({ file: h.file, th: h.th })));
      if (result.inject) log(`gate:inject ${result.hits.length} src top=${result.hits[0].score} (${result.signal}) :: ${String(body.prompt).slice(0, 60).replace(/\n/g, " ")}`);
      if (result.skills?.length) log(`gate:skill ${result.skills.map((s: any) => `${s.name}@${s.score}`).join(",")} :: ${String(body.prompt).slice(0, 60).replace(/\n/g, " ")}`);
      return res.end(JSON.stringify(result));
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: "not found" }));
  } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
});

async function main() {
  // The daemon must never sleep in SQLite's busy wait (see flushInjections). Its reads
  // run under WAL and do not block on writers; its own writes are buffered.
  getDb().pragma("busy_timeout = 250");
  tuneForServing();
  // Opt-in. A/B on six prompts (2026-10-30): identical inject decisions and files,
  // ~13% less gate time once loaded, for ~150 MB more RSS. Rerank, not KNN, now
  // dominates the gate, so the memory is not worth it by default.
  if (process.env.LKHS_MEM_INDEX === "1") enableMemoryIndex();
  ensureChunkStats();
  loadEntities();
  // Claim the port BEFORE warming. Warming first meant every duplicate (spawned by a
  // hook that misread a busy daemon as a dead one) burned ~35s of CPU loading models
  // and only then found the port taken. Requests that arrive while warming simply
  // await the same lazy model promises.
  server.on("error", (e: any) => { log(`server error: ${e.message}`); if (e.code === "EADDRINUSE") { console.log("daemon already running on this port; exiting."); process.exit(0); } });
  const s = stats();
  await new Promise<void>(res => server.listen(PORT, "127.0.0.1", () => {
    log(`listening on 127.0.0.1:${PORT} (${s.files} files, ${s.chunks} chunks, ${ENTITIES.length} entities); warming`);
    console.log(`LKHS daemon on http://127.0.0.1:${PORT} | ${s.files} files, ${s.chunks} chunks, threshold ${THRESHOLD}`);
    res();
  }));
  setInterval(flushInjections, 30_000).unref();
  // Event-loop stall detector: a 1s tick that lands late means something blocked the
  // loop. Logged, so a hang is visible in ambient.log rather than inferred later.
  let tick = Date.now();
  setInterval(() => {
    const lag = Date.now() - tick - 1000;
    if (lag > 2000) log(`loop-lag ${lag}ms`);
    tick = Date.now();
  }, 1000).unref();
  try { await indexSkills(); lastSkillIndex = latestSkillMtime(); }  // seed the skill-router layer on boot
  catch (e: any) { log(`skill index on boot failed (router disabled until a SKILL.md changes): ${e.message}`); }
  await getModel();  // warm the bi-encoder
  if (ENABLE_RERANK) { try { await warmReranker(); } catch (e: any) { log(`rerank warm failed (gate will fall back to cosine+intent): ${e.message}`); } }
  // Warm the method vectors too. They are embedded lazily on first use and there are
  // ~14 of them, so the first task-onset prompt after a restart paid the whole cost:
  // measured at 12.8s end to end, past the gate's own deadline, so that prompt lost
  // its injection entirely. The daemon is recycled every 3 hours, which turned a
  // one-time cost into a recurring one that always landed on a real prompt.
  //
  // taskOnsetGate is pure: it embeds, scores and returns. Warming through gate()
  // instead would log a decision row and, worse, fire and mark prospective
  // intentions, so the warmup must not go near it.
  try {
    const t0 = Date.now();
    await taskOnsetGate("let's start on the revision and work through the sections methodically today");
    log(`method vectors warmed in ${Date.now() - t0}ms`);
  } catch (e: any) { log(`method warm failed (first onset prompt pays the cost): ${e.message}`); }
  WARM = true;
  log("warm");
}
main();
