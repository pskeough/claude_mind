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
import * as os from "os";
import * as path from "path";
import { canonKey } from "./text-normalize";
import { knn, stats, getDb } from "./store";
import { rerank, warm as warmReranker } from "./rerank";
import { config, daemonPort, vaultRoot } from "./config";

const C = config();
const PORT = daemonPort();
const THRESHOLD = Number(C.retrieveThreshold ?? 0.62);  // cosine floor (fallback gate only)
const TOPK = Number(C.retrieveTopK ?? 4);

// Reranker gate. The cross-encoder is the primary relevance signal; intent breaks
// the ambiguous middle band. Thresholds calibrated against a personal-vs-general
// battery (see calibrate-rerank.ts): clear recall ~0.95+, general ~0.00-0.05.
const ENABLE_RERANK = (C.enableRerank ?? true) !== false;
const RERANK_POOL = Number(C.rerankPool ?? 16);    // bi-encoder candidates to rerank
const RERANK_MAXCHARS = Number(C.rerankMaxChars ?? 400); // truncate passages before scoring (latency)
const RERANK_HIGH = Number(C.rerankHigh ?? 0.30);  // >= this: inject (confident)
const RERANK_LOW = Number(C.rerankLow ?? 0.02);    // < this: skip (confident)
const PERSONA_BOOST = Number(C.personaBoost ?? 0.15); // additive rerank bump for the persona (identity) layer

let _model: Promise<FlagEmbedding> | null = null;
const getModel = () => (_model ??= FlagEmbedding.init({ model: EmbeddingModel.BGESmallENV15 }));

async function embedQuery(q: string): Promise<number[]> {
  const model = await getModel();
  for await (const batch of model.embed([`query: ${q.replace(/\s+/g, " ").trim()}`]))
    for (const v of batch) return Array.from(v as ArrayLike<number>);
  return [];
}

interface Hit { file: string; score: number; text: string; layer: string }
async function query(q: string, k: number): Promise<Hit[]> {
  const qv = await embedQuery(q);
  if (qv.length === 0) return [];
  return knn(qv, k).map(h => ({ file: h.file, score: h.score, text: h.text, layer: h.layer }));
}

const TRIVIAL = /^(y|n|yes|no|ok|okay|sure|thanks|thank you|continue|go|go ahead|do it|next|stop|nvm|nevermind)[.!]?$/i;
// Recall phrasing: the prompt is asking about the user's own past work, not general knowledge.
const RECALL = /\b(did i|have i|how did|where did|when did|did we|have we|last time|previously|earlier|we discussed|we built|i already|i built|i wrote|i made|i found|i created|i set up|i decided|remember|recall|my notes|my previous|my last|my earlier|carry on|pick(ing)? up where)\b/i;

// Broad / aggregative "overview" queries. The cross-encoder scores these ~0 (no
// single passage ANSWERS "what am I working on"), so they are routed instead to a
// cosine lookup over the synthesized overview layers (themes + project cards),
// where topical similarity ranks well. This is query-type routing, not a threshold.
const META = /\b(what am i working on|what are my|overview of|across (all )?my|my (\w+ )?(projects|research|writing|work|notes)|themes? (across|in|of|for)|state of my|summar(ize|y) of (my|all)|big picture|how do my .* (connect|relate))\b/i;

// Identity / self queries route to the persona (deep user model) layer first. The
// floor (cosine over persona only) is the safety: a topical "how do I think about X"
// won't clear it because no persona passage is similar, so it falls through.
const IDENTITY = /\b(who am i|about (me|myself)|tell me about (me|myself)|what do you know about me|my (background|personality|psycholog|cognitive|values|worldview|biograph|history|life|identity|self|voice|writing style|mind|decision)|how does my mind|how i think|communicate with me|talk(ing)? to me|work with me|advise me|decision[- ]?(making|patterns?)|make decisions|how should (you|i) .* me)\b/i;

