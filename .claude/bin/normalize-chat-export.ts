/**
 * normalize-chat-export.ts — universal chat-history importer.
 *
 * The persona pipeline (persona-extract.ts) reads one shape: an array of
 * conversations with {name/title, created_at, chat_messages: [{sender|role,
 * text|content}]}. Every provider exports something different; this normalizer
 * detects the format and rewrites it into that shape, so ChatGPT, Gemini, and
 * generic histories feed the same persona synthesis as a Claude export.
 *
 * Supported inputs (auto-detected):
 *   claude    — Anthropic export conversations.json (already the target shape;
 *               passed through untouched)
 *   chatgpt   — OpenAI export conversations.json (mapping tree per convo;
 *               linearized root->leaf along the current branch)
 *   generic   — any JSON array of {title?, messages|chat_messages: [{role|
 *               sender|author, text|content}]} (covers Gemini Takeout after
 *               its JSON is lightly reshaped, and most third-party dumps)
 *   markdown  — a directory of .md/.txt transcripts; each file becomes one
 *               conversation (speaker lines "User:" / "Assistant:" split turns;
 *               otherwise the whole file is one user message)
 *
 *   npx tsx .claude/bin/normalize-chat-export.ts <input.json | dir> [--out <dir>]
 *
 * Output: <out|input-dir>/normalized/conversations.json — then run
 *   npx tsx .claude/bin/persona-extract.ts <out-dir>/normalized
 * Multiple providers? Run this once per export, concatenate the outputs with
 * --append, then extract once over the merged file.
 *   flags: --append   merge into an existing normalized/conversations.json
 */
import * as fs from "fs";
import * as path from "path";

const argv = process.argv.slice(2);
const INPUT = argv[0];
const argOf = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const APPEND = argv.includes("--append");
if (!INPUT) { console.error("usage: tsx normalize-chat-export.ts <conversations.json | export-dir | md-dir> [--out <dir>] [--append]"); process.exit(1); }

interface Msg { sender: string; text: string; created_at?: string }
interface Conv { name: string; created_at?: string; chat_messages: Msg[] }

const iso = (t: any): string | undefined => {
  if (t == null) return undefined;
  const n = Number(t);
  if (Number.isFinite(n) && n > 1e9) return new Date(n > 1e12 ? n : n * 1000).toISOString();
  const d = new Date(String(t));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
};

// ---- format handlers ----------------------------------------------------------

/** OpenAI export: [{title, create_time, mapping: {id: {message, parent, children}}, current_node}] */
function fromChatGPT(convos: any[]): Conv[] {
  const out: Conv[] = [];
  for (const c of convos) {
    const mapping = c.mapping || {};
    // Walk backwards from current_node (the active branch), else pick the deepest leaf.
    let leaf: string | undefined = c.current_node;
    if (!leaf || !mapping[leaf]) {
      leaf = Object.keys(mapping).find(id => !(mapping[id].children || []).length);
    }
    const chain: any[] = [];
    for (let id = leaf; id && mapping[id]; id = mapping[id].parent) chain.unshift(mapping[id]);
    const msgs: Msg[] = [];
    for (const node of chain) {
      const m = node.message;
      if (!m?.author?.role || m.author.role === "system") continue;
      const parts = m.content?.parts || (typeof m.content?.text === "string" ? [m.content.text] : []);
      const text = parts.filter((p: any) => typeof p === "string").join("\n").trim();
      if (!text) continue;
      msgs.push({ sender: m.author.role === "user" ? "human" : "assistant", text, created_at: iso(m.create_time) });
    }
    if (msgs.length) out.push({ name: c.title || "untitled", created_at: iso(c.create_time), chat_messages: msgs });
  }
  return out;
}

