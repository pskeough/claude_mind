/**
 * LKHS bridge: Claude Mind for local models.
 *
 * A second, additive front door onto the SAME memory the Claude Code MCP server
 * serves. Nothing here modifies lkhs-mcp.ts, lkhs-daemon.ts, or the store; the
 * bridge spawns the existing lkhs-mcp.ts as a child over stdio, speaks MCP to it
 * as a client, and re-exposes a curated slice over plain localhost HTTP that any
 * harness can call: a llama.cpp tool loop, the chatui, OpenCode, a python script.
 * Because retrieval logic is never duplicated, the local model always sees exactly
 * what Claude sees; only the packaging differs.
 *
 *   local harness ---HTTP---> lkhs-bridge ---stdio MCP---> lkhs-mcp.ts (untouched)
 *
 * Why a bridge rather than registering lkhs-mcp.ts directly:
 *   1. Read-only by default. The write tools (add_intention, record_claim,
 *      seal_memory) mutate the owner's memory; an uncensored local model should
 *      not reach them unless asked (--allow-writes / LKHS_BRIDGE_WRITES=1).
 *   2. Tool budget. Sixteen tools with full descriptions is a lot of standing
 *      context for a 27B at 64k. The default core profile serves 6; full serves
 *      every read-only tool.
 *   3. Result budget. lkhs results are sized for a 200k-context Claude. One
 *      unclamped fetch_transcript can eat a third of a local window, so every
 *      result is clamped with an explicit truncation marker.
 *   4. One warm engine. The child loads fastembed plus the cross-encoder once and
 *      stays warm; a per-launch stdio server pays that load every time.
 *
 * Endpoints (127.0.0.1 only):
 *   GET  /health                          -> {ok, child, tools, calls, uptime}
 *   GET  /tools?format=openai|mcp&profile=core|full&prefix=mind_
 *   POST /call   {name, arguments}        -> {ok, content, truncated, ms}
 *   POST /search {query, k?}              -> shorthand for search_memory
 *   GET  /                                -> usage text
 *
 * Run:
 *   npm run bridge
 *   node --import tsx .claude/bin/lkhs-bridge.ts [--port 7078] [--profile full] [--allow-writes]
 */
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import { pathToFileURL } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { vaultRoot } from "./config";

const VAULT = vaultRoot();
try { if (VAULT && fs.existsSync(VAULT)) process.chdir(VAULT); } catch { /* */ }

const LOG = path.join(VAULT, ".claude", "logs", "bridge.log");
function log(m: string) {
  const line = `[${new Date().toISOString()}] ${m}`;
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, line + "\n"); } catch { /* */ }
  console.error(line);
}

// ---- flags ------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name: string, dflt?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : dflt;
};
const has = (name: string) => argv.includes(`--${name}`);

const PORT = Number(flag("port", process.env.LKHS_BRIDGE_PORT ?? "7078"));
const ALLOW_WRITES = has("allow-writes") || process.env.LKHS_BRIDGE_WRITES === "1";
const DEFAULT_PROFILE = (flag("profile", process.env.LKHS_BRIDGE_PROFILE ?? "core") || "core").toLowerCase();
const MAX_CHARS = Number(process.env.LKHS_BRIDGE_MAXCHARS ?? 4000);
const CALL_TIMEOUT_MS = Number(process.env.LKHS_BRIDGE_TIMEOUT_MS ?? 90000);

// ---- tool policy ------------------------------------------------------------
// Every lkhs tool that only reads. Anything absent is treated as a write and stays
// blocked unless ALLOW_WRITES. Listing reads explicitly, rather than blocklisting
// the three known writers, means a write tool added to lkhs-mcp.ts later is denied
// by default instead of silently exposed.
const READ_ONLY = new Set([
  "search_memory", "project_state", "timeline", "list_sessions", "fetch_transcript",
  "related", "connect", "neighborhood", "explore", "user_profile", "recall_persona",
  "list_intentions", "check_claims",
]);

// The six that answer nearly every real question, for models where context is the
// scarce resource. The full profile adds graph walking and bookkeeping.
const CORE = ["search_memory", "project_state", "timeline", "related", "recall_persona", "fetch_transcript"];

// Per-tool result clamps. fetch_transcript returns whole session bodies and
// explore/neighborhood fan out over the graph, so they get their own ceilings
// rather than inheriting a limit tuned for a search hit list.
const CLAMP: Record<string, number> = {
  fetch_transcript: 6000,
  explore: 5000,
  neighborhood: 3000,
  search_memory: 4500,
};

