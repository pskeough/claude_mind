/**
 * LKHS Web Console: a local front-end for the Claude Mind.
 *
 * Serves a single-page app (.claude/web/) plus JSON APIs over the live engine
 * (store + reranker + graph + cards/themes/journals). Includes a memory chat that
 * ALWAYS routes through retrieval (forced injection) and answers via `claude -p`
 * on the subscription, so the console doubles as a project-agnostic memory
 * interface.
 *
 *   npm run web    ->  http://127.0.0.1:7099
 */
import { FlagEmbedding, EmbeddingModel } from "fastembed";
import { spawnSync } from "child_process";
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { knn, stats, layerStats, allFiles, fileChunks, getDb } from "./store";
import { rerank, warm as warmReranker } from "./rerank";
import { canonKey } from "./text-normalize";
import {
  vaultRoot, webPort, chatModel, rerankHigh, rerankLow, metaFloor, identityFloor,
  RECALL_RE, META_RE, IDENTITY_RE,
} from "./config";

const VAULT = vaultRoot();
const WEB = path.join(VAULT, ".claude", "web");
const PORT = webPort();
// Gate constants + intent regexes come from config.ts (single source of truth,
// shared with lkhs-daemon.ts) so the retrieval inspector reflects the real gate.
const RERANK_HIGH = rerankHigh();
const RERANK_LOW = rerankLow();
const META_FLOOR = metaFloor();
const IDENTITY_FLOOR = identityFloor();
const CHAT_MODEL = chatModel();

const RECALL = RECALL_RE;
const META = META_RE;
const IDENTITY = IDENTITY_RE;

// ---- models ----------------------------------------------------------------
let _model: Promise<FlagEmbedding> | null = null;
const getModel = () => (_model ??= FlagEmbedding.init({ model: EmbeddingModel.BGESmallENV15 }));
async function embedQuery(q: string): Promise<number[]> {
  const m = await getModel();
  for await (const batch of m.embed([`query: ${q.replace(/\s+/g, " ").trim()}`])) for (const v of batch) return Array.from(v as ArrayLike<number>);
  return [];
}

let ENTITIES: string[] = [];
function loadEntities() {
  try {
    const g = JSON.parse(fs.readFileSync(path.join(VAULT, "graph", "graph.json"), "utf-8"));
    ENTITIES = [...new Set((g.nodes || []).map((n: any) => canonKey(String(n.label || ""))).filter((s: string) => s.length >= 5))] as string[];
  } catch { ENTITIES = []; }
}
function intentSignal(prompt: string): string | null {
  if (RECALL.test(prompt.toLowerCase())) return "recall-phrasing";
  const pk = canonKey(prompt);
  for (const e of ENTITIES) if (pk.includes(e)) return `entity:${e}`;
  return null;
}

