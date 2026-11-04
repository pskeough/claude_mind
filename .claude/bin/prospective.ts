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
 * rewrites the file with fired_at stamped (single-writer: the daemon). Rows are
 * never physically removed — a retired intention keeps its full record and gains a
 * terminal status, so anything that closed can still be read back and reopened.
 * Shared by the daemon (matching), capture (harvest), and the MCP server (add/list).
 *
 * LIFECYCLE. A reminder that can only be "not yet fired" or "fired" has no way to say
 * the underlying commitment is over, so it keeps competing for attention against work
 * that is finished, abandoned, or superseded. Five states instead:
 *
 *   armed      waiting for its trigger; the only state matchIntentions considers
 *   fired      delivered once, which is terminal for a fire-once reminder
 *   expired    its moment passed without it firing (see expiryFor)
 *   done       the commitment was met
 *   cancelled  the commitment was dropped, superseded, or closed elsewhere
 *
 * Legacy rows carry no status field; statusOf infers one rather than requiring a
 * migration, so the file stays readable by anything that only knows fired_at.
 *
 *   npx tsx .claude/bin/prospective.ts --audit     counts, oldest armed, pending repairs
 *   npx tsx .claude/bin/prospective.ts --repair    apply expiry + dedupe + closed topics
 *   npx tsx .claude/bin/prospective.ts --restore=ID[,ID]   reopen a retired intention
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { vaultRoot } from "./config";
import { canonKey } from "./text-normalize";

export type IntentionStatus = "armed" | "fired" | "expired" | "done" | "cancelled";

export interface Intention {
  id: string;
  created: string;                 // ISO
  when: { type: "project" | "entity" | "date"; value: string };
  note: string;
  source: string;                  // session id or "manual"/"mcp"
  fired_at: string | null;
  status?: IntentionStatus;        // absent on rows written before the lifecycle existed
  expires?: string;                // YYYY-MM-DD; after this the intention stops matching
  closed_at?: string;              // when it reached a terminal state other than fired
  closed_reason?: string;          // why, in one line
  prev_status?: IntentionStatus;   // what it was before closing, so --restore can undo
  superseded_by?: string;          // id of the surviving copy after a dedupe merge
  merged_from?: string[];          // ids collapsed into this one
  merged_sources?: string[];       // provenance of every copy that was collapsed in
  restated_at?: string;            // last time the same commitment arrived again
}

const FILE = path.join(vaultRoot(), ".claude", "memory", "prospective.jsonl");
const REPAIR_LOG = path.join(vaultRoot(), ".claude", "logs", "prospective-repair.jsonl");

/** Days a date trigger stays live after its date. Small: a dated reminder that did not
 *  fire within a few days of its date missed its moment, and firing it later attaches
 *  urgency to something whose deadline is already gone. */
const DATE_GRACE_DAYS = 3;

/** Days an undated (project/entity) intention stays armed without firing. A trigger
 *  that has not matched in two months is describing a context that stopped recurring. */
const STALE_DAYS = num(process.env.LKHS_INTENTION_STALE_DAYS, 60);

/** Jaccard floor over note tokens for "these are the same commitment, written twice".
 *  0.5 separates restatements from neighbours in the real file: within a single trigger
 *  the closest genuinely distinct pair scores 0.44, and the loosest true restatement
 *  scores 0.50, so the boundary sits in the gap rather than through a cluster. */
const DUP_JACCARD = num(process.env.LKHS_INTENTION_DUP_FLOOR, 0.5);

