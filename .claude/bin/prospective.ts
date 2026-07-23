/**
 * LKHS prospective memory (P2, LKHS-V2-UPGRADE-PATH.md): remembering the FUTURE.
 *
 * Vector retrieval points backward (similarity to what was). This layer stores
 * intentions — "when X, remind me Y" — harvested from session summaries or added
 * explicitly, and fires them when their condition becomes true:
 *   project:NAME       fires when a prompt arrives from a matching project cwd
 *   entity:PHRASE      fires when a prompt mentions the phrase (canonKey substring)
 *   date:YYYY-MM-DD    fires on the first prompt on/after that date
 *
 * Storage is append-friendly JSONL at .claude/memory/prospective.jsonl; firing
 * rewrites the file with fired_at stamped (single-writer: the daemon). Unfired
 * intentions older than EXPIRE_DAYS are ignored by the matcher but kept on disk.
 * Shared by the daemon (matching), capture (harvest), and the MCP server (add/list).
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { vaultRoot } from "./config";
import { canonKey } from "./text-normalize";

export interface Intention {
  id: string;
  created: string;                 // ISO
  when: { type: "project" | "entity" | "date"; value: string };
  note: string;
  source: string;                  // session id or "manual"/"mcp"
  fired_at: string | null;
}

const FILE = path.join(vaultRoot(), ".claude", "memory", "prospective.jsonl");
const EXPIRE_DAYS = 180;

export function loadIntentions(): Intention[] {
  try {
    return fs.readFileSync(FILE, "utf-8").split("\n").filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x): x is Intention => !!x && !!x.id && !!x.when && !!x.note);
  } catch { return []; }
}

function saveIntentions(list: Intention[]): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, list.map(i => JSON.stringify(i)).join("\n") + (list.length ? "\n" : ""), "utf-8");
  fs.renameSync(tmp, FILE);
}

export function addIntention(when: Intention["when"], note: string, source: string): Intention | null {
  const type = when.type;
  if (!["project", "entity", "date"].includes(type)) return null;
  if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(when.value.trim())) return null;
  const cleanNote = note.replace(/\s+/g, " ").trim().slice(0, 400);
  if (cleanNote.length < 8) return null;
  const list = loadIntentions();
  // Dedup: an unfired intention with the same condition and near-same note is a no-op.
  const nk = canonKey(cleanNote).slice(0, 80);
  if (list.some(i => !i.fired_at && i.when.type === type && canonKey(i.when.value) === canonKey(when.value) && canonKey(i.note).slice(0, 80) === nk)) return null;
  const it: Intention = {
    id: crypto.createHash("sha1").update(type + when.value + cleanNote + Date.now()).digest("hex").slice(0, 12),
    created: new Date().toISOString(),
    when: { type, value: when.value.trim() },
    note: cleanNote,
    source,
    fired_at: null
  };
  list.push(it);
  saveIntentions(list);
  return it;
}

/** Unfired, unexpired intentions whose condition is true for this prompt/cwd/date.
 *  opts.noDateTriggers (P10 etiquette): hold date-triggered reminders in personal
 *  sessions; they fire on the next work-session prompt instead. */
export function matchIntentions(prompt: string, cwd: string | undefined, nowMs = Date.now(), opts: { noDateTriggers?: boolean } = {}): Intention[] {
  const list = loadIntentions();
  if (!list.length) return [];
  const pk = canonKey(prompt);
  const proj = cwd ? canonKey(path.basename(cwd.replace(/[\\/]+$/, ""))) : "";
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const expireMs = nowMs - EXPIRE_DAYS * 86_400_000;
  return list.filter(i => {
    if (i.fired_at) return false;
    if (new Date(i.created).getTime() < expireMs) return false;
    if (i.when.type === "date") return !opts.noDateTriggers && i.when.value <= today;
    if (i.when.type === "project") return !!proj && (proj.includes(canonKey(i.when.value)) || canonKey(i.when.value).includes(proj));
    return pk.includes(canonKey(i.when.value)); // entity
  });
}

export function markFired(ids: string[]): void {
  if (!ids.length) return;
  const set = new Set(ids);
  const now = new Date().toISOString();
  const list = loadIntentions();
  for (const i of list) if (set.has(i.id) && !i.fired_at) i.fired_at = now;
  saveIntentions(list);
}

/** Parse "**Intentions:**" bullets out of a capture summary. Format per bullet:
 *  - [project:NAME] note   |   - [entity:PHRASE] note   |   - [date:YYYY-MM-DD] note */
export function harvestFromSummary(summary: string, sourceSession: string): Intention[] {
  const added: Intention[] = [];
  const section = summary.match(/\*\*Intentions:\*\*([\s\S]*?)(?=\n\*\*|$)/);
  if (!section) return added;
  const re = /^-\s*\[(project|entity|date):([^\]]+)\]\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section[1]!)) !== null) {
    const it = addIntention({ type: m[1] as any, value: m[2]!.trim() }, m[3]!.trim(), sourceSession);
    if (it) added.push(it);
  }
  return added;
}