// ---- retrieval pipeline (with full detail for the inspector) ----------------
async function pipeline(query: string, topK = 6): Promise<any> {
  const qv = await embedQuery(query);
  if (qv.length === 0) return { query, route: "none", candidates: [], injected: [], decision: { inject: false, reason: "empty-query" } };

  // Identity / self queries route to the persona layer first (mirrors the daemon's
  // identityGate). Falls through to the normal pipeline if nothing clears the floor.
  if (IDENTITY.test(query)) {
    const hits = knn(qv, 8, { layers: ["persona"] });
    const injected = hits.filter(h => h.score >= IDENTITY_FLOOR).slice(0, topK);
    if (injected.length > 0) {
      return {
        query, route: "identity", signal: "identity",
        candidates: hits.map(h => ({ file: h.file, layer: h.layer, cosine: Number(h.score.toFixed(3)) })),
        injected: injected.map(h => ({ file: h.file, layer: h.layer, score: Number(h.score.toFixed(3)), text: h.text })),
        decision: { inject: true, reason: "identity" },
      };
    }
  }

  if (META.test(query)) {
    const hits = knn(qv, 12, { layers: ["persona", "theme", "card"] });
    const injected = hits.filter(h => h.score >= META_FLOOR).slice(0, topK);
    return {
      query, route: "meta", signal: "meta-overview",
      candidates: hits.map(h => ({ file: h.file, layer: h.layer, cosine: Number(h.score.toFixed(3)) })),
      injected: injected.map(h => ({ file: h.file, layer: h.layer, score: Number(h.score.toFixed(3)), text: h.text })),
      decision: { inject: injected.length > 0, reason: injected.length ? "meta-overview" : "meta-below-floor" },
    };
  }

  const pool = knn(qv, 24, { exclude: ["skill"] }); // skill-router layer is not a memory source
  const ranked = await rerank(query, pool, h => h.text.slice(0, 400));
  const top = ranked[0]?.score ?? 0;
  let inject: boolean, reason: string;
  if (top >= RERANK_HIGH) { inject = true; reason = "rerank-high"; }
  else if (top < RERANK_LOW) { inject = false; reason = "rerank-low"; }
  else { const sig = intentSignal(query); inject = !!sig; reason = sig ? `rerank-mid+${sig}` : "rerank-mid-no-intent"; }

  const candidates = ranked.map(r => ({ file: r.item.file, layer: r.item.layer, cosine: Number(r.item.score.toFixed(3)), rerank: Number(r.score.toFixed(3)) }));
  const injected = inject ? ranked.filter(r => r.score >= RERANK_LOW).slice(0, topK)
    .map(r => ({ file: r.item.file, layer: r.item.layer, score: Number(r.score.toFixed(3)), text: r.item.text })) : [];
  return { query, route: "rerank", signal: reason, candidates, injected, decision: { inject, reason, topScore: Number(top.toFixed(3)) } };
}

// ---- memory chat (forced retrieval -> claude -p) ----------------------------
// Mirrors the proven cards/themes invocation: a clean ASCII -p instruction (no
// shell-special chars), all framing + context via stdin, spawnSync + shell so the
// `claude` shim resolves on Windows.
function claudeChat(question: string, context: string, history: string): string {
  const instruction = "Read the input and follow the final instruction in it. Output only the answer to the USER MESSAGE. Do not continue or reply to any logged content other than that final message.";
  const input = [
    "You are the user's personal memory interface (the Claude Mind). Answer the USER MESSAGE using the MEMORY CONTEXT below when it is relevant; if the context does not cover the question, say so briefly and answer from general knowledge. Cite sources inline as [source: <path>]. Style: direct, no preamble, no em dashes, no praise.",
    "",
    "MEMORY CONTEXT (retrieved from the user's knowledge base for this turn):",
    context || "(no strongly relevant memory found)",
    history ? "\nCONVERSATION SO FAR:\n" + history : "",
    "\nUSER MESSAGE:\n" + question,
  ].join("\n");
  const res = spawnSync("claude", ["-p", instruction, "--model", CHAT_MODEL, "--output-format", "text"], {
    cwd: VAULT, input, shell: true, env: { ...process.env, LKHS_CAPTURE: "1" }, maxBuffer: 10 * 1024 * 1024, timeout: 120_000,
  });
  const out = (res.stdout ? Buffer.from(res.stdout).toString("utf8") : "").trim();
  if (res.status === 0 && out) return out;
  return `(memory chat unavailable: exit ${res.status} ${(res.stderr ? Buffer.from(res.stderr).toString("utf8") : "").slice(0, 200)})`;
}

// ---- data readers ----------------------------------------------------------
const readMd = (p: string) => { try { return fs.readFileSync(path.join(VAULT, p), "utf-8"); } catch { return ""; } };
const frontmatter = (c: string, k: string) => c.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim() || "";
const stripFm = (c: string) => c.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
const dirMd = (d: string) => { try { return fs.readdirSync(path.join(VAULT, d)).filter(f => f.endsWith(".md") && !f.startsWith("_")); } catch { return []; } };

