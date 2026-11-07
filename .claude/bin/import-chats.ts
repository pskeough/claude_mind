/**
 * import-chats.ts - turn a chat export into captured sessions.
 *
 * Claude Desktop and claude.ai chats live on Anthropic's servers, so the transcript
 * sweep never sees them. A claude.ai data export (Settings > Privacy > Export data)
 * has every one of them, from desktop, web and phone. This importer writes each
 * conversation into the session journal through the same path capture-session uses
 * (writeJournalEntry: journal/<project>.md + journal/_sessions.jsonl + embed), with a
 * stable id claudeai-<uuid>, so search_memory, timeline and the cards see them like
 * any other session.
 *
 *   npm run import:chats -- <export folder | conversations.json> [flags]
 *     --dry-run        list what would be imported; no writes, no model calls
 *     --limit N        import at most N conversations this run (newest first)
 *     --no-summary     skip the model summary and write an extractive one (no quota)
 *     --project NAME   journal to write into (default Claude-Chats)
 *     --skip-rhythm    do not also feed the export to the wellbeing rhythm import
 *
 * Idempotent: the ledger records each conversation's updated_at. A rerun skips
 * conversations whose updated_at has not moved and replaces the entry of one that
 * has (a chat continued after the last export). Summaries go through llm-pool, so a
 * rerun after a failure pays only for the conversations not yet summarised.
 *
 * Accepts any format normalize-chat-export.ts reads (Claude, ChatGPT, generic JSON);
 * conversations without an id get one from a hash of their title and start time.
 * When the wellbeing module is on (rhythm.enabled), the same export is also passed to
 * `rhythm.mjs import`, so one export feeds both.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import { vaultRoot, config } from "./config";
import { loadConversations, type Conv } from "./normalize-chat-export";
import { writeJournalEntry, archivistJob, redact, toAscii } from "./capture-session";
import { llmMap } from "./llm-pool";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);
const val = (f: string) => { const i = argv.indexOf(`--${f}`); return i >= 0 ? argv[i + 1] : undefined; };
const INPUT = argv.find((a, i) => !a.startsWith("--") && !["--limit", "--project"].includes(argv[i - 1] || ""));
const DRY = has("dry-run") || has("dry");
const LIMIT = Number(val("limit") ?? Infinity);
const NO_SUMMARY = has("no-summary");
const PROJECT = (val("project") || "Claude-Chats").replace(/[^A-Za-z0-9._-]/g, "-");
const MAX_INPUT_CHARS = 50_000;

const VAULT = vaultRoot();
const LEDGER = path.join(VAULT, "journal", "_sessions.jsonl");
const LOG = path.join(VAULT, ".claude", "logs", "ambient.log");
const log = (m: string) => { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `[${new Date().toISOString()}] import-chats: ${m}\n`); } catch { /* */ } };

/** Text of one export message: claude exports carry `text` and a `content` block list. */
function msgText(m: any): string {
  if (typeof m.text === "string" && m.text.trim()) return m.text.trim();
  if (Array.isArray(m.content)) return m.content.map((b: any) => (typeof b === "string" ? b : b?.type === "text" || !b?.type ? b?.text || "" : "")).join("\n").trim();
  if (typeof m.content === "string") return m.content.trim();
  return "";
}
const isHuman = (m: any) => /human|user/i.test(String(m.sender || m.role || ""));

interface Item {
  id: string; uuid: string; title: string; updated: string;
  start: string | null; end: string | null; userTurns: number;
  text: string; firstUser: string; lastAssistant: string;
  status: "new" | "updated";
}

function convId(c: Conv): string {
  if (c.uuid) return String(c.uuid);
  return crypto.createHash("sha256").update(`${c.name}|${c.created_at || ""}|${msgText(c.chat_messages[0] || {})}`).digest("hex").slice(0, 32);
}

function prepare(c: Conv): Omit<Item, "status"> | null {
  const msgs = (c.chat_messages || []).map(m => ({ human: isHuman(m), text: msgText(m), t: (m as any).created_at as string | undefined })).filter(m => m.text);
  const userTurns = msgs.filter(m => m.human).length;
  if (!userTurns) return null;
  let text = msgs.map(m => `${m.human ? "USER" : "CLAUDE"}: ${m.text.slice(0, m.human ? 2000 : 1500)}`).join("\n");
  if (text.length > MAX_INPUT_CHARS) text = text.slice(text.length - MAX_INPUT_CHARS);
  // Same substance gate as session capture: a one-line question is not a memory.
  if (!(userTurns >= 2 || text.length >= 600)) return null;
  const times = msgs.map(m => m.t).filter((t): t is string => !!t && !isNaN(Date.parse(t))).sort();
  const start = times[0] || c.created_at || null;
  const end = times[times.length - 1] || c.updated_at || start;
  const uuid = convId(c);
  return {
    id: `claudeai-${uuid}`, uuid,
    title: toAscii(c.name || "").trim() || toAscii(msgs.find(m => m.human)!.text.slice(0, 80)),
    updated: c.updated_at || end || start || "",
    start, end, userTurns,
    text: toAscii(redact(text)),
    firstUser: toAscii(redact(msgs.find(m => m.human)!.text.slice(0, 280))),
    lastAssistant: toAscii(redact([...msgs].reverse().find(m => !m.human)?.text.slice(0, 400) || "")),
  };
}

