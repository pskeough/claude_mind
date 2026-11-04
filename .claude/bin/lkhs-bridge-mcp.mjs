/**
 * Thin stdio MCP shim in front of the LKHS bridge.
 *
 * OpenCode (and any other MCP client that wants a local command rather than an
 * HTTP endpoint) talks to this; it forwards to http://127.0.0.1:7078 and returns
 * whatever the bridge says. It deliberately holds no state and loads no models,
 * so it starts in milliseconds -- the warm engine lives once, in the bridge, and
 * is shared by every local front end.
 *
 * Plain .mjs rather than .ts on purpose: no tsx loader means no compile step on
 * a path that runs every time the TUI launches.
 *
 * Register in ~/.config/opencode/opencode.jsonc:
 *   "mcp": { "mind": { "type": "local", "enabled": true,
 *     "command": ["node", "<vault>/.claude/bin/lkhs-bridge-mcp.mjs"] } }
 *
 * Env:
 *   LKHS_BRIDGE_URL       default http://127.0.0.1:7078
 *   LKHS_BRIDGE_PROFILE   core | full   (default core)
 *   LKHS_BRIDGE_NOSPAWN=1 do not auto-start the bridge if it is down
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.resolve(HERE, "..", "..");
const BASE = process.env.LKHS_BRIDGE_URL || "http://127.0.0.1:7078";
const PROFILE = process.env.LKHS_BRIDGE_PROFILE || "core";
// One shim process per client session, so a per-process id keeps this client's
// lookup budget separate from the chat UI's and from any other MCP client.
const SESSION = `mcp-${process.pid}`;

const err = (m) => process.stderr.write(`[lkhs-bridge-mcp] ${m}\n`);

async function health(ms = 1500) {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(ms) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/**
 * Start the bridge detached if nothing is listening. Two shims racing here means
 * the loser dies on EADDRINUSE while the winner serves both, which is why the
 * result is polled rather than trusted.
 */
async function ensureBridge() {
  if (await health()) return true;
  if (process.env.LKHS_BRIDGE_NOSPAWN === "1") return false;
  err("bridge down, starting it");
  const loader = pathToFileURL(path.join(VAULT, "node_modules", "tsx", "dist", "loader.mjs")).href;
  spawn(process.execPath, ["--import", loader, path.join(HERE, "lkhs-bridge.ts")], {
    cwd: VAULT, detached: true, stdio: "ignore", windowsHide: true,
  }).unref();
  for (let i = 0; i < 40; i++) {                       // the child loads an embedding model
    await new Promise(r => setTimeout(r, 750));
    if (await health()) { err("bridge up"); return true; }
  }
  err("bridge did not come up in 30s");
  return false;
}

const server = new Server({ name: "lkhs-mind", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (!(await ensureBridge())) return { tools: [] };
  try {
    const r = await fetch(`${BASE}/tools?format=mcp&profile=${PROFILE}`, { signal: AbortSignal.timeout(10_000) });
    const j = await r.json();
    return { tools: j.tools || [] };
  } catch (e) {
    err(`listTools failed: ${e.message}`);
    return { tools: [] };
  }
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (!(await ensureBridge())) {
    return { isError: true, content: [{ type: "text", text: `Claude Mind bridge is not running at ${BASE}. Start it with: npm run bridge (in the ClaudeMind vault).` }] };
  }
  try {
    const r = await fetch(`${BASE}/call?profile=${PROFILE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, arguments: args || {}, session: SESSION }),
      signal: AbortSignal.timeout(120_000),
    });
    const j = await r.json();
    return { isError: !j.ok, content: [{ type: "text", text: j.content ?? j.error ?? "(no content)" }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `bridge call failed: ${e.message}` }] };
  }
});

await server.connect(new StdioServerTransport());
err(`connected (bridge=${BASE}, profile=${PROFILE})`);