function num(v: string | undefined, d: number): number {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => isoDay(Date.parse(day + "T00:00:00Z") + n * 86_400_000);

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

/** The day an intention stops being worth firing. Dated triggers hang on their date plus
 *  a short grace; undated ones on their own age, because there is no other clock. */
export function expiryFor(when: Intention["when"], created: string): string {
  if (when.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(when.value.trim())) {
    return addDays(when.value.trim(), DATE_GRACE_DAYS);
  }
  const base = Date.parse(created);
  return isoDay((Number.isFinite(base) ? base : Date.now()) + STALE_DAYS * 86_400_000);
}

/**
 * Effective state of a row, which is not always the state written on it.
 *
 * Expiry is computed here rather than only stamped by --repair so that an intention
 * whose moment has passed stops matching the moment it passes, without waiting for a
 * maintenance pass to run. --repair persists the same answer; it does not change it.
 */
export function statusOf(i: Intention, nowMs = Date.now()): IntentionStatus {
  if (i.status && i.status !== "armed") return i.status;
  if (i.fired_at) return "fired";
  const exp = i.expires || expiryFor(i.when, i.created);
  return isoDay(nowMs) > exp ? "expired" : "armed";
}

// ---- note similarity ----------------------------------------------------------------

function noteTokens(s: string): Set<string> {
  return new Set(canonKey(s).split(" ").filter(Boolean));
}

/** Jaccard over canonicalised note tokens. Order-independent and length-tolerant, which
 *  is what restatements of one commitment actually differ by: the same nouns in a
 *  different order with a different verb in front. Cheap enough to run on every write. */
export function noteSimilarity(a: string, b: string): number {
  const A = noteTokens(a), B = noteTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Trigger identity for dedupe, which is not the literal trigger string.
 *
 * One project is written several ways across sessions - "Voice_Style_Retune",
 * "Voice Style Retune", "voice-retune"; "a book project", "Second_Tree", "The Second
 * Tree"; "GranularityGap" against "a research paper". canonKey alone keeps those
 * apart, so restatements of one commitment landed in different buckets and the
 * dedupe never compared them. Fold separators out and drop a leading article, so
 * the bucket is the project rather than the spelling.
 */
export function triggerFamily(when: Intention["when"]): string {
  const k = canonKey(when.value).replace(/^the /, "").replace(/[^a-z0-9]/g, "");
  return `${when.type}::${k}`;
}

const triggerKey = (i: Intention) => triggerFamily(i.when);

// ---- closed topics ------------------------------------------------------------------

/**
 * Threads the hand-written correction files declare finished.
 *
 * Prospective memory has no way to learn that a commitment was met outside a session,
 * so a reminder about work the user already did another way keeps firing and keeps
 * reading as an open todo. The corrections in ~/.claude/projects/*_/memory are where
 * that outcome is actually recorded, and each rule below is live only while its
 * evidence file still exists and still contains its marker. Delete or rewrite the
 * correction and the rule stops applying on the next pass, which is the point: the
 * authority is the file, not this table.
 */
interface ClosedTopic {
  id: string;
  evidence: string;   // basename of the correction file that closes the thread
  marker: RegExp;     // text that must still be in that file for the rule to be live
  match: RegExp;      // intentions whose note or trigger matches this are cancelled
  reason: string;
}

const CLOSED_TOPICS: ClosedTopic[] = [
  {
    id: "gp-prescription-route",
    evidence: "user-meds-status.md",
    marker: /GP\/prescription thread is CLOSED/i,
    match: /\b(gp|qoctor|nuvo\s+health|urmoneit|bupropion|zyban|modafinil|telehealth|prescription)\b/i,
    reason: "GP/prescription route closed and resolved another way (user-meds-status.md)"
  }
];

function autoMemoryRoots(): string[] {
  const root = process.env.LKHS_AUTOMEMORY_ROOT || path.join(os.homedir(), ".claude", "projects");
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(root, d.name, "memory"))
      .filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  } catch { return []; }
}

/** Closed-topic rules whose evidence file is present and still says what it said. */
export function liveClosedTopics(): ClosedTopic[] {
  const dirs = autoMemoryRoots();
  return CLOSED_TOPICS.filter(t => dirs.some(d => {
    try { return t.marker.test(fs.readFileSync(path.join(d, t.evidence), "utf-8")); } catch { return false; }
  }));
}

// ---- writing ------------------------------------------------------------------------