/** Generic: array of {title?, name?, created_at?, messages|chat_messages: [{role|sender|author, text|content|parts}]} */
function fromGeneric(convos: any[]): Conv[] {
  const out: Conv[] = [];
  for (const c of convos) {
    const raw = c.chat_messages || c.messages || (Array.isArray(c) ? c : null);
    if (!Array.isArray(raw)) continue;
    const msgs: Msg[] = [];
    for (const m of raw) {
      const roleRaw = String(m.sender || m.role || m.author?.role || m.author || "").toLowerCase();
      const sender = roleRaw.includes("human") || roleRaw.includes("user") ? "human"
        : roleRaw.includes("assistant") || roleRaw.includes("model") || roleRaw.includes("ai") || roleRaw.includes("bot") ? "assistant" : "";
      if (!sender) continue;
      const text = (typeof m.text === "string" && m.text)
        || (typeof m.content === "string" && m.content)
        || (Array.isArray(m.content) ? m.content.map((p: any) => p?.text || (typeof p === "string" ? p : "")).filter(Boolean).join("\n") : "")
        || (Array.isArray(m.parts) ? m.parts.filter((p: any) => typeof p === "string").join("\n") : "");
      if (String(text).trim()) msgs.push({ sender, text: String(text).trim(), created_at: iso(m.created_at || m.create_time || m.timestamp) });
    }
    if (msgs.length) out.push({ name: c.name || c.title || "untitled", created_at: iso(c.created_at || c.create_time || c.start_time), chat_messages: msgs });
  }
  return out;
}

/** Directory of .md/.txt transcripts, one conversation per file. */
function fromMarkdownDir(dir: string): Conv[] {
  const out: Conv[] = [];
  const SPEAKER = /^(user|me|human|you|assistant|ai|model|gpt|gemini|claude)\s*[:>]/i;
  for (const f of fs.readdirSync(dir).filter(f => /\.(md|txt)$/i.test(f))) {
    const body = fs.readFileSync(path.join(dir, f), "utf8").trim();
    if (!body) continue;
    const msgs: Msg[] = [];
    let cur: Msg | null = null;
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(SPEAKER);
      if (m) {
        if (cur?.text.trim()) msgs.push(cur);
        const isUser = /^(user|me|human|you)$/i.test(m[1]!);
        cur = { sender: isUser ? "human" : "assistant", text: line.slice(m[0].length).trim() };
      } else if (cur) cur.text += "\n" + line;
    }
    if (cur?.text.trim()) msgs.push(cur);
    if (!msgs.length) msgs.push({ sender: "human", text: body }); // no speaker markers: whole file = user material
    out.push({ name: f.replace(/\.(md|txt)$/i, ""), created_at: iso(fs.statSync(path.join(dir, f)).mtimeMs), chat_messages: msgs });
  }
  return out;
}

function detect(convos: any[]): "claude" | "chatgpt" | "generic" {
  const c = convos[0] || {};
  if (c.mapping && typeof c.mapping === "object") return "chatgpt";
  if (Array.isArray(c.chat_messages) && (c.chat_messages[0]?.sender || c.chat_messages.length === 0)) return "claude";
  return "generic";
}

// ---- main ---------------------------------------------------------------------

function main() {
  const stat = fs.statSync(INPUT);
  let convs: Conv[]; let kind: string;
  if (stat.isDirectory() && !fs.existsSync(path.join(INPUT, "conversations.json"))) {
    kind = "markdown-dir"; convs = fromMarkdownDir(INPUT);
  } else {
    const file = stat.isDirectory() ? path.join(INPUT, "conversations.json") : INPUT;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const arr = Array.isArray(raw) ? raw : raw.conversations || [];
    kind = detect(arr);
    convs = kind === "chatgpt" ? fromChatGPT(arr) : kind === "claude" ? arr as Conv[] : fromGeneric(arr);
  }

  const outDir = path.join(argOf("--out") || (stat.isDirectory() ? INPUT : path.dirname(INPUT)), "normalized");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "conversations.json");
  if (APPEND && fs.existsSync(outFile)) {
    const prev = JSON.parse(fs.readFileSync(outFile, "utf8"));
    convs = [...prev, ...convs];
  }
  fs.writeFileSync(outFile, JSON.stringify(convs, null, 0));
  const msgs = convs.reduce((s, c) => s + c.chat_messages.length, 0);
  console.log(`${kind}: ${convs.length} conversation(s), ${msgs} message(s) -> ${outFile}`);
  console.log(`next: npx tsx .claude/bin/persona-extract.ts ${outDir}`);
}

main();
