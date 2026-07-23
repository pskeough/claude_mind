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
import { vaultRoot, personaHalfLifeDays } from "./config";
import { withTemporalDefaults } from "./persona-facts";
import { redact, toAscii } from "./capture-session";
import { loadIntentions, addIntention } from "./prospective";

// Resolve the vault (env > config.centralVault > derived) and chdir so cwd matches
// the vault; the engine resolves paths via config regardless, this just keeps them aligned.
const VAULT = vaultRoot();
try { if (VAULT && fs.existsSync(VAULT)) process.chdir(VAULT); } catch { /* */ }

const LOG = path.join(VAULT, ".claude", "logs", "ambient.log");
function log(m: string) { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] mcp:${m}\n`); } catch { /* */ } }

// ---- persona fact loading (shared with the eval harness) ---------------------
// This is the ONLY query path over persona_facts.jsonl; eval-memory.ts imports it
// directly so the harness measures exactly what recall_persona serves.
export interface PersonaFact {
  id: string; facet: string; statement: string; t_event?: string; confidence?: number;
  sensitivity?: string; sources?: string[]; created?: string;
  key?: string; valid_at?: string; invalid_at?: string | null; supersedes?: string[];
  [k: string]: any;
}

/** Parse a fact date ("2024" | "2024-05" | "2024-05-12") to ms; NaN if absent/bad. */
const factDateMs = (s?: string | null): number => {
  if (!s) return NaN;
  const m = String(s).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return NaN;
  return Date.UTC(+m[1]!, m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1);
};

export function recallPersonaFacts(opts: {
  query?: string; facet?: string; includeClinical?: boolean;
  /** query validity at this ISO date instead of today (bi-temporal "as of") */
  asOf?: string;
  /** include facts whose invalid_at has passed (default false) */
  includeSuperseded?: boolean;
} = {}): PersonaFact[] {
  const wantClinical = opts.includeClinical === true || opts.facet === "health";
  const loadFacts = (file: string) => { try { return fs.readFileSync(path.join(VAULT, ".claude", "memory", file), "utf-8").trim().split(/\r?\n/).filter(Boolean).map(l => withTemporalDefaults(JSON.parse(l))); } catch { return []; } };
  let facts: PersonaFact[] = loadFacts("persona_facts.jsonl");
  if (wantClinical) facts = facts.concat(loadFacts("persona_clinical.jsonl"));
  if (opts.facet) facts = facts.filter((f: any) => f.facet === opts.facet);
  if (opts.query) { const q = opts.query.toLowerCase(); facts = facts.filter((f: any) => (f.statement + " " + (f.sources || []).join(" ")).toLowerCase().includes(q)); }

  // validity filter: drop facts invalid at the reference date unless the caller
  // opts back in. Missing invalid_at (all pre-temporal facts) means "valid".
  const refIso = opts.asOf || new Date().toISOString().slice(0, 10);
  const refMs = factDateMs(refIso);
  if (!opts.includeSuperseded) {
    facts = facts.filter((f: any) => { const inv = factDateMs(f.invalid_at); return isNaN(inv) || inv > refMs; });
    // with an explicit as_of, also drop facts not yet valid at that date
    if (opts.asOf) facts = facts.filter((f: any) => { const va = factDateMs(f.valid_at); return isNaN(va) || va <= refMs; });
  }

  // recency-decayed confidence sort: score = confidence * exp(-ageDays / halflife).
  // Undated facts decay from `created`; ties fall back to raw confidence.
  const HALFLIFE = personaHalfLifeDays();
  const score = (f: any) => {
    const born = factDateMs(f.valid_at || f.t_event || f.created);
    const ageDays = isNaN(born) ? 0 : Math.max(0, (refMs - born) / 86_400_000);
    return (f.confidence || 0) * Math.exp(-ageDays / HALFLIFE);
  };
  facts.sort((a: any, b: any) => score(b) - score(a) || (b.confidence || 0) - (a.confidence || 0));
  return facts;
}

// ---- session ledger + raw transcript access ----------------------------------
// The capture pipeline embeds only ~250-word summaries; the raw .jsonl transcripts
// stay in ~/.claude/projects. These helpers make them navigable: the ledger maps
// sessionId -> title/project/transcript path, and readTranscriptTurns re-parses a
// transcript into readable turns for on-demand fetch (L0 under the summaries).

export interface LedgerEntry {
  sessionId: string; project: string; cwd: string; event: string; lineCount: number;
  at: string; sessionStart?: string | null; sessionEnd?: string | null;
  title?: string; transcript?: string;
}

const LEDGER_FILE = path.join(VAULT, "journal", "_sessions.jsonl");
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

/** All ledger entries, deduped by sessionId (last capture wins), newest session
 *  first. LKHS's own automation runs (summarizers, card/theme builders) captured
 *  before the signature list covered them are filtered out by title. */
const AUTOMATION_TITLE = /BEGIN_(SESSION_LOG|PROJECT_DIGEST|CLUSTER_SOURCE|PROJECT_CARD_SOURCE)|archivist instructions|LKHS (ambient compile pass|pipeline:)/;
export function readLedger(): LedgerEntry[] {
  let lines: string[] = [];
  try { lines = fs.readFileSync(LEDGER_FILE, "utf-8").split("\n").filter(Boolean); } catch { return []; }
  const byId = new Map<string, LedgerEntry>();
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (e.sessionId && !AUTOMATION_TITLE.test(e.title || "")) byId.set(e.sessionId, e);
    } catch { /* skip */ }
  }
  return [...byId.values()].sort((a, b) => (b.sessionStart || b.at || "").localeCompare(a.sessionStart || a.at || ""));
}

/** Resolve a session id (full or >=6-char prefix) to its raw transcript file.
 *  Prefers the ledger's recorded path; falls back to scanning ~/.claude/projects
 *  (covers pre-pointer ledger entries and uncaptured sessions). */
export function findTranscript(idPrefix: string, ledger?: LedgerEntry[]): { file: string; entry?: LedgerEntry } | null {
  const want = idPrefix.trim().toLowerCase();
  if (want.length < 6) return null;
  const entry = (ledger ?? readLedger()).find(e => e.sessionId.toLowerCase().startsWith(want));
  if (entry?.transcript && fs.existsSync(entry.transcript)) return { file: entry.transcript, entry };
  try {
    for (const dir of fs.readdirSync(PROJECTS_DIR)) {
      const abs = path.join(PROJECTS_DIR, dir);
      let files: string[] = [];
      try { if (!fs.statSync(abs).isDirectory()) continue; files = fs.readdirSync(abs); } catch { continue; }
      const hit = files.find(f => f.endsWith(".jsonl") && f.toLowerCase().startsWith(want));
      if (hit) return { file: path.join(abs, hit), entry };
    }
  } catch { /* projects dir missing */ }
  return null;
}

/** Parse a transcript .jsonl into readable turns (user text, assistant text, tool
 *  calls/results), redacted and ASCII-normalized. No whole-file cap: callers slice. */
export function readTranscriptTurns(file: string): string[] {
  const turns: string[] = [];
  const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
  for (const line of lines) {
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    const ts = typeof o.timestamp === "string" ? o.timestamp.slice(0, 16).replace("T", " ") : "";
    if (o.type === "user" && typeof o.message?.content === "string") {
      const t = o.message.content.trim();
      if (!t || t.startsWith("<")) continue; // injected/system-shaped content
      turns.push(`USER${ts ? ` [${ts}]` : ""}: ${t.slice(0, 4000)}`);
    } else if (o.type === "user" && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b.type !== "tool_result") continue;
        let rc = "";
        if (typeof b.content === "string") rc = b.content;
        else if (Array.isArray(b.content)) rc = b.content.map((x: any) => (typeof x === "string" ? x : x?.text || "")).join(" ");
        rc = rc.replace(/\s+/g, " ").trim();
        if (rc) turns.push(`[${b.is_error ? "error" : "result"}] ${rc.slice(0, 600)}`);
      }
    } else if (o.type === "assistant" && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b.type === "text" && b.text?.trim()) turns.push(`CLAUDE${ts ? ` [${ts}]` : ""}: ${b.text.trim().slice(0, 4000)}`);
        else if (b.type === "tool_use") {
          const hint = b.input?.file_path || b.input?.command || b.input?.pattern || b.input?.description || "";
          turns.push(`[tool:${b.name}] ${String(hint).slice(0, 200)}`.trim());
        }
      }
    }
  }
  return turns.map(t => toAscii(redact(t)));
}

/** Slice turns for output: query -> windows of +-context turns around each match
 *  (merged when overlapping); no query -> the tail. Always capped at maxChars. */
export function sliceTurns(turns: string[], query: string | undefined, maxChars: number, context = 3): string {
  if (!turns.length) return "";
  let picked: Array<{ i: number; gap?: boolean }> = [];
  if (query?.trim()) {
    const q = query.toLowerCase();
    const hits = turns.map((t, i) => (t.toLowerCase().includes(q) ? i : -1)).filter(i => i >= 0);
    if (!hits.length) return "";
    const idx = new Set<number>();
    for (const h of hits) for (let i = Math.max(0, h - context); i <= Math.min(turns.length - 1, h + context); i++) idx.add(i);
    const sorted = [...idx].sort((a, b) => a - b);
    picked = sorted.map((i, n) => ({ i, gap: n > 0 && i - sorted[n - 1]! > 1 }));
  } else {
    picked = turns.map((_, i) => ({ i }));
  }
  // Assemble from the end (recent-first budget) then restore order.
  const parts: string[] = [];
  let used = 0;
  for (let n = picked.length - 1; n >= 0; n--) {
    const seg = (picked[n]!.gap ? "[...]\n" : "") + turns[picked[n]!.i];
    if (used + seg.length > maxChars) {
      if (parts.length === 0) {
        // The newest turn alone blows the budget: truncate it rather than return nothing.
        parts.push("[...truncated...] " + seg.slice(seg.length - maxChars));
        if (n > 0) parts.push(`[... ${n} earlier turns omitted ...]`);
      } else {
        parts.push(`[... ${n + 1} earlier turns omitted ...]`);
      }
      break;
    }
    parts.push(seg); used += seg.length + 1;
  }
  return parts.reverse().join("\n");
}

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
    { project: z.string().describe("project name, e.g. MyProject") },
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
    "Recent session history for a project (or across all projects if none given), most recent first. Each entry: date, title, and the summary. Use to see what happened lately. Each entry header carries a short session id; pass it to fetch_transcript to read the full raw conversation behind a summary.",
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

  // ---- list_sessions: browse the capture ledger --------------------------------
  server.tool(
    "list_sessions",
    "List every captured Claude Code session across ALL projects, most recent first: date, project, session id, first-prompt title. This is the master index of past conversations. Use it to locate a specific past chat (filter by project and/or a title keyword), then call fetch_transcript with the session id to read what was actually said. For summarized history prefer timeline; use this when you need to find or enumerate raw sessions.",
    {
      project: z.string().optional().describe("filter to one project (fuzzy name match)"),
      query: z.string().optional().describe("case-insensitive substring over session titles"),
      limit: z.number().optional().describe("max sessions, default 20")
    },
    async ({ project, query, limit }) => {
      try {
        const lim = Math.min(Math.max(limit ?? 20, 1), 100);
        let entries = readLedger();
        if (project) { const w = canonKey(project); entries = entries.filter(e => canonKey(e.project).includes(w) || w.includes(canonKey(e.project))); }
        if (query) { const q = query.toLowerCase(); entries = entries.filter(e => (e.title || "").toLowerCase().includes(q)); }
        const total = entries.length;
        const out = entries.slice(0, lim).map(e => {
          const date = (e.sessionStart || e.at || "").slice(0, 16).replace("T", " ");
          return `${date}  ${e.project}  ${e.sessionId.slice(0, 8)}  ${(e.title || "").replace(/\s+/g, " ").slice(0, 90)}`;
        }).join("\n");
        log(`list_sessions project=${project || "-"} q="${(query || "").slice(0, 30)}" -> ${total}`);
        return { content: [{ type: "text", text: out ? `${total} session(s)${total > lim ? `, showing ${lim}` : ""}:\n${out}` : "No sessions match." }] };
      } catch (e: any) { return { content: [{ type: "text", text: `error: ${e.message}` }] }; }
    }
  );

  // ---- fetch_transcript: raw conversation behind a summary ---------------------
  server.tool(
    "fetch_transcript",
    "Read the RAW transcript of a past Claude Code session: the actual user/assistant turns, tool calls, and results, not the 250-word summary. Pass a session id (or its first 8+ characters) from list_sessions, timeline, or a journal entry header like '(sweep, session e0f5ee27)'. With a query, returns only the passages around matches across the WHOLE session; without one, returns the most recent portion. Use whenever a session summary is not enough: exact wording, a command that was run, an error message, a decision's full context.",
    {
      session_id: z.string().describe("session id or unique prefix (>= 6 chars)"),
      query: z.string().optional().describe("return only turns matching this (case-insensitive substring), with surrounding context"),
      max_chars: z.number().optional().describe("output budget, default 20000, max 60000")
    },
    async ({ session_id, query, max_chars }) => {
      try {
        const budget = Math.min(Math.max(max_chars ?? 20_000, 1_000), 60_000);
        const hit = findTranscript(session_id);
        if (!hit) return { content: [{ type: "text", text: `No transcript found for session "${session_id}". Ids need >= 6 chars; find them via list_sessions or timeline.` }] };
        const turns = readTranscriptTurns(hit.file);
        if (!turns.length) return { content: [{ type: "text", text: "Transcript exists but contains no readable turns." }] };
        const body = sliceTurns(turns, query, budget);
        if (!body) return { content: [{ type: "text", text: `No turns matching "${query}" in that session (${turns.length} turns total). Try fetching without a query.` }] };
        const e = hit.entry;
        const header = e
          ? `Session ${e.sessionId.slice(0, 8)} | ${e.project} | ${(e.sessionStart || e.at || "").slice(0, 16).replace("T", " ")} | ${(e.title || "").slice(0, 80)}\n(${turns.length} turns${query ? `, filtered by "${query}"` : ", most recent shown"})\n\n`
          : `Session ${session_id} (uncaptured; raw transcript)\n(${turns.length} turns${query ? `, filtered by "${query}"` : ", most recent shown"})\n\n`;
        log(`fetch_transcript ${session_id.slice(0, 8)} q="${(query || "").slice(0, 30)}" turns=${turns.length}`);
        return { content: [{ type: "text", text: header + body }] };
      } catch (e: any) { log(`fetch_transcript err ${e.message}`); return { content: [{ type: "text", text: `error: ${e.message}` }] }; }
    }
  );

  // ---- prospective memory: forward-pointing reminders ---------------------------
  server.tool(
    "add_intention",
    "Store a prospective-memory intention: a reminder that fires ONCE when its condition becomes true, in any future session. Use when the user says 'remind me when/next time...', or when a session ends with a concrete deferred commitment worth resurfacing. Trigger types: project (fires on next prompt from that project), entity (fires when a prompt mentions the phrase), date (fires on the first prompt on/after YYYY-MM-DD).",
    {
      trigger_type: z.enum(["project", "entity", "date"]).describe("what kind of condition"),
      trigger_value: z.string().describe("project name, entity phrase, or YYYY-MM-DD"),
      note: z.string().describe("the reminder text to surface when it fires")
    },
    async ({ trigger_type, trigger_value, note }) => {
      try {
        const it = addIntention({ type: trigger_type, value: trigger_value }, note, "mcp");
        log(`add_intention ${trigger_type}:${trigger_value}`);
        return { content: [{ type: "text", text: it ? `Stored intention ${it.id}: [${trigger_type}:${trigger_value}] ${it.note}` : "Not stored (invalid trigger/date format, note too short, or duplicate of an unfired intention)." }] };
      } catch (e: any) { return { content: [{ type: "text", text: `error: ${e.message}` }] }; }
    }
  );

  server.tool(
    "list_intentions",
    "List prospective-memory intentions: pending (waiting for their trigger) and recently fired. Use to review or check what reminders are set.",
    { include_fired: z.boolean().optional().describe("also show fired intentions (default false)") },
    async ({ include_fired }) => {
      try {
        const all = loadIntentions();
        const pending = all.filter(i => !i.fired_at);
        const fired = all.filter(i => i.fired_at).slice(-10);
        const fmt = (i: any) => `- ${i.id} [${i.when.type}:${i.when.value}] ${i.note} (set ${i.created.slice(0, 10)}${i.fired_at ? `, fired ${i.fired_at.slice(0, 10)}` : ""})`;
        const out = [`PENDING (${pending.length}):`, ...pending.map(fmt)];
        if (include_fired && fired.length) out.push("", "RECENTLY FIRED:", ...fired.map(fmt));
        return { content: [{ type: "text", text: out.join("\n") }] };
      } catch (e: any) { return { content: [{ type: "text", text: `error: ${e.message}` }] }; }
    }
  );

  // ---- claims ledger: verified research numbers -----------------------------------
  server.tool(
    "record_claim",
    "Record a VERIFIED research claim in the claims ledger (research work only: papers, analyses, benchmarks). Use after verifying a number against raw data (e.g. during a paper claim audit): the ledger is the single source of truth for load-bearing stats, so stale values stop circulating in drafts. To correct an existing claim, pass supersedes with the old claim's id; the old row is marked stale automatically.",
    {
      paper: z.string().describe("which paper/project, e.g. MyPaper"),
      claim: z.string().describe("the assertion, self-contained, e.g. 'Total judge calls across four models'"),
      value: z.string().describe("the load-bearing number exactly as it should appear, e.g. 'N=28,800'"),
      source: z.string().describe("file path or artifact that verifies it, e.g. assets/stats/final_counts.json"),
      status: z.enum(["verified", "corrected", "unverifiable"]).describe("audit verdict"),
      note: z.string().optional(),
      supersedes: z.string().optional().describe("id of the claim this corrects")
    },
    async ({ paper, claim, value, source, status, note, supersedes }) => {
      try {
        const { addClaim } = await import("./claims");
        const row = addClaim({ paper, claim, value, source, status, note, supersedes });
        log(`record_claim ${paper}: ${value}`);
        return { content: [{ type: "text", text: row ? `Recorded ${row.id}: [${row.paper}] ${row.claim} = ${row.value} (${row.status}, source ${row.source})` : "Not recorded: paper, claim, value, and source are all required." }] };
      } catch (e: any) { return { content: [{ type: "text", text: `error: ${e.message}` }] }; }
    }
  );

  server.tool(
    "check_claims",
    "Check draft text or a topic against the verified-claims ledger. Pass a passage (or a topic query) and optionally the paper name; returns matching verified claims AND collisions: places where the passage's numbers do not include the ledger's verified value for the same claim (likely stale stat in the draft). Use BEFORE asserting any load-bearing number in paper writing, and when editing results/methods sections.",
    {
      text: z.string().describe("draft passage or topic to check"),
      paper: z.string().optional().describe("restrict to one paper")
    },
    async ({ text, paper }) => {
      try {
        const { checkClaims } = await import("./claims");
        const { matches, collisions } = checkClaims(text, paper);
        if (!matches.length) return { content: [{ type: "text", text: "No ledger claims match this text. (Ledger may not cover this topic yet; record verified numbers with record_claim.)" }] };
        const out: string[] = [];
        if (collisions.length) {
          out.push("POSSIBLE STALE NUMBERS (ledger value absent from passage):");
          for (const c of collisions) out.push(`- [${c.claim.paper}] ${c.claim.claim} = ${c.claim.value} (verified ${c.claim.verified}, ${c.claim.source}); passage has: ${c.foundInQuery}`);
          out.push("");
        }
        out.push(`Matching ledger claims (${matches.length}):`);
        for (const m of matches) out.push(`- ${m.id} [${m.paper}, ${m.status}] ${m.claim} = ${m.value} (verified ${m.verified}, ${m.source})${m.note ? ` - ${m.note}` : ""}`);
        log(`check_claims paper=${paper || "-"} matches=${matches.length} collisions=${collisions.length}`);
        return { content: [{ type: "text", text: out.join("\n") }] };
      } catch (e: any) { return { content: [{ type: "text", text: `error: ${e.message}` }] }; }
    }
  );

  // ---- sealed memory: consented forgetting --------------------------------------
  server.tool(
    "seal_memory",
    "Seal or unseal a memory file. A SEALED file stays stored but never surfaces in retrieval or injection until unsealed or explicitly requested; use when the user wants painful or sensitive material to rest without deleting it ('stop bringing X up', 'let that rest', 'seal that'). action=list shows current seals. Sealing is reversible and never deletes anything.",
    {
      action: z.enum(["seal", "unseal", "list"]).describe("what to do"),
      file: z.string().optional().describe("store-relative path, e.g. journal/SomeProject.md (required for seal/unseal)")
    },
    async ({ action, file }) => {
      try {
        const { sealedFile, sealedSet } = await import("./store");
        const p = sealedFile();
        const current = [...sealedSet()];
        if (action === "list") return { content: [{ type: "text", text: current.length ? `Sealed (${current.length}):\n${current.map(f => `- ${f}`).join("\n")}` : "Nothing is sealed." }] };
        if (!file) return { content: [{ type: "text", text: "file is required for seal/unseal." }] };
        const norm = file.replace(/\\/g, "/");
        const next = action === "seal" ? [...new Set([...current, norm])] : current.filter(f => f !== norm);
        fs.writeFileSync(p, JSON.stringify({ files: next }, null, 2), "utf-8");
        log(`seal_memory ${action} ${norm}`);
        return { content: [{ type: "text", text: `${action === "seal" ? "Sealed" : "Unsealed"} ${norm}. Now sealed: ${next.length} file(s). Takes effect immediately (store reload is mtime-triggered).` }] };
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
      as_of: z.string().optional().describe("ISO date: recall what was true AT this date (bi-temporal); default today"),
      include_superseded: z.boolean().optional().describe("set true to include facts that have been superseded/invalidated (default false)"),
    },
    async ({ query, facet, include_clinical, as_of, include_superseded }) => {
      try {
        const wantClinical = include_clinical === true || facet === "health";
        // structured facts (shared loader; validity-filtered + recency-decayed sort)
        const facts = recallPersonaFacts({ query, facet, includeClinical: include_clinical, asOf: as_of, includeSuperseded: include_superseded });
        const factLine = (f: any) => `- [${f.facet}${f.t_event ? " " + f.t_event : ""}, conf ${f.confidence}${f.invalid_at ? `, SUPERSEDED ${f.invalid_at}` : ""}] ${f.statement}`;
        let factText = facts.slice(0, 30).map(factLine).join("\n");

        // semantic prose over the persona layer(s); fact hits ride the same pool
        let proseText = "";
        if (query) {
          const layers = wantClinical ? ["persona", "persona-clinical"] : ["persona"];
          const merged = await queryVectorStore(query, 24);
          // P2 embedded fact path: semantic fact hits (layer "fact", validity- and
          // quarantine-filtered inside factKnn) augment the substring match above.
          // Clinical facts never surface here even with include_clinical; the
          // substring path already covers the opted-in clinical tier.
          if (!facet) {
            const seen = new Set(facts.map((f: any) => f.key));
            const semFacts = merged.filter(h => h.layer === "fact" && h.factKey && !seen.has(h.factKey)).slice(0, 10);
            if (semFacts.length) factText = [factText, ...semFacts.map(h => `- [semantic ${h.score.toFixed(3)}] ${h.text}`)].filter(Boolean).join("\n");
          }
          const pool = merged.filter(h => layers.includes(h.layer!));
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

// Guard so importing this module (eval-memory.ts uses recallPersonaFacts) does not
// start the stdio server; behavior when launched directly is unchanged.
if (require.main === module) main().catch(e => { log(`fatal ${e.message}`); process.exit(1); });