/** sessionId -> updated_at of the last import, from the shared session ledger. */
function importedIndex(): Map<string, string> {
  const idx = new Map<string, string>();
  let lines: string[] = [];
  try { lines = fs.readFileSync(LEDGER, "utf-8").split("\n"); } catch { return idx; }
  for (const l of lines) {
    if (!l.includes('"claudeai-')) continue;
    try { const e = JSON.parse(l); if (String(e.sessionId).startsWith("claudeai-")) idx.set(e.sessionId, e.updated_at || ""); } catch { /* skip */ }
  }
  return idx;
}

function extractive(it: Item): string {
  return [
    `${it.title || "Chat"} (imported from claude.ai, no model summary)`,
    `**Started with:** ${it.firstUser || "n/a"}`,
    `**Ended with:** ${it.lastAssistant || "n/a"}`,
    `**Entities:** ${PROJECT}`,
  ].join("\n\n");
}

function rhythmImport(input: string): void {
  if (has("skip-rhythm")) return;
  if (config().rhythm?.enabled !== true) return;
  if (DRY) { console.log(`wellbeing is on: a real run also passes this export to rhythm.mjs import`); return; }
  const r = spawnSync(process.execPath, [path.join(VAULT, ".claude", "bin", "rhythm.mjs"), "import", input], { cwd: VAULT, encoding: "utf8", timeout: 10 * 60_000 });
  console.log(`rhythm import (wellbeing): ${(r.stdout || "").trim().split("\n").pop() || `exit ${r.status}`}`);
}

async function main() {
  if (!INPUT || !fs.existsSync(INPUT)) {
    console.error("usage: npm run import:chats -- <export folder | conversations.json> [--dry-run] [--limit N] [--no-summary] [--project NAME]");
    process.exit(1);
  }
  const { kind, convs } = loadConversations(INPUT);
  const done = importedIndex();
  const items: Item[] = [];
  let trivial = 0, unchanged = 0;
  for (const c of convs) {
    const p = prepare(c);
    if (!p) { trivial++; continue; }
    const prev = done.get(p.id);
    if (prev !== undefined && prev >= p.updated) { unchanged++; continue; }
    items.push({ ...p, status: prev === undefined ? "new" : "updated" });
  }
  items.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));   // newest first under --limit
  const batch = Number.isFinite(LIMIT) ? items.slice(0, Math.max(0, LIMIT)) : items;
  // Write oldest first, so a fresh journal reads in date order like a captured one.
  batch.sort((a, b) => (a.start || "").localeCompare(b.start || ""));

  console.log(`${kind} export: ${convs.length} conversation(s); ${items.length} to import (${items.filter(i => i.status === "updated").length} updated since last import), ${unchanged} already imported, ${trivial} too short to keep${batch.length < items.length ? `; this run: ${batch.length} (--limit)` : ""}`);
  if (DRY) {
    for (const it of batch) console.log(`  would import  ${it.status.padEnd(7)} ${(it.start || "").slice(0, 10)}  ${it.id.slice(0, 22)}  ${it.title.slice(0, 60)}`);
    rhythmImport(INPUT);
    return;
  }

  process.env.LKHS_CAPTURE = "1";   // our summariser calls must never be captured as sessions
  let summaries: string[] = batch.map(() => "");
  if (!NO_SUMMARY && batch.length) {
    const jobs = batch.map(it => archivistJob(it.text, PROJECT, (it.start || "").slice(0, 10)));
    summaries = await llmMap(jobs, { label: "import-chats" });
  }
  const recent = Date.now() - 30 * 86400_000;
  let written = 0, fallback = 0;
  for (let i = 0; i < batch.length; i++) {
    const it = batch[i]!;
    let summary = toAscii(summaries[i] || "").trim();
    if (summary.length <= 40) { summary = extractive(it); fallback++; }
    const when = it.start && !isNaN(Date.parse(it.start)) ? new Date(it.start) : new Date();
    const r = await writeJournalEntry({
      sessionId: it.id, project: PROJECT, cwd: "claude.ai", event: "chat-import",
      sessionDate: when, title: it.title, summary,
      sessionStart: it.start, sessionEnd: it.end, lineCount: it.userTurns,
      source: "claude.ai-export", replace: it.status === "updated",
      // Old commitments are history, not reminders: only recent chats feed prospective memory.
      harvest: Date.parse(it.end || "") > recent,
      extra: { updated_at: it.updated, uuid: it.uuid },
    });
    if (r === "ok") { written++; console.log(`  imported  ${it.status.padEnd(7)} ${(it.start || "").slice(0, 10)}  ${it.title.slice(0, 60)}`); }
    else console.log(`  ! busy, skipped ${it.id} (rerun picks it up)`);
  }
  log(`${kind} ${INPUT}: imported=${written} unchanged=${unchanged} trivial=${trivial} extractive=${fallback}`);
  console.log(`\nImport done. imported=${written} unchanged=${unchanged} trivial=${trivial}${fallback ? ` (extractive summaries: ${fallback})` : ""}`);
  rhythmImport(INPUT);
}

// Exit explicitly: the embedder holds the event loop open once loaded.
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