// Entity vocabulary from the graph: lets topical prompts (no recall phrasing) still
// trigger when they name something actually in the brain. Reloaded with the store.
let ENTITIES: string[] = [];
function loadEntities(): void {
  try {
    const g = path.join(__dirname, "..", "..", "graph", "graph.json");
    if (!fs.existsSync(g)) { ENTITIES = []; return; }
    const data = JSON.parse(fs.readFileSync(g, "utf-8"));
    // Canonicalize entity labels to the same key space the prompt is matched in,
    // so separator-style variants all resolve to one gate target.
    ENTITIES = [...new Set((data.nodes || []).map((n: any) => canonKey(String(n.label || ""))).filter((s: string) => s.length >= 5))] as string[];
  } catch { ENTITIES = []; }
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

const snippet = (h: { file: string; score: number; layer: string; text: string }) =>
  ({ file: h.file, score: Number(h.score.toFixed(3)), layer: h.layer, text: h.text.replace(/\s+/g, " ").slice(0, 320) });

const META_FLOOR = Number(C.metaFloor ?? 0.5);
const IDENTITY_FLOOR = Number(C.identityFloor ?? 0.42); // lower: identity prompts are short/vague but persona passages answer them

/** Overview route: cosine over the synthesized layers (themes + cards). Returns
 *  null if nothing clears the floor, so the caller falls through to the normal gate. */
async function metaGate(prompt: string): Promise<any | null> {
  const qv = await embedQuery(prompt);
  if (qv.length === 0) return null;
  const hits = knn(qv, 8, { layers: ["persona", "theme", "card"] }).filter(h => h.score >= META_FLOOR);
  if (hits.length === 0) return null;
  const keep = hits.slice(0, TOPK).map(snippet);
  return { inject: true, query: prompt, hits: keep, reason: "meta-overview", signal: "meta" };
}

/** Identity route: cosine over the persona layer only. Surfaces the deep user model
 *  for "who am I / my background / how I think" style prompts. Clinical tier excluded. */
async function identityGate(prompt: string): Promise<any | null> {
  const qv = await embedQuery(prompt);
  if (qv.length === 0) return null;
  const hits = knn(qv, 8, { layers: ["persona"] }).filter(h => h.score >= IDENTITY_FLOOR);
  if (hits.length === 0) return null;
  const keep = hits.slice(0, TOPK).map(snippet);
  return { inject: true, query: prompt, hits: keep, reason: "identity", signal: "identity" };
}

async function gate(prompt: string): Promise<any> {
  const skip = gateHeuristic(prompt);
  if (skip) return { inject: false, reason: skip };

  // Identity / self queries route to the persona layer first.
  if (IDENTITY.test(prompt)) { const id = await identityGate(prompt); if (id) return id; }

  // Aggregative "overview" queries route to the synthesized layers (the reranker
  // cannot score them). Falls through to the normal path if nothing clears the floor.
  if (META.test(prompt)) { const m = await metaGate(prompt); if (m) return m; }

  // Bi-encoder pulls a broad candidate pool (cheap, high recall). The cross-encoder
  // then judges true relevance. Pool is wider when reranking, just TOPK otherwise.
  const pool = await query(prompt, ENABLE_RERANK ? RERANK_POOL : TOPK);
  if (pool.length === 0) return { inject: false, reason: "no-candidates" };

  if (ENABLE_RERANK) {
    try { return await rerankGate(prompt, pool); }
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
async function rerankGate(prompt: string, pool: Hit[]): Promise<any> {
  const ranked = await rerank(prompt, pool, h => h.text.slice(0, RERANK_MAXCHARS));
  // Persona layer is the deep user model: weight it heavier so identity/biography/
  // psychology context clears the inject gate even when phrased obliquely. The boost
  // is additive on the cross-encoder score, then we re-sort so order stays truthful.
  for (const r of ranked) if (r.item.layer === "persona") r.score += PERSONA_BOOST;
  ranked.sort((a, b) => b.score - a.score);
  const top = ranked[0]!.score;
  let inject: boolean, reason: string;
  if (top >= RERANK_HIGH) { inject = true; reason = "rerank-high"; }
  else if (top < RERANK_LOW) { inject = false; reason = "rerank-low"; }
  else { const sig = intentSignal(prompt); inject = !!sig; reason = sig ? `rerank-mid+${sig}` : "rerank-mid-no-intent"; }

  if (!inject) return { inject: false, reason, topScore: Number(top.toFixed(3)) };
  let keep = ranked.filter(r => r.score >= RERANK_LOW).slice(0, TOPK)
    .map(r => snippet({ file: r.item.file, score: r.score, layer: r.item.layer, text: r.item.text }));
  if (keep.length === 0) keep = [snippet({ file: ranked[0]!.item.file, score: top, layer: ranked[0]!.item.layer, text: ranked[0]!.item.text })];
  return { inject: true, query: prompt, hits: keep, reason, signal: reason };
}

/** Fallback (reranker disabled or failed): the original cosine + intent gate. */
function cosineIntentGate(prompt: string, pool: Hit[]): any {
  const sig = intentSignal(prompt);
  if (!sig) return { inject: false, reason: "no-personal-intent" };
  const top = pool[0]!.score;
  if (top < THRESHOLD) return { inject: false, reason: "below-threshold", topScore: Number(top.toFixed(3)) };
  const keep = pool.filter(h => h.score >= Math.max(THRESHOLD, top - 0.08)).slice(0, TOPK).map(snippet);
  return { inject: true, query: prompt, hits: keep, reason: "relevant", signal: sig };
}

// ---- logging + http -------------------------------------------------------
const LOG = path.join(__dirname, "..", "logs", "ambient.log");
function log(m: string) { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `[${new Date().toISOString()}] daemon:${m}\n`); } catch { /* */ } }

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise(res => { let b = ""; req.on("data", c => b += c); req.on("end", () => res(b)); });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const u = new URL(req.url || "/", `http://localhost:${PORT}`);
    if (u.pathname === "/health") {
      const s = stats();
      return res.end(JSON.stringify({ ok: true, files: s.files, chunks: s.chunks, entities: ENTITIES.length, rerank: ENABLE_RERANK, port: PORT, threshold: THRESHOLD }));
    }
    if (u.pathname === "/query") {
      const hits = await query(u.searchParams.get("q") || "", Number(u.searchParams.get("k") || TOPK));
      return res.end(JSON.stringify({ hits }));
    }
    if (u.pathname === "/gate" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = await gate(String(body.prompt || ""));
      if (result.inject) log(`gate:inject ${result.hits.length} src top=${result.hits[0].score} (${result.signal}) :: ${String(body.prompt).slice(0, 60).replace(/\n/g, " ")}`);
      return res.end(JSON.stringify(result));
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: "not found" }));
  } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
});

async function main() {
  getDb();           // open SQLite + load vec extension + ensure schema
  loadEntities();
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