function overview() {
  const s = stats(); const layers = layerStats();
  const sweep = (() => { try { return JSON.parse(fs.readFileSync(path.join(VAULT, "journal", "_sessions.jsonl"), "utf-8").trim().split("\n").filter(Boolean).pop()!); } catch { return null; } })();
  let gateLog: string[] = [];
  try { gateLog = fs.readFileSync(path.join(VAULT, ".claude", "logs", "ambient.log"), "utf-8").split("\n").filter(l => l.includes("gate:inject") && !l.includes("daemon:store loaded")).slice(-8).map(l => l.replace(/^\[[^\]]+\] daemon:gate:inject /, "")); } catch { /* */ }
  let graph: any = {};
  try { const g = JSON.parse(fs.readFileSync(path.join(VAULT, "graph", "graph.json"), "utf-8")); graph = { nodes: g.nodes.length, edges: g.edges.length, communities: g.communities.length }; } catch { /* */ }
  return {
    store: s, layers,
    counts: { sessions: (() => { try { return fs.readFileSync(path.join(VAULT, "journal", "_sessions.jsonl"), "utf-8").split("\n").filter(Boolean).length; } catch { return 0; } })(), library: dirMd("library").length, cards: dirMd("cards").length, themes: dirMd("themes").length, wiki: dirMd("wiki").length },
    graph, lastSession: sweep?.at || null, recent: gateLog,
    entities: ENTITIES.length, model: "bge-small-en-v1.5 (384d)", reranker: "ms-marco-MiniLM-L-6-v2", chatModel: CHAT_MODEL,
  };
}