// Relevance floor. search_memory returns its top k unconditionally, so a query
// about something the vault has never heard of comes back with k confident-looking
// passages scored 0.000. Claude reads the score and discounts them; a 27B at Q3
// reads the prose and believes it, then rephrases and searches again forever --
// which is exactly what the eval caught. Below FLOOR an item is dropped; when
// nothing survives the model is told so in words rather than left to infer it.
//
// FLOOR is deliberately near zero. The cross-encoder saturates at 0.000 for
// genuinely unrelated passages, but it does NOT rank the low band reliably: a
// floor of 0.02 produced a false "NO MATCH" on a question whose answer sat at
// 0.008, and 0.005 did the same to a NewsBrief hit at 0.003. Each retune found
// another true positive underneath it, so the floor is now only high enough to
// catch the saturated-zero case; everything above it is returned with a
// confidence note and left to the model to read.
const FLOOR = Number(process.env.LKHS_BRIDGE_FLOOR ?? 0.001);
const WEAK = Number(process.env.LKHS_BRIDGE_WEAK ?? 0.30);

// Per-turn lookup budget, counted across ALL memory tools in a 180s window. The
// first version counted only searches, and the eval promptly showed a run that
// dodged it by alternating search_memory, recall_persona and timeline eight times.
const NUDGE_AT = Number(process.env.LKHS_BRIDGE_NUDGE_AT ?? 5);
const HARD_CAP = Number(process.env.LKHS_BRIDGE_CAP ?? 9);   // 0 disables
const WINDOW_MS = Number(process.env.LKHS_BRIDGE_WINDOW_MS ?? 180_000);
// A turn's tool calls arrive seconds apart; the next question arrives after the
// user has read an answer. So an idle gap is the turn boundary, and without this
// the budget leaks across questions -- two consecutive OpenCode questions shared
// one bucket and the second was capped after two of its own calls.
const IDLE_RESET_MS = Number(process.env.LKHS_BRIDGE_IDLE_MS ?? 30_000);

const profileTools = (profile: string): string[] =>
  profile === "full" ? [...READ_ONLY] : CORE;

function allowed(name: string, profile: string): boolean {
  if (!READ_ONLY.has(name)) return ALLOW_WRITES;
  return profileTools(profile).includes(name);
}

// ---- child MCP client -------------------------------------------------------
// Spawned lazily and kept warm. If it dies (crash, vault rebuild) the next call
// respawns it rather than failing every request from then on.
const MCP_ENTRY = path.join(VAULT, ".claude", "bin", "lkhs-mcp.ts");
const TSX_LOADER = pathToFileURL(path.join(VAULT, "node_modules", "tsx", "dist", "loader.mjs")).href;

let client: Client | null = null;
let connecting: Promise<Client> | null = null;
let toolCache: any[] = [];
let childStartedAt = 0;
let calls = 0, errors = 0;

async function connect(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", TSX_LOADER, MCP_ENTRY],
      cwd: VAULT,
      env: { ...process.env } as Record<string, string>,
      stderr: "ignore",
    });
    const c = new Client({ name: "lkhs-bridge", version: "1.0.0" }, { capabilities: {} });
    await c.connect(transport);
    const listed = await c.listTools();
    toolCache = listed.tools || [];
    childStartedAt = Date.now();
    client = c;
    // Drop the handle when the child goes away so the next call respawns instead
    // of hanging on a dead pipe.
    transport.onclose = () => { log("child mcp closed; will respawn on next call"); client = null; toolCache = []; };
    log(`child mcp up: ${toolCache.length} tools (${toolCache.map(t => t.name).join(", ")})`);
    return c;
  })();
  try { return await connecting; } finally { connecting = null; }
}

// ---- shaping ----------------------------------------------------------------
function textOf(result: any): string {
  const parts = (result?.content || []) as any[];
  return parts.filter(p => p?.type === "text").map(p => p.text).join("\n").trim();
}

function clamp(name: string, text: string): { text: string; truncated: number } {
  const limit = CLAMP[name] ?? MAX_CHARS;
  if (text.length <= limit) return { text, truncated: 0 };
  const cut = text.slice(0, limit);
  // Prefer a paragraph boundary so the model never sees a half sentence it might
  // complete as fact.
  const brk = cut.lastIndexOf("\n\n");
  const body = brk > limit * 0.6 ? cut.slice(0, brk) : cut;
  const dropped = text.length - body.length;
  return {
    text: `${body}\n\n[truncated: ${dropped} more characters. Narrow the query, lower k, or ask about one specific project or session.]`,
    truncated: dropped,
  };
}