export function addIntention(when: Intention["when"], note: string, source: string): Intention | null {
  const type = when.type;
  if (!["project", "entity", "date"].includes(type)) return null;
  if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(when.value.trim())) return null;
  const cleanNote = note.replace(/\s+/g, " ").trim().slice(0, 400);
  if (cleanNote.length < 8) return null;
  const list = loadIntentions();
  const value = when.value.trim();
  const key = triggerFamily({ type, value });

  // A second phrasing of a commitment already armed is evidence it is still live, not a
  // second task. Fold the provenance into the standing row and push its expiry out; the
  // note is left alone so a reminder the user has already read does not change under him.
  const dup = list.find(i => statusOf(i) === "armed" && triggerKey(i) === key && noteSimilarity(i.note, cleanNote) >= DUP_JACCARD);
  if (dup) {
    const seen = new Set([dup.source, ...(dup.merged_sources || [])]);
    if (!seen.has(source)) dup.merged_sources = [...(dup.merged_sources || []), source];
    dup.restated_at = new Date().toISOString();
    if (dup.when.type !== "date") dup.expires = isoDay(Date.now() + STALE_DAYS * 86_400_000);
    saveIntentions(list);
    return null;
  }

  const created = new Date().toISOString();
  const it: Intention = {
    id: crypto.createHash("sha1").update(type + value + cleanNote + Date.now()).digest("hex").slice(0, 12),
    created,
    when: { type, value },
    note: cleanNote,
    source,
    fired_at: null,
    status: "armed",
    expires: expiryFor({ type, value }, created)
  };
  list.push(it);
  saveIntentions(list);
  return it;
}

/**
 * Does a prompt mention an entity trigger?
 *
 * Was a contiguous substring test (`pk.includes(canonKey(value))`), which is far too
 * literal for a trigger a human phrased months earlier. An intention keyed on
 * "uts application" never fired on "the a deadline-bearing application" or "my application to
 * UTS", because neither contains that exact adjacent pair; measured against real prompt
 * history, that one trigger went from 0 matches to 19 under the change below.
 *
 * Token-subset instead: every token of the trigger must appear somewhere in the prompt,
 * order-independent. Still conjunctive, so it does not become a topic match - a
 * two-token trigger needs both tokens present, which is what keeps it from firing on
 * every mention of "application".
 *
 * A token matches a whole word, or a word that STARTS with it once it is 4+ characters.
 * The prefix allowance is what carries inflections: without it "claude mind" stopped
 * matching "claude minds" and the change lost 4 real matches while gaining 28. Short
 * tokens stay anchored to word starts rather than free substrings, because a bare
 * substring test on a 3-letter token is how "uts" begins matching "outset".
 */
export function entityMatches(promptKey: string, value: string): boolean {
  const toks = canonKey(value).split(" ").filter(Boolean);
  if (!toks.length) return false;
  const words = promptKey.split(" ").filter(Boolean);
  const set = new Set(words);
  return toks.every(t => set.has(t) || (t.length >= 4 && words.some(w => w.startsWith(t))));
}

/** Armed intentions whose condition is true for this prompt/cwd/date. Anything fired,
 *  expired, done or cancelled is out of scope by definition.
 *  opts.noDateTriggers (P10 etiquette): hold date-triggered reminders in personal
 *  sessions; they fire on the next work-session prompt instead. */
export function matchIntentions(prompt: string, cwd: string | undefined, nowMs = Date.now(), opts: { noDateTriggers?: boolean } = {}): Intention[] {
  const list = loadIntentions();
  if (!list.length) return [];
  const pk = canonKey(prompt);
  const proj = cwd ? canonKey(path.basename(cwd.replace(/[\\/]+$/, ""))) : "";
  const today = isoDay(nowMs);
  return list.filter(i => {
    if (statusOf(i, nowMs) !== "armed") return false;
    if (i.when.type === "date") return !opts.noDateTriggers && i.when.value <= today;
    if (i.when.type === "project") return !!proj && (proj.includes(canonKey(i.when.value)) || canonKey(i.when.value).includes(proj));
    return entityMatches(pk, i.when.value);
  });
}

export function markFired(ids: string[]): void {
  if (!ids.length) return;
  const set = new Set(ids);
  const now = new Date().toISOString();
  const list = loadIntentions();
  for (const i of list) if (set.has(i.id) && !i.fired_at) { i.fired_at = now; i.status = "fired"; }
  saveIntentions(list);
}