function themes() {
  return dirMd("themes").map(f => {
    const c = readMd(`themes/${f}`); const body = stripFm(c);
    const name = frontmatter(c, "title").replace(/^theme\s*-\s*/i, "") || f.replace(/\.md$/, "");
    const through = body.replace(/^#.*\n/m, "").trim().split("\n").find(l => l.trim()) || "";
    const projects = (body.match(/\*\*Projects:\*\*\s*(.+)/)?.[1] || "").replace(/\[\[[^\]|]*\|?([^\]]*)\]\]/g, "$1");
    return { file: `themes/${f}`, name, through: through.replace(/[*_`]/g, "").slice(0, 200), projects, body };
  });
}
function projects() {
  const journals = new Set(dirMd("journal").map(f => f.replace(/\.md$/, "")));
  return dirMd("cards").map(f => {
    const c = readMd(`cards/${f}`); const name = f.replace(/\.md$/, ""); const body = stripFm(c);
    const status = body.match(/\*\*Status:\*\*\s*([\s\S]*?)(?:\n\*\*|\n##|$)/)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 200) || body.replace(/^#.*\n/m, "").trim().slice(0, 200);
    return { file: `cards/${f}`, name, lastActive: frontmatter(c, "last_active"), hasJournal: journals.has(name), status };
  }).sort((a, b) => (b.lastActive || "").localeCompare(a.lastActive || ""));
}
function timeline() {
  try {
    const lines = fs.readFileSync(path.join(VAULT, "journal", "_sessions.jsonl"), "utf-8").split("\n").filter(Boolean);
    return lines.map(l => { try { const e = JSON.parse(l); return { project: e.project, title: (e.title || "").replace(/[#_*]/g, "").slice(0, 80), date: (e.sessionStart || e.at || "").slice(0, 10), at: e.sessionStart || e.at }; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function persona() {
  // The deep user model. Clinical tier (persona_clinical.jsonl) is deliberately NOT read here.
  let profile: any = null;
  try { profile = JSON.parse(readMd(".claude/memory/core_profile.json")); } catch { /* */ }
  const docs = dirMd("persona").map(f => { const c = readMd(`persona/${f}`); const body = stripFm(c); return { file: `persona/${f}`, title: frontmatter(c, "title") || f.replace(/\.md$/, ""), line: body.replace(/^#.*\n/m, "").trim().split("\n").find(l => l.trim())?.replace(/[*_`#\[\]]/g, "").slice(0, 160) || "" }; });
  let facts: any[] = [];
  try { facts = readMd(".claude/memory/persona_facts.jsonl").trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)); } catch { /* */ }
  const byFacet: Record<string, number> = {};
  for (const f of facts) byFacet[f.facet] = (byFacet[f.facet] || 0) + 1;
  const top = [...facts].sort((a, b) => (b.confidence || 0) - (a.confidence || 0)).slice(0, 40).map(f => ({ facet: f.facet, t: f.t_event, c: f.confidence, s: f.statement }));
  let people: any[] = [];
  try { people = JSON.parse(readMd("persona/entities.json")).people || []; } catch { /* */ }
  const history = (readMd("persona/TIMELINE.md").match(/^## (.+?) \((\d+)\)/gm) || []).map(h => { const m = h.match(/^## (.+?) \((\d+)\)/); return { label: m![1], count: Number(m![2]) }; });
  return { profile, docs, facts: { total: facts.length, byFacet, top }, people, history };
}

function schema() {
  const db = getDb();
  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'").all();
  let dbBytes = 0; try { dbBytes = fs.statSync(path.join(VAULT, ".claude", "memory", "vector_store.db")).size; } catch { /* */ }
  const pragmas: any = {};
  for (const p of ["journal_mode", "page_count", "page_size"]) { try { pragmas[p] = db.pragma(p, { simple: true }); } catch { /* */ } }
  return { tables, dbBytes, pragmas, dim: 384, layers: layerStats() };
}

// ---- http ------------------------------------------------------------------
const MIME: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
function readBody(req: http.IncomingMessage): Promise<string> { return new Promise(r => { let b = ""; req.on("data", c => b += c); req.on("end", () => r(b)); }); }
const json = (res: http.ServerResponse, obj: any) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", `http://localhost:${PORT}`);
    const p = u.pathname;

    if (p === "/" || p === "/index.html") { res.setHeader("Content-Type", "text/html"); return res.end(fs.readFileSync(path.join(WEB, "index.html"))); }
    if (p.startsWith("/assets/") || p === "/app.js" || p === "/style.css") {
      const fp = path.join(WEB, p.replace(/^\//, "")); if (fs.existsSync(fp)) { res.setHeader("Content-Type", MIME[path.extname(fp)] || "text/plain"); return res.end(fs.readFileSync(fp)); }
    }
    if (p === "/api/overview") return json(res, overview());
    if (p === "/api/graph") { res.setHeader("Content-Type", "application/json"); return res.end(fs.readFileSync(path.join(VAULT, "graph", "graph.json"))); }
    if (p === "/api/graph-report") return json(res, { report: readMd("graph/GRAPH_REPORT.md") });
    if (p === "/api/themes") return json(res, themes());
    if (p === "/api/projects") return json(res, projects());
    if (p === "/api/card") return json(res, { name: u.searchParams.get("name"), body: stripFm(readMd(`cards/${u.searchParams.get("name")}.md`)) });
    if (p === "/api/timeline") return json(res, timeline());
    if (p === "/api/schema") return json(res, schema());
    if (p === "/api/persona") return json(res, persona());
    if (p === "/api/chunks") { const f = u.searchParams.get("file") || ""; return json(res, { file: f, chunks: fileChunks(f) }); }
    if (p === "/api/files") return json(res, { files: allFiles().slice(0, 4000) });
    if (p === "/api/retrieve" && req.method === "POST") { const b = JSON.parse((await readBody(req)) || "{}"); return json(res, await pipeline(String(b.query || ""))); }
    if (p === "/api/chat" && req.method === "POST") {
      const b = JSON.parse((await readBody(req)) || "{}");
      const pipe = await pipeline(String(b.message || ""));
      const ctx = pipe.injected.map((h: any) => `- [source: ${h.file}] ${h.text.replace(/\s+/g, " ").slice(0, 600)}`).join("\n");
      const answer = await claudeChat(String(b.message || ""), ctx, String(b.history || ""));
      return json(res, { answer, sources: pipe.injected.map((h: any) => ({ file: h.file, layer: h.layer, score: h.score })), route: pipe.route, reason: pipe.decision.reason });
    }
    res.statusCode = 404; json(res, { error: "not found" });
  } catch (e: any) { res.statusCode = 500; json(res, { error: e.message }); }
});

async function main() {
  getDb(); loadEntities();
  await getModel(); try { await warmReranker(); } catch { /* */ }
  server.listen(PORT, "127.0.0.1", () => console.log(`LKHS Web Console -> http://127.0.0.1:${PORT}  (store: ${stats().chunks} chunks, chat model: ${CHAT_MODEL})`));
  server.on("error", (e: any) => { if (e.code === "EADDRINUSE") { console.log(`port ${PORT} in use; is the console already running?`); process.exit(0); } });
}
main();