/**
 * Drop sub-floor hits from a search_memory result and say plainly when nothing
 * relevant came back. Hit blocks look like "[0.991 project] path\ntext"; anything
 * that does not parse is passed through untouched rather than guessed at.
 */
function applyFloor(query: string, text: string): string {
  const blocks = text.split(/\n\n(?=\[\d)/);
  const scored = blocks.map(b => {
    const m = b.match(/^\[(\d+(?:\.\d+)?)\s/);
    return { block: b, score: m ? Number(m[1]) : NaN };
  });
  if (!scored.some(s => Number.isFinite(s.score))) return text;

  const best = Math.max(...scored.map(s => (Number.isFinite(s.score) ? s.score : 0)));
  const kept = scored.filter(s => !Number.isFinite(s.score) || s.score >= FLOOR);
  if (!kept.length) {
    return `NO MATCH for "${query}" - every candidate scored ${best.toFixed(4)}, meaning no relevance at all.\n`
      + `So either Claude Mind does not hold this, or the wording is too far from how it was recorded. Try ONE more query using the words the user himself would have used. If that also returns NO MATCH, tell him it is not in his memory.\n`
      + `Do not answer from the passages this would have returned; they were unrelated to the question.`;
  }
  const body = kept.map(s => s.block).join("\n\n");
  // Deliberately not suppressive. The eval had a correct answer come back at
  // 0.036 ("swim coaching struck permanently"), so telling the model to discount
  // the low band loses real recall. The useful half of the signal is "do not
  // search again", not "do not believe this".
  const head = best < WEAK
    ? `LOW CONFIDENCE (best relevance ${best.toFixed(3)}). Read these anyway; below ${WEAK} the score is unreliable and a correct answer often sits here. If none of them address the question, say the memory has nothing on it rather than searching again.\n\n`
    : "";
  return head + body + routeHint(body);
}

/**
 * Turn hit provenance into a next move. Hits are labelled with their source file
 * (journal/Claude_Personal_Conv.md), which the model reads as noise; it does not
 * infer that the file names a project it can ask about directly. In the eval it
 * found a dashboard-design hit in one project, then answered from a different
 * project's dashboard rather than opening the state card of the one that matched.
 */
function routeHint(body: string): string {
  const names = new Set<string>();
  for (const m of body.matchAll(/^\[[\d.]+\s+\w+\]\s+(?:journal|cards|library|themes)[\/\\]([^\/\\\n.]+)/gm)) {
    if (m[1]) names.add(m[1]);
  }
  if (!names.size) return "";
  // Naming the constraint explicitly, because the failure it fixes is specific:
  // across eval runs the model repeatedly pulled a project name out of a hit's
  // prose ("EmbeddingTestIsolated dashboard redesign...") and called project_state
  // on that instead of on the project the hit actually belongs to.
  return `\n\n[source projects: ${[...names].join(", ")}. Those are the only projects these hits come from. To see where one stands, call project_state with exactly one of those names. Do not pass a project name you read inside the passage text; it names something else.]`;
}

/** Project names with a state card, cached briefly; the vault is written by other processes. */
let projCache: { at: number; names: string[] } = { at: 0, names: [] };
function knownProjects(): string[] {
  if (Date.now() - projCache.at < 60_000 && projCache.names.length) return projCache.names;
  try {
    const names = fs.readdirSync(path.join(VAULT, "cards"))
      .filter(f => f.endsWith(".md")).map(f => f.replace(/\.md$/, "")).sort();
    projCache = { at: Date.now(), names };
  } catch { /* leave whatever was cached */ }
  return projCache.names;
}

/**
 * The upstream miss message lists known projects but cuts off around 700 chars,
 * so everything alphabetically past K is invisible to a model that guessed a name.
 * Replace it with near-matches first, then the complete list.
 */
function expandProjectMiss(asked: string, text: string): string {
  if (!/^No card for/i.test(text)) return text;
  const all = knownProjects();
  if (!all.length) return text;
  const q = asked.toLowerCase().replace(/[^a-z0-9]/g, "");
  const near = all.filter(n => {
    const c = n.toLowerCase().replace(/[^a-z0-9]/g, "");
    return c.includes(q) || q.includes(c);
  }).slice(0, 8);
  return `No card for "${asked}".`
    + (near.length ? `\nClosest names: ${near.join(", ")}.` : "\nNo project name resembles that one.")
    + `\n\nAll ${all.length} projects: ${all.join(", ")}`;
}

/**
 * In-band feedback when a turn is spinning on the same lookup. The model has no
 * view of its own call history, so without this it reads every unhelpful result
 * as "try another phrasing" and burns the step budget. Same idea as the chat UI's
 * GPU swap note: tell it what it is doing, in the tool result it already reads.
 */
const recent = new Map<string, { tool: string; key: string; ts: number }[]>();

/** Record this call and return the window's call count plus whether it repeats one. */
function track(session: string, tool: string, args: any) {
  const now = Date.now();
  for (const [k, v] of recent) if (!v.length || now - v[v.length - 1]!.ts > 1800_000) recent.delete(k);
  const prev = recent.get(session) || [];
  const last = prev.length ? prev[prev.length - 1]!.ts : 0;
  const newTurn = now - last > IDLE_RESET_MS;
  const arr = newTurn ? [] : prev.filter(e => now - e.ts < WINDOW_MS);
  const key = String(args?.query ?? args?.project ?? args?.concept ?? args?.session_id ?? "").toLowerCase().trim();
  const dup = !!key && arr.some(e => e.tool === tool && e.key === key);
  arr.push({ tool, key, ts: now });
  recent.set(session, arr.slice(-40));
  return { count: arr.length, dup };
}

function spinNote(count: number, dup: boolean, tool: string): string {
  if (dup) return `\n\n[you already ran this exact ${tool} this turn; the result will not change. Use what you have.]`;
  if (HARD_CAP && count >= HARD_CAP - 1) return `\n\n[${count} memory lookups this turn. This is the last one that will be answered. Write your answer now, including what you could not find.]`;
  if (count >= NUDGE_AT) return `\n\n[${count} memory lookups this turn. If several angles have not surfaced it, the memory does not have it. One or two more at most, then answer.]`;
  return "";
}

// Trigger phrasing, appended to the upstream descriptions rather than replacing
// them. A model with no ambient memory context needs to be told which ordinary
// English maps to which tool; "Claude Mind" in particular is what the user calls
// this system out loud, and nothing in the upstream text says so.
const TRIGGERS: Record<string, string> = {
  search_memory:
    ' ALWAYS call this, without asking first, when the user says "Claude Mind", "my memory", "your memory", "check my memory", "what do I know about", "did I ever", "have I", "where did I leave", "remind me", "my notes", "past sessions", "last time", or otherwise asks about his own past work, projects, decisions or preferences. This is the default first move for any question about him. Start here before project_state or timeline unless he named a project outright.',
  project_state:
    ' Call this when the user names a project, or when a search hit came from one, and you need what it is, its status, recent decisions and open threads. Use an exact project name; a wrong name returns the full list of real ones.',
  timeline:
    ' Call this for "what have I been doing", "recently", "this week", "catch me up", or to date something you found elsewhere.',
  recall_persona:
    ' Call this for how the user works, thinks, writes or prefers to be answered - not for facts about projects. Use it when he asks "how do I usually", "what do I prefer", or when you need to match his style.',
  related:
    ' Call this to find what a concept or project connects to when you do not yet know which project owns a topic.',
  fetch_transcript:
    ' Call this only when you need the exact wording of one past session and a search hit has already told you which session that is.',
};

/** MCP tool to OpenAI function-calling schema, optionally namespaced. */
function toOpenAI(t: any, prefix: string) {
  const schema = t.inputSchema && typeof t.inputSchema === "object"
    ? t.inputSchema
    : { type: "object", properties: {} };
  return {
    type: "function",
    function: { name: prefix + t.name, description: describe(t), parameters: schema },
  };
}

const describe = (t: any) => (t.description || "") + (TRIGGERS[t.name] || "");

// ---- http -------------------------------------------------------------------
const json = (res: http.ServerResponse, code: number, body: any) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(s) });
  res.end(s);
};

