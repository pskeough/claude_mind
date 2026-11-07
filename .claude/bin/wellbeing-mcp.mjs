#!/usr/bin/env node
/**
 * wellbeing-mcp.mjs - the wellbeing module's front door for Claude Desktop.
 *
 * Claude Desktop has no hooks, so this local stdio MCP server stands in for
 * them. Her personal preferences ask Claude to call wellbeing_pulse at the start
 * of every reply. Each pulse logs one row (time, a chat id, the word count of
 * her message; never the text) to .claude/memory/rhythm/desktop-pulses.jsonl,
 * which the nightly scan reads alongside Claude Code transcripts. The pulse
 * answers with the local time and, only when it matters, the pacing-mode or
 * check-in block. Most pulses return one line.
 *
 * Registered in claude_desktop_config.json by scripts/install-wellbeing.mjs.
 * Plain node; the MCP SDK and zod come from the vault's node_modules.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { rhythmConfig, paths, readJsonl, dayKey, activeSelfReport } from "./rhythm-core.mjs";
import { rhythmBlock } from "./rhythm-hook.mjs";

const VAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = paths(VAULT);
const RHYTHM = path.join(VAULT, ".claude", "bin", "rhythm.mjs");
const SKILL = path.join(VAULT, "extras", "skills", "mind-companion");
const GUIDE = path.join(VAULT, "extras", "wellbeing", "desktop-guide.md");

const text = (s) => ({ content: [{ type: "text", text: s }] });
const cli = (...args) => {
  const r = spawnSync(process.execPath, [RHYTHM, ...args], { cwd: VAULT, encoding: "utf8", timeout: 60_000 });
  return (r.stdout || "") + (r.status ? `\n${r.stderr || ""}` : "");
};
const clock = () => new Date().toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

let instructions = "";
try { instructions = fs.readFileSync(GUIDE, "utf8"); } catch {}
const server = new McpServer({ name: "mind-wellbeing", version: "1.0.0" }, { instructions });

server.tool(
  "wellbeing_pulse",
  "Call this at the start of EVERY reply, before writing anything, as the owner asked in her preferences. Logs that she sent a message (time, chat id, word count only; never the text) and returns the local time plus, rarely, a wellbeing note you must follow. Usually it returns one line; just carry on.",
  {
    chat: z.string().describe("a short id you invent at the start of this conversation and reuse for every pulse in it, e.g. 'k7-garden-plan'"),
    words: z.number().describe("approximate word count of her latest message"),
  },
  async ({ chat, words }) => {
    const cfg = rhythmConfig(VAULT);
    if (!cfg.enabled) return text(`Local time ${clock()}.`);
    const now = Date.now();
    const session = `desktop:${String(chat).slice(0, 60)}`;
    const today = dayKey(now, cfg.dayStartHour);
    const seenToday = readJsonl(P.pulses).some((r) => r.session === session && dayKey(r.t, cfg.dayStartHour) === today);
    fs.mkdirSync(P.dir, { recursive: true });
    fs.appendFileSync(P.pulses, JSON.stringify({ t: now, words: Math.max(0, Math.round(words || 0)), session, src: "desktop" }) + "\n");
    // the full block once per chat; later pulses in the same chat stay quiet
    if (!seenToday) {
      const block = rhythmBlock(VAULT, { via: "mcp" });
      if (block) return text(block);
    } else if (activeSelfReport(VAULT)) {
      return text(`Local time ${clock()}. Pacing mode still on (see earlier in this chat).`);
    }
    return text(`Local time ${clock()}.`);
  }
);

server.tool(
  "wellbeing_note",
  "Record how she says she is, in her words. Use when she says she is manic, hypomanic, high, flying, mixed, low, crashing, or that she is ok again. manic/hypomanic/mixed turn on pacing mode (5 days unless she names a period); ok turns it off; note just records.",
  {
    state: z.enum(["manic", "hypomanic", "mixed", "low", "ok", "note"]),
    her_words: z.string().optional().describe("what she said, one line"),
    until: z.string().optional().describe("a period she named, like 3d or 12h"),
  },
  async ({ state, her_words, until }) => text(cli("note", "--state", state, ...(until ? ["--until", until] : []), ...(her_words ? [her_words] : [])))
);

server.tool(
  "wellbeing_checkin_done",
  "Record that the one check-in happened, so nothing raises it again for several days. Call after you raised it, whatever she said.",
  { outcome: z.enum(["talked", "declined", "not-now"]) },
  async ({ outcome }) => text(cli("ack", "--outcome", outcome))
);

server.tool(
  "wellbeing_status",
  "Her usage-rhythm record and her own plan. Use when she asks 'how have I been', 'look at my pattern', or before raising anything about mood, and when helping her fill in her plan.",
  {},
  async () => {
    cli("scan");
    const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
    const exp = readJsonl(P.exported);
    const lastExport = exp.length ? new Date(exp.at(-1).t).toISOString().slice(0, 10) : null;
    return text([
      cli("status").trim(),
      read(P.report) || "(no record yet)",
      lastExport ? `Last claude.ai export imported covers up to ${lastExport}.` : "No claude.ai export imported yet (optional; it adds phone and web chats and gives the baseline history).",
      "--- her plan (written while well) ---",
      read(P.plan) || "(no plan file)",
    ].join("\n\n"));
  }
);

server.tool(
  "wellbeing_plan",
  "Add a line to one section of her plan, in her words, while filling it in with her. Only in a calm stretch, only with her, one section at a time. Sections: going up, what helps, what I want Claude to do, 48 hours, people, crisis contacts, going down.",
  { section: z.string().describe("which section, e.g. 'going up'"), line: z.string().describe("her words") },
  async ({ section, line }) => {
    let md;
    try { md = fs.readFileSync(P.plan, "utf8"); } catch { return text("No plan file. Run the wellbeing installer first."); }
    const heads = [...md.matchAll(/^## (.+)$/gm)];
    const want = section.toLowerCase();
    const h = heads.find((m) => m[1].toLowerCase().includes(want)) || heads.find((m) => want.split(/\s+/).some((w) => w.length > 3 && m[1].toLowerCase().includes(w)));
    if (!h) return text(`No section like "${section}". Sections: ${heads.map((m) => m[1]).join("; ")}`);
    const next = heads[heads.indexOf(h) + 1];
    const end = next ? next.index : md.length;
    let body = md.slice(h.index, end).replace(/\n-\s*\n/, "\n");
    body = body.replace(/\s*$/, "") + `\n- ${line.trim()}\n\n`;
    fs.writeFileSync(P.plan, md.slice(0, h.index) + body + md.slice(end));
    return text(`Added to "${h[1]}".`);
  }
);

server.tool(
  "wellbeing_import_export",
  "Import a claude.ai data export (Settings > Privacy > Export data, then unzip). Counts her messages from desktop, web and phone by time for the rhythm record (no text kept there), and adds each conversation to her Claude Mind memory as a summarised session in the background. Pass the unzipped folder or its conversations.json.",
  { path: z.string() },
  async ({ path: p }) => {
    const abs = p.replace(/^~(?=\/|\\|$)/, process.env.HOME || process.env.USERPROFILE || "~");
    const counts = cli("import", abs);
    return text(counts + "\n" + importChatsInBackground(abs));
  }
);

// The same export also feeds the memory journal (import-chats.ts: one session per
// conversation, summarised). That takes minutes and model calls, so it runs detached
// with its own log; --skip-rhythm because the counts were just imported above.
function importChatsInBackground(abs) {
  const script = path.join(VAULT, ".claude", "bin", "import-chats.ts");
  const loader = path.join(VAULT, "node_modules", "tsx", "dist", "loader.mjs");
  if (!fs.existsSync(script) || !fs.existsSync(loader)) return "Memory import not available in this install.";
  try {
    const logFile = path.join(VAULT, ".claude", "logs", "import-chats.log");
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const fd = fs.openSync(logFile, "a");
    const child = spawn(process.execPath, ["--import", pathToFileURL(loader).href, script, abs, "--skip-rhythm"],
      { cwd: VAULT, detached: true, stdio: ["ignore", fd, fd], windowsHide: true, env: { ...process.env, LKHS_VAULT_ROOT: VAULT } });
    child.unref();
    return "The conversations are also being added to her memory in the background (a few minutes; log: .claude/logs/import-chats.log).";
  } catch (e) { return `Memory import did not start (${e.message}).`; }
}

server.tool(
  "mind_companion_turn",
  "Psychological-conversation scaffold. For any real wellbeing conversation (she wants to talk, is struggling, or the check-in opens up), call with her exact words every turn. Returns scope, an eight-step turn procedure, a safety block when risk cues appear, knowledge-base passages and a pre-send checklist. Read it all; she only sees your reply.",
  { her_words: z.string() },
  async ({ her_words }) => {
    const py = process.platform === "win32" ? "python" : "python3";
    const r = spawnSync(py, [path.join("rag", "assemble.py"), her_words], { cwd: SKILL, encoding: "utf8", timeout: 60_000 });
    if (r.error || r.status) return text(`scaffold unavailable (${r.error?.message || r.stderr?.slice(0, 300)}). Continue using the server guidance.`);
    return text(r.stdout);
  }
);

await server.connect(new StdioServerTransport());
