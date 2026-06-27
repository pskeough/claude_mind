/**
 * LKHS MCP server: agentic access to the Claude Mind.
 *
 * The UserPromptSubmit hook gives passive retrieval on every prompt. This server
 * gives the MODEL active tools to dig deeper mid-task, beyond that one look:
 *   - search_memory(query, k?, layer?)  reranked semantic search across everything
 *   - project_state(project)            the L2 state card: where a project stands
 *   - timeline(project?, limit?)        recent session history, chronological
 *   - related(concept)                  graph neighbors of a concept/project
 *
 * Runs from any project: it reads centralVault from config and chdirs there so the
 * SQLite store, cards, journals and graph all resolve. stdout is the MCP protocol,
 * so all logging goes to a file.
 *
 * Register (user scope, available everywhere):
 *   claude mcp add --scope user lkhs-memory -- node --import tsx <abs>/lkhs-mcp.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { vaultRoot } from "./config";

// Resolve the vault (env > config.centralVault > derived) and chdir so cwd matches
// the vault; the engine resolves paths via config regardless, this just keeps them aligned.
const VAULT = vaultRoot();
try { if (VAULT && fs.existsSync(VAULT)) process.chdir(VAULT); } catch { /* */ }

const LOG = path.join(VAULT, ".claude", "logs", "ambient.log");
function log(m: string) { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] mcp:${m}\n`); } catch { /* */ } }

async function main() {
  // Dynamic import after chdir so vault-relative paths resolve.
  const { knn, layerStats, stats } = await import("./store");
  const { queryVectorStore } = await import("./vector-query");
  const { rerank } = await import("./rerank");
  const { canonKey } = await import("./text-normalize");

  const server = new McpServer({ name: "lkhs-memory", version: "1.0.0" });

  // Graph helpers (shared by related + explore).
  const loadGraph = () => { try { return JSON.parse(fs.readFileSync(path.join(VAULT, "graph", "graph.json"), "utf-8")); } catch { return null; } };
  const gFind = (g: any, name: string) => { const w = canonKey(name); return g.nodes.find((n: any) => n.id === w) || g.nodes.find((n: any) => canonKey(n.label).includes(w) || w.includes(canonKey(n.label))); };
  const gNbrs = (g: any, id: string) => {
    const label = new Map(g.nodes.map((n: any) => [n.id, n.label])), typ = new Map(g.nodes.map((n: any) => [n.id, n.type]));
    return g.edges.filter((e: any) => e.source === id || e.target === id)
      .map((e: any) => { const o = e.source === id ? e.target : e.source; return { label: label.get(o), type: typ.get(o), weight: e.weight }; })
      .sort((a: any, b: any) => b.weight - a.weight);
  };
  const projectOfFile = (f: string) => { const p = f.replace(/\\/g, "/").split("/"); return ["library", "cards", "journal", "themes"].includes(p[0]!) ? (p[1] || "").replace(/\.md$/, "") : (p[p.length - 1] || "").replace(/\.md$/, ""); };

  // ---- search_memory: reranked semantic search --------------------------------
  server.tool(
    "search_memory",
    "Search the user's Claude Mind (past Claude Code sessions, ingested project files, project state cards, wiki, theme cards) by meaning. Returns the most relevant passages, cross-encoder reranked. Use when you need the user's own past work, decisions, or context. Optional layer filter: card (project state), theme (cross-project), session (past chats), project (ingested files), wiki.",
    { query: z.string().describe("what to look for"), k: z.number().optional().describe("max results, default 6"), layer: z.string().optional().describe("optional layer filter: card|theme|session|project|wiki") },
    async ({ query, k, layer }) => {
      try {
        const topK = Math.min(Math.max(k ?? 6, 1), 15);
        const pool = await queryVectorStore(query, 24);
        const filtered = layer ? pool.filter(h => h.layer === layer) : pool;
        if (filtered.length === 0) return { content: [{ type: "text", text: "No matches." }] };
        const ranked = await rerank(query, filtered, h => h.text.slice(0, 400));
        const out = ranked.slice(0, topK).map(r =>
          `[${r.score.toFixed(3)} ${r.item.layer}] ${r.item.filePath}\n${r.item.text.replace(/\s+/g, " ").slice(0, 500)}`).join("\n\n");
        log(`search_memory "${query.slice(0, 50)}" -> ${ranked.length}`);
        return { content: [{ type: "text", text: out }] };
      } catch (e: any) { log(`search_memory err ${e.message}`); return { content: [{ type: "text", text: `search error: ${e.message}` }] }; }
    }
  );

  // ---- project_state: the L2 card --------------------------------------------
  server.tool(
    "project_state",
    "Get the current state card for a project (what it is, status, recent decisions, open threads, key files). Use to resume or to recall where a project stands. Pass the project name; fuzzy-matched.",
    { project: z.string().describe("project name, e.g. the folder name of one of the user's projects") },
    async ({ project }) => {
      try {
        const dir = path.join(VAULT, "cards");
        const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".md") && !f.startsWith("_")) : [];
        const want = canonKey(project);
        let hit = files.find(f => canonKey(f.replace(/\.md$/, "")) === want)
          || files.find(f => canonKey(f.replace(/\.md$/, "")).includes(want) || want.includes(canonKey(f.replace(/\.md$/, ""))));
        if (!hit) {
          const near = files.map(f => f.replace(/\.md$/, "")).slice(0, 40).join(", ");
          return { content: [{ type: "text", text: `No card for "${project}". Known projects: ${near}` }] };
        }
        const body = fs.readFileSync(path.join(dir, hit), "utf-8").replace(/^---\n[\s\S]*?\n---\n/, "");
        return { content: [{ type: "text", text: body }] };
      } catch (e: any) { return { content: [{ type: "text", text: `error: ${e.message}` }] }; }
    }
  );

  // ---- timeline: recent session history --------------------------------------
  server.tool(
    "timeline",
    "Recent session history for a project (or across all projects if none given), most recent first. Each entry: date, title, and the summary. Use to see what happened lately.",
    { project: z.string().optional().describe("project name; omit for all projects"), limit: z.number().optional().describe("max entries, default 8") },
    async ({ project, limit }) => {
      try {
        const lim = Math.min(Math.max(limit ?? 8, 1), 25);
        const jdir = path.join(VAULT, "journal");
        let entries: Array<{ date: string; title: string; body: string; project: string }> = [];
        const parseFile = (file: string, proj: string) => {
          const content = fs.readFileSync(file, "utf-8");
          for (const e of content.split(/^## (?=\d{4}-)/m).slice(1)) {
            const date = (e.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
            const title = (e.match(/^_(.*?)_/m) || [])[1] || "";
            entries.push({ date, title, body: ("## " + e).trim().slice(0, 700), project: proj });
          }
        };
        if (project) {
          const f = path.join(jdir, `${project}.md`);
          if (!fs.existsSync(f)) return { content: [{ type: "text", text: `No session history for "${project}".` }] };
          parseFile(f, project);
        } else if (fs.existsSync(jdir)) {
          for (const jf of fs.readdirSync(jdir)) if (jf.endsWith(".md") && !jf.startsWith("_")) parseFile(path.join(jdir, jf), jf.replace(/\.md$/, ""));
        }
        entries.sort((a, b) => b.date.localeCompare(a.date));
        const out = entries.slice(0, lim).map(e => `[${e.date}] (${e.project}) ${e.title}\n${e.body}`).join("\n\n---\n\n");
        return { content: [{ type: "text", text: out || "No entries." }] };
      } catch (e: any) { return { content: [{ type: "text", text: `error: ${e.message}` }] }; }
    }
  );

  // ---- related: graph neighbors ----------------------------------------------
  server.tool(
    "related",
    "Find concepts and projects connected to a given concept in the knowledge graph (co-occurrence + links). Use to discover related threads across the user's work.",
    { concept: z.string().describe("a concept, tool, or project name") },
    async ({ concept }) => {
      try {
        const gp = path.join(VAULT, "graph", "graph.json");
        if (!fs.existsSync(gp)) return { content: [{ type: "text", text: "No graph yet (run npm run graph)." }] };
        const g = JSON.parse(fs.readFileSync(gp, "utf-8"));
        const want = canonKey(concept);
        const node = g.nodes.find((n: any) => n.id === want)
          || g.nodes.find((n: any) => canonKey(n.label).includes(want) || want.includes(canonKey(n.label)));
        if (!node) return { content: [{ type: "text", text: `"${concept}" not found in the graph.` }] };
        const label = new Map(g.nodes.map((n: any) => [n.id, n.label]));
        const typeOf = new Map(g.nodes.map((n: any) => [n.id, n.type]));
        const nbrs = g.edges
          .filter((e: any) => e.source === node.id || e.target === node.id)
          .map((e: any) => { const o = e.source === node.id ? e.target : e.source; return { label: label.get(o), type: typeOf.get(o), weight: e.weight }; })
          .sort((a: any, b: any) => b.weight - a.weight).slice(0, 20);
        const out = `${node.label} (${node.type}) connects to:\n` + nbrs.map((n: any) => `  - ${n.label} (${n.type}, w=${n.weight.toFixed(1)})`).join("\n");
        return { content: [{ type: "text", text: out }] };
      } catch (e: any) { return { content: [{ type: "text", text: `error: ${e.message}` }] }; }
    }
  );

  // ---- explore: graph-aware search (results + connected threads) -------------
  server.tool(
    "explore",
    "Graph-aware search: find the most relevant material AND the connected threads around it (related projects and concepts from the knowledge graph), in one call. Use to discover how a topic links across the user's work, or for 'what's connected to X'.",
    { query: z.string().describe("topic or question"), k: z.number().optional().describe("max results, default 4") },
    async ({ query, k }) => {
      try {
        const topK = Math.min(Math.max(k ?? 4, 1), 8);
        const pool = await queryVectorStore(query, 24);
        if (pool.length === 0) return { content: [{ type: "text", text: "No matches." }] };
        const ranked = await rerank(query, pool, h => h.text.slice(0, 400));
        const top = ranked.slice(0, topK);
        const g = loadGraph();
        const connected: string[] = [];
        if (g) {
          const seen = new Set<string>();
          for (const r of top) {
            const node = gFind(g, projectOfFile(r.item.filePath));
            if (!node || seen.has(node.id)) continue; seen.add(node.id);
            const nbrs = gNbrs(g, node.id).slice(0, 6).map((n: any) => n.label);
            if (nbrs.length) connected.push(`${node.label} -> ${nbrs.join(", ")}`);
          }
        }
        const main = top.map(r => `[${r.score.toFixed(3)} ${r.item.layer}] ${r.item.filePath}\n${r.item.text.replace(/\s+/g, " ").slice(0, 400)}`).join("\n\n");
        const text = main + (connected.length ? "\n\nCONNECTED THREADS (knowledge graph):\n" + connected.map(c => "- " + c).join("\n") : "");
        log(`explore "${query.slice(0, 50)}"`);
        return { content: [{ type: "text", text }] };
      } catch (e: any) { return { content: [{ type: "text", text: `error: ${e.message}` }] }; }
    }
  );

  // ---- user_profile: structured identity recall ------------------------------
  server.tool(
    "user_profile",
    "Get the user's core identity: who they are, location, visa, education, research portfolio, expertise, active objectives, cognitive profile, and stylistic preferences. Use to ground any task in who you are working with. This is the protected ground-truth profile plus the always-on persona card.",
    {},
    async () => {
      try {
        const out: string[] = [];
        const cp = path.join(VAULT, ".claude", "memory", "core_profile.json");
        if (fs.existsSync(cp)) out.push("=== CORE PROFILE (ground truth) ===\n" + fs.readFileSync(cp, "utf-8"));
        const card = path.join(VAULT, "persona", "PROFILE.md");
        if (fs.existsSync(card)) out.push("=== PERSONA CARD ===\n" + fs.readFileSync(card, "utf-8").replace(/^---\n[\s\S]*?\n---\n/, ""));
        log("user_profile");
        return { content: [{ type: "text", text: out.join("\n\n") || "No profile found." }] };
      } catch (e: any) { return { content: [{ type: "text", text: `error: ${e.message}` }] }; }
    }
  );

  // ---- recall_persona: deep user model (semantic + structured facts) ----------
  const FACETS = ["biography", "psychology", "values", "decision", "relationship", "intellectual", "research", "voice", "quote", "health"];
  server.tool(
    "recall_persona",
    "Recall the deep, longitudinal user model synthesized from 3 years of conversation history: biography, psychology and cognition, values, decision patterns, relationships, intellectual trajectory, research identity, voice. Returns matching structured facts (with dates, confidence, provenance) AND relevant prose. Use for 'what do you know about me / my history / how I think / my background'. The clinical/health tier is quarantined: it is excluded unless you pass facet='health' or include_clinical=true.",
    {
      query: z.string().optional().describe("what to recall; omit to browse a whole facet"),
      facet: z.string().optional().describe(`optional facet filter: ${FACETS.join("|")}`),
      include_clinical: z.boolean().optional().describe("set true to include the quarantined health/clinical tier"),
    },
    async ({ query, facet, include_clinical }) => {
      try {
        const wantClinical = include_clinical === true || facet === "health";
        // structured facts
        const loadFacts = (file: string) => { try { return fs.readFileSync(path.join(VAULT, ".claude", "memory", file), "utf-8").trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
        let facts = loadFacts("persona_facts.jsonl");
        if (wantClinical) facts = facts.concat(loadFacts("persona_clinical.jsonl"));
        if (facet) facts = facts.filter((f: any) => f.facet === facet);
        if (query) { const q = query.toLowerCase(); facts = facts.filter((f: any) => (f.statement + " " + (f.sources || []).join(" ")).toLowerCase().includes(q)); }
        facts.sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0));
        const factText = facts.slice(0, 30).map((f: any) => `- [${f.facet}${f.t_event ? " " + f.t_event : ""}, conf ${f.confidence}] ${f.statement}`).join("\n");

        // semantic prose over the persona layer(s)
        let proseText = "";
        if (query) {
          const layers = wantClinical ? ["persona", "persona-clinical"] : ["persona"];
          const pool = (await queryVectorStore(query, 24)).filter(h => layers.includes(h.layer));
          if (pool.length) {
            const ranked = await rerank(query, pool, h => h.text.slice(0, 400));
            proseText = ranked.slice(0, 5).map(r => `[${r.score.toFixed(3)} ${r.item.layer}] ${r.item.filePath}\n${r.item.text.replace(/\s+/g, " ").slice(0, 500)}`).join("\n\n");
          }
        }
        log(`recall_persona q="${(query || "").slice(0, 40)}" facet=${facet || "-"} clinical=${wantClinical}`);
        const text = [factText && "STRUCTURED FACTS:\n" + factText, proseText && "PROSE:\n" + proseText].filter(Boolean).join("\n\n") || "No persona data found (has the persona layer been built and embedded?).";
        return { content: [{ type: "text", text }] };
      } catch (e: any) { return { content: [{ type: "text", text: `error: ${e.message}` }] }; }
    }
  );

  const s = stats();
  log(`server starting; vault=${VAULT}; store=${s.files} files/${s.chunks} chunks; layers=${layerStats().map(l => l.layer).join(",")}`);
  await server.connect(new StdioServerTransport());
  log("server connected (stdio)");
}

main().catch(e => { log(`fatal ${e.message}`); process.exit(1); });