const readBody = (req: http.IncomingMessage) => new Promise<string>((resolve, reject) => {
  let b = "", n = 0;
  req.on("data", c => { n += c.length; if (n > 1000000) { reject(new Error("body too large")); req.destroy(); return; } b += c; });
  req.on("end", () => resolve(b));
  req.on("error", reject);
});

const USAGE = `LKHS bridge - Claude Mind for local models

  GET  /health
  GET  /tools?format=openai|mcp&profile=core|full&prefix=mind_
  POST /call    {"name":"search_memory","arguments":{"query":"...","k":5}}
  POST /search  {"query":"...","k":5}

Read-only unless started with --allow-writes. Results are clamped per tool.
`;

async function handleCall(name: string, args: any, profile: string, session = "default") {
  const bare = String(name || "").replace(/^mind_/, "");
  // Existence before policy: a typo'd name would otherwise be reported as a
  // blocked write tool, which sends the model looking for a permission flag
  // instead of re-reading the tool list.
  // Budget first: a model that has already asked nine times is not going to be
  // rescued by a tenth result, and the refusal is what actually ends the loop.
  // The window is short and per-session, so a genuinely long task resumes shortly.
  const { count, dup } = track(session, bare, args);
  if (HARD_CAP && count > HARD_CAP) {
    return {
      ok: false, truncated: 0, ms: 0,
      content: `Memory lookup budget reached: ${count - 1} calls in this turn. No further lookups will be served for about three minutes.\n`
        + `Answer the user now from what you already retrieved, and state plainly what you could not find. Do not apologise for the limit or mention it.`,
    };
  }

  const c = await connect();
  if (!toolCache.some(t => t.name === bare)) {
    return { ok: false, content: `unknown tool: ${bare}. Available here: ${profileTools(profile).join(", ")}`, truncated: 0, ms: 0 };
  }
  if (!allowed(bare, profile)) {
    const why = READ_ONLY.has(bare)
      ? `not served by the '${profile}' profile (try profile=full)`
      : "a write tool, and the bridge is read-only unless started with --allow-writes";
    return { ok: false, content: `refused: ${bare} is ${why}.`, truncated: 0, ms: 0 };
  }
  const t0 = Date.now();
  let raw: any;
  try {
    raw = await Promise.race([
      c.callTool({ name: bare, arguments: args || {} }),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS)),
    ]);
  } catch (e: any) {
    errors++;
    log(`call ${bare} failed: ${e?.message}`);
    return { ok: false, content: `error calling ${bare}: ${e?.message}`, truncated: 0, ms: Date.now() - t0 };
  }
  let out = textOf(raw) || "(empty result)";
  if (bare === "search_memory") out = applyFloor(String(args?.query ?? ""), out);
  if (bare === "project_state") out = expandProjectMiss(String(args?.project ?? ""), out);
  const { text, truncated } = clamp(bare, out);
  const content = text + spinNote(count, dup, bare);
  calls++;
  log(`call ${bare} ${Date.now() - t0}ms ${content.length}c${truncated ? ` (-${truncated})` : ""}`);
  return { ok: !raw?.isError, content, truncated, ms: Date.now() - t0 };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const profile = (u.searchParams.get("profile") || DEFAULT_PROFILE).toLowerCase();

    if (u.pathname === "/health") {
      let child = "down";
      try { await connect(); child = "up"; } catch (e: any) { child = `error: ${e.message}`; }
      return json(res, 200, {
        ok: child === "up", child, vault: VAULT, port: PORT,
        profile: DEFAULT_PROFILE, writes: ALLOW_WRITES,
        tools: toolCache.map(t => t.name),
        served: profileTools(DEFAULT_PROFILE),
        calls, errors,
        childUptimeSec: childStartedAt ? Math.round((Date.now() - childStartedAt) / 1000) : 0,
      });
    }

    if (u.pathname === "/tools") {
      await connect();
      const want = new Set(profileTools(profile));
      if (ALLOW_WRITES && profile === "full") for (const t of toolCache) want.add(t.name);
      const picked = toolCache.filter(t => want.has(t.name));
      const prefix = u.searchParams.get("prefix") || "";
      // The MCP branch feeds OpenCode, so it needs the trigger phrasing too.
      if ((u.searchParams.get("format") || "openai") === "mcp") {
        return json(res, 200, { tools: picked.map(t => ({ ...t, description: describe(t) })) });
      }
      return json(res, 200, { tools: picked.map(t => toOpenAI(t, prefix)) });
    }

    // `session` scopes the spin counter. Clients that pass their own conversation
    // id get per-conversation damping; everyone else shares "default", which is
    // right when one local model is answering one question at a time.
    if (u.pathname === "/call" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const sess = String(body.session || u.searchParams.get("session") || "default");
      return json(res, 200, await handleCall(body.name, body.arguments ?? body.args ?? {}, profile, sess));
    }

    if (u.pathname === "/search" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      return json(res, 200, await handleCall("search_memory", { query: body.query, k: body.k ?? 5, layer: body.layer },
        profile, String(body.session || "default")));
    }

    if (u.pathname === "/") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end(USAGE);
    }

    return json(res, 404, { ok: false, error: "no such route", usage: USAGE });
  } catch (e: any) {
    errors++;
    log(`request error: ${e?.stack || e?.message}`);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  log(`bridge listening on http://127.0.0.1:${PORT} (profile=${DEFAULT_PROFILE}, writes=${ALLOW_WRITES}, vault=${VAULT})`);
  // Warm the child now so the first model call is not the one that pays the
  // embedding-model load.
  connect().catch(e => log(`warmup failed: ${e.message}`));
});

const bye = () => { try { client?.close(); } catch { /* */ } process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