/** Move intentions to a terminal state, keeping enough of the old state to undo it. */
export function closeIntentions(ids: string[], status: Exclude<IntentionStatus, "armed">, reason: string): number {
  if (!ids.length) return 0;
  const set = new Set(ids);
  const now = new Date().toISOString();
  const list = loadIntentions();
  let n = 0;
  for (const i of list) {
    if (!set.has(i.id) || statusOf(i) === status) continue;
    i.prev_status = statusOf(i);
    i.status = status;
    i.closed_at = now;
    i.closed_reason = reason;
    n++;
  }
  if (n) saveIntentions(list);
  return n;
}

/** Undo a close: put the row back where it was and give it a fresh clock. */
export function restoreIntentions(ids: string[]): Intention[] {
  const set = new Set(ids);
  const list = loadIntentions();
  const back: Intention[] = [];
  for (const i of list) {
    if (!set.has(i.id)) continue;
    i.status = i.fired_at ? "fired" : "armed";
    i.expires = i.when.type === "date" ? expiryFor(i.when, i.created) : isoDay(Date.now() + STALE_DAYS * 86_400_000);
    delete i.closed_at;
    delete i.closed_reason;
    delete i.prev_status;
    delete i.superseded_by;
    back.push(i);
  }
  if (back.length) saveIntentions(list);
  return back;
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

// ---- maintenance passes -------------------------------------------------------------

export interface DupCluster { trigger: string; keep: Intention; retire: Intention[] }

/** Single-linkage clustering of armed rows sharing a trigger, at DUP_JACCARD.
 *  Single linkage is the right shape here because restatements chain: the first and
 *  last phrasing of one commitment can be further apart than either is from the
 *  middle, and a stricter linkage splits one commitment into two survivors. */
export function findDuplicates(list: Intention[], nowMs = Date.now()): DupCluster[] {
  const groups = new Map<string, Intention[]>();
  for (const i of list) {
    if (statusOf(i, nowMs) !== "armed") continue;
    const k = triggerKey(i);
    const g = groups.get(k);
    if (g) g.push(i); else groups.set(k, [i]);
  }
  const out: DupCluster[] = [];
  for (const [k, g] of groups) {
    if (g.length < 2) continue;
    const parent = g.map((_, idx) => idx);
    const find = (x: number): number => { while (parent[x]! !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
    for (let a = 0; a < g.length; a++) for (let b = a + 1; b < g.length; b++) {
      if (noteSimilarity(g[a]!.note, g[b]!.note) < DUP_JACCARD) continue;
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
    const comps = new Map<number, Intention[]>();
    for (let idx = 0; idx < g.length; idx++) {
      const r = find(idx);
      const c = comps.get(r);
      if (c) c.push(g[idx]!); else comps.set(r, [g[idx]!]);
    }
    for (const c of comps.values()) {
      if (c.length < 2) continue;
      const sorted = [...c].sort((x, y) => (x.created === y.created ? x.id.localeCompare(y.id) : x.created.localeCompare(y.created)));
      const keep = sorted[sorted.length - 1]!;
      out.push({ trigger: k, keep, retire: sorted.slice(0, -1) });
    }
  }
  return out;
}

function logRepair(entries: Record<string, unknown>[]): void {
  if (!entries.length) return;
  try {
    fs.mkdirSync(path.dirname(REPAIR_LOG), { recursive: true });
    fs.appendFileSync(REPAIR_LOG, entries.map(e => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  } catch { /* the repair itself is recorded on the rows; the log is a convenience */ }
}

export interface RepairResult {
  backup: string;
  stamped: number;
  expired: Intention[];
  cancelledClosed: { topic: string; rows: Intention[] }[];
  merged: DupCluster[];
}

/** Apply expiry, closed-topic cancellation and dedupe. Nothing is removed: every row
 *  keeps its text and gains prev_status, so --restore can put any of it back. */
export function repair(opts: { dry?: boolean } = {}): RepairResult {
  const list = loadIntentions();
  const now = Date.now();
  const stamp = new Date().toISOString();
  const result: RepairResult = { backup: "", stamped: 0, expired: [], cancelledClosed: [], merged: [] };

  if (!opts.dry) {
    const dir = path.join(vaultRoot(), ".claude", "memory", `backup-${isoDay(now)}`);
    fs.mkdirSync(dir, { recursive: true });
    let dest = path.join(dir, "prospective.jsonl.pre-repair");
    for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `prospective.jsonl.pre-repair.${n}`);
    fs.copyFileSync(FILE, dest);
    result.backup = dest;
  }

  // 1. Give every legacy row the status and expiry it always implied.
  for (const i of list) {
    const before = JSON.stringify([i.status, i.expires]);
    if (!i.expires) i.expires = expiryFor(i.when, i.created);
    const eff = statusOf(i, now);
    if (i.status !== eff) i.status = eff;
    if (JSON.stringify([i.status, i.expires]) !== before) result.stamped++;
  }
  result.expired = list.filter(i => i.status === "expired" && !i.closed_at);
  for (const i of result.expired) { i.closed_at = stamp; i.closed_reason = `no fire by ${i.expires}`; i.prev_status = "armed"; }

  // 2. Threads a correction file says are finished. Fired rows are cancelled too: they
  //    are the ones that already reached him against work he had done another way.
  for (const topic of liveClosedTopics()) {
    const rows = list.filter(i => i.status !== "cancelled" && (topic.match.test(i.note) || topic.match.test(i.when.value)));
    if (!rows.length) continue;
    for (const i of rows) {
      i.prev_status = i.status || statusOf(i, now);
      i.status = "cancelled";
      i.closed_at = stamp;
      i.closed_reason = topic.reason;
    }
    result.cancelledClosed.push({ topic: topic.id, rows });
  }

  // 3. Collapse restatements of one commitment onto the newest copy.
  result.merged = findDuplicates(list, now);
  for (const c of result.merged) {
    const sources = new Set([c.keep.source, ...(c.keep.merged_sources || [])]);
    for (const r of c.retire) {
      r.prev_status = "armed";
      r.status = "cancelled";
      r.closed_at = stamp;
      r.closed_reason = `duplicate of ${c.keep.id}`;
      r.superseded_by = c.keep.id;
      sources.add(r.source);
      for (const s of r.merged_sources || []) sources.add(s);
    }
    c.keep.merged_from = [...new Set([...(c.keep.merged_from || []), ...c.retire.map(r => r.id)])];
    c.keep.merged_sources = [...sources].filter(s => s !== c.keep.source);
  }

  if (!opts.dry) {
    saveIntentions(list);
    logRepair([
      ...result.expired.map(i => ({ at: stamp, op: "expire", id: i.id, expires: i.expires, note: i.note.slice(0, 120) })),
      ...result.cancelledClosed.flatMap(c => c.rows.map(i => ({ at: stamp, op: "cancel", topic: c.topic, id: i.id, was: i.prev_status, note: i.note.slice(0, 120) }))),
      ...result.merged.flatMap(c => c.retire.map(i => ({ at: stamp, op: "merge", id: i.id, into: c.keep.id, trigger: c.trigger, note: i.note.slice(0, 120) })))
    ]);
  }
  return result;
}

export function auditCounts(list = loadIntentions(), nowMs = Date.now()): Record<IntentionStatus | "total", number> {
  const c: Record<string, number> = { total: list.length, armed: 0, fired: 0, expired: 0, done: 0, cancelled: 0 };
  for (const i of list) c[statusOf(i, nowMs)] = (c[statusOf(i, nowMs)] || 0) + 1;
  return c as Record<IntentionStatus | "total", number>;
}

// ---- CLI ----------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const has = (f: string) => argv.some(a => a === f || a.startsWith(f + "="));
  const val = (f: string) => { const a = argv.find(x => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : ""; };
  const now = Date.now();

  if (has("--restore")) {
    const ids = val("--restore").split(",").map(s => s.trim()).filter(Boolean);
    const back = restoreIntentions(ids);
    console.log(`restored ${back.length}/${ids.length}`);
    for (const i of back) console.log(`  ${i.id} [${i.when.type}:${i.when.value}] expires ${i.expires} ${i.note.slice(0, 80)}`);
  } else if (has("--repair")) {
    const dry = has("--dry");
    const before = auditCounts(loadIntentions(), now);
    const r = repair({ dry });
    const after = auditCounts(loadIntentions(), now);
    console.log(`repair${dry ? " (dry)" : ""}${r.backup ? `  backup: ${path.relative(vaultRoot(), r.backup)}` : ""}`);
    console.log(`  stamped status/expires on ${r.stamped} rows`);
    console.log(`  expired ${r.expired.length}`);
    for (const i of r.expired.slice(0, 20)) console.log(`     ${i.id} [${i.when.type}:${i.when.value}] exp ${i.expires} ${i.note.slice(0, 70)}`);
    for (const c of r.cancelledClosed) {
      console.log(`  cancelled ${c.rows.length} for closed topic "${c.topic}"`);
      for (const i of c.rows) console.log(`     ${i.id} [${i.when.type}:${i.when.value}] was ${i.prev_status} ${i.note.slice(0, 70)}`);
    }
    console.log(`  merged ${r.merged.length} duplicate cluster(s), retiring ${r.merged.reduce((n, c) => n + c.retire.length, 0)} rows (jaccard >= ${DUP_JACCARD})`);
    for (const c of r.merged) {
      console.log(`     [${c.trigger}] ${c.retire.length + 1} -> 1  keep ${c.keep.id} (${c.keep.created.slice(0, 10)}) ${c.keep.note.slice(0, 70)}`);
      for (const i of c.retire) console.log(`        retire ${i.id} (${i.created.slice(0, 10)}) ${i.note.slice(0, 64)}`);
    }
    console.log(`  before: ${JSON.stringify(before)}`);
    console.log(`  after:  ${JSON.stringify(after)}`);
  } else {
    const list = loadIntentions();
    const c = auditCounts(list, now);
    const today = isoDay(now);
    console.log(`prospective.jsonl  ${path.relative(vaultRoot(), FILE)}`);
    console.log(`  total ${c.total}  armed ${c.armed}  fired ${c.fired}  expired ${c.expired}  done ${c.done}  cancelled ${c.cancelled}`);
    const byType: Record<string, number> = {};
    for (const i of list) if (statusOf(i, now) === "armed") byType[i.when.type] = (byType[i.when.type] || 0) + 1;
    console.log(`  armed by trigger: ${JSON.stringify(byType)}`);
    const armed = list.filter(i => statusOf(i, now) === "armed").sort((a, b) => a.created.localeCompare(b.created));
    const soon = armed.filter(i => (i.expires || expiryFor(i.when, i.created)) <= addDays(today, 7));
    console.log(`  armed expiring within 7 days: ${soon.length}`);
    const dups = findDuplicates(list, now);
    console.log(`  duplicate clusters among armed: ${dups.length} (would retire ${dups.reduce((n, d) => n + d.retire.length, 0)} rows at jaccard >= ${DUP_JACCARD})`);
    for (const d of dups) console.log(`     [${d.trigger}] ${d.retire.length + 1} -> keep ${d.keep.id} ${d.keep.note.slice(0, 60)}`);
    const topics = liveClosedTopics();
    for (const t of topics) {
      const open = list.filter(i => statusOf(i, now) !== "cancelled" && (t.match.test(i.note) || t.match.test(i.when.value)));
      console.log(`  closed topic "${t.id}" (${t.evidence}): ${open.length} row(s) not yet cancelled`);
    }
    if (!topics.length) console.log("  closed topics: none live (no correction file matched)");
    console.log(`  oldest armed (${Math.min(15, armed.length)} of ${armed.length}):`);
    for (const i of armed.slice(0, 15)) {
      console.log(`     ${i.created.slice(0, 10)} exp ${i.expires || expiryFor(i.when, i.created)} [${i.when.type}:${i.when.value}] ${i.note.slice(0, 68)}`);
    }
  }
}
