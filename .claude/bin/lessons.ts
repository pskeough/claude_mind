/**
 * lessons.ts — the procedural-memory ledger.
 *
 * LKHS has episodic memory (journals, sessions), semantic memory (wiki, facts,
 * graph) and no procedural memory: no representation for "a technique", so
 * techniques cannot be stored, retrieved or improved. This is that tier.
 *
 * A lesson is NOT a fact. Three fields separate them:
 *   trigger    the observable situation where it applies. Without this it is a wiki
 *              page findable only by similarity, which is what we already had.
 *   action     what to do instead. A lesson that only describes a problem is a bug
 *              report.
 *   falsifier  what observation would prove it wrong. This is the primary anti-slop
 *              filter and it is stricter than any confidence score: "prefer clear
 *              code" has no falsifier and is rejected at write time.
 *
 * Storage mirrors persona_facts.jsonl deliberately — atomic, append-only,
 * tombstoned, superseding, bi-temporal, scoped. That schema has already survived
 * three years of the brevity-bias / context-collapse failure mode that kills
 * playbook systems (see ACE, arXiv 2510.04618): lessons are never stored as a prose
 * document that gets rewritten. Playbook VIEWS are rendered from the ledger on read.
 *
 * Grounded by measurement, not intuition (see LEARNING-SYSTEM-SPEC.md §2 and the
 * Phase 0 runs): 33.6-55.0% of tool errors across 3,813 transcripts are repeats of a
 * failure already seen in an EARLIER, DIFFERENT session, median 18-21 days apart.
 * That recurrence is the entire reason this tier can pay for itself.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { memDir, scopeRank, resolveProfile } from "./config";

export const LEDGER = () => path.join(memDir(), "lessons.jsonl");

export type LessonKind = "environment" | "pattern" | "craft" | "antipattern" | "preference";
export type LessonStatus = "proposed" | "active" | "retired";

export interface Trigger {
  /** tool = a pending tool call; file = editing a path; prompt = semantic; session = always-on */
  type: "tool" | "file" | "prompt" | "session";
  /** what to match against (tool name, path fragment, keyword) */
  match: string;
  /** optional extra condition, human-readable and also matched loosely */
  when?: string;
}

export interface Lesson {
  id: string;
  kind: LessonKind;
  domain: string;
  statement: string;
  action: string;
  falsifier: string;
  trigger: Trigger;
  /** session ids this was observed in; length is the promotion signal */
  sessions: string[];
  observations: number;
  confidence: number;
  first_seen: string;
  last_seen: string;
  status: LessonStatus;
  invalid_at: string | null;
  supersedes: string[];
  scope: string;
  /** provenance: what mined it */
  source: string;
  /** 1 = event-level (tool hygiene), 2 = episode-level (approach/method), 3 = principle */
  tier?: number;
  /** tier 1 behavioral: the normalized error signature this lesson was mined from.
   *  Without it, coverage analysis has to GUESS which failures a lesson covers by
   *  session overlap, which over-attributes badly on high-volume tools (one Bash
   *  lesson appears to claim every Bash signature). Exact provenance, exact coverage. */
  sig?: string;
  /** Every signature this lesson has been mined from or merged with.
   *  `sig` is singular and a lesson routinely covers more than one signature: the miner
   *  re-mines a lesson under a second signature and upsert keeps only the first, and
   *  merging a duplicate discards the duplicate's signature entirely. Coverage joins on
   *  exact signature, so both cases silently UNDER-credit a working lesson. `sig` stays
   *  as the primary for compatibility; this is the full set. */
  sigs?: string[];
  /** tier 2+: the episode/lesson ids this generalizes. A principle that cannot name
   *  its evidence is a fortune cookie and is rejected. */
  cites?: string[];
  /** hindsight tallies, filled in later by the grading loop */
  injected?: number;
  helped?: number;
}

// Promotion ladder. See LEARNING-SYSTEM-SPEC.md §6.
export const MIN_SESSIONS = 2;      // must recur across a session boundary to promote
export const DOMAIN_BUDGET = 25;    // hard cap on ACTIVE lessons per domain

export function loadLessons(): Lesson[] {
  try {
    return fs.readFileSync(LEDGER(), "utf8").split("\n").filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) as Lesson; } catch { return null; } })
      .filter((x): x is Lesson => !!x);
  } catch { return []; }
}

// Replay cache. currentLessons() used to re-read and re-parse the entire ledger on
// every call, and upsertLesson calls it once per write, so a batch of N writes was
// O(N * ledger). Measured: a 70-preference batch went from seconds to minutes as the
// ledger passed 150 rows. The cache is invalidated by mtime, so external edits and
// other processes are still picked up.
let _cache: { mtime: number; size: number; rows: Lesson[] } | null = null;
function ledgerState(): Lesson[] {
  let st: fs.Stats | null = null;
  try { st = fs.statSync(LEDGER()); } catch { return []; }
  if (_cache && _cache.mtime === st.mtimeMs && _cache.size === st.size) return _cache.rows;
  const rows = loadLessons();
  _cache = { mtime: st.mtimeMs, size: st.size, rows };
  return rows;
}

/** Latest record wins per id (append-only log, so replay and keep the last). */
export function currentLessons(): Lesson[] {
  const byId = new Map<string, Lesson>();
  for (const l of ledgerState()) byId.set(l.id, l);
  return [...byId.values()].filter(l => !l.invalid_at);
}

export function activeLessons(): Lesson[] {
  return currentLessons().filter(l => l.status === "active");
}

function append(l: Lesson): void {
  fs.mkdirSync(path.dirname(LEDGER()), { recursive: true });
  fs.appendFileSync(LEDGER(), JSON.stringify(l) + "\n");
  // Extend the replay cache in place rather than letting the mtime check invalidate
  // it. Without this the cache is useless during a write batch: every append changes
  // mtime and size, so the next upsert re-parses the whole ledger and the batch stays
  // O(N * ledger) — which is the bug the cache was added to fix.
  if (_cache) {
    _cache.rows.push(l);
    try { const st = fs.statSync(LEDGER()); _cache.mtime = st.mtimeMs; _cache.size = st.size; }
    catch { _cache = null; }
  }
}

/** Stable id from the thing that makes a lesson unique: what fires it. */
export function lessonId(domain: string, trigger: Trigger, statement: string): string {
  const k = `${domain}|${trigger.type}|${trigger.match}|${statement.slice(0, 60)}`.toLowerCase();
  return "ls-" + crypto.createHash("sha256").update(k).digest("hex").slice(0, 12);
}

export interface UpsertInput {
  kind: LessonKind; domain: string; statement: string; action: string; falsifier: string;
  trigger: Trigger; sessions: string[]; observations: number;
  confidence?: number; scope?: string; source: string; date?: string;
  tier?: number; cites?: string[]; status?: LessonStatus; sig?: string;
}

/**
 * Add or reinforce. Re-observation extends the session set and last_seen rather than
 * duplicating, and promotion is re-evaluated on every write. Returns what happened so
 * miners can report honestly instead of claiming everything is new.
 */
export function upsertLesson(input: UpsertInput): "inserted" | "reinforced" | "promoted" | "rejected" {
  // Gate 1: falsifier is mandatory. This is where platitudes die.
  if (!input.falsifier || input.falsifier.trim().length < 8) return "rejected";
  if (!input.statement || !input.action || !input.trigger?.match) return "rejected";
  // Gate 1b: a tier 2+ principle must name the evidence it generalizes, so it can be
  // checked against that evidence rather than taken on faith.
  if ((input.tier ?? 1) >= 2 && (input.cites?.length ?? 0) < 3) return "rejected";

  const now = (input.date || new Date().toISOString()).slice(0, 10);
  const id = lessonId(input.domain, input.trigger, input.statement);
  const existing = currentLessons().find(l => l.id === id);

  const sessions = [...new Set([...(existing?.sessions || []), ...input.sessions])];
  const observations = (existing?.observations || 0) + input.observations;
  // Gate 2: must have recurred across a session boundary. In-context memory already
  // covers same-session repeats, so a one-session lesson stays proposed.
  // Tier 1 auto-promotes on recurrence. Tier 2+ NEVER does: a synthesized principle
  // reads like wisdom whether or not it is one, so it stays `proposed` until a human
  // promotes it from the TODAY.md inbox. The gates get STRICTER as abstraction rises,
  // which is the opposite of most playbook systems and the reason this one should not
  // fill up with fortune cookies.
  const tier = input.tier ?? 1;
  const status: LessonStatus = input.status
    ? input.status
    : tier >= 2 ? "proposed"
    : sessions.length >= MIN_SESSIONS ? "active" : "proposed";

  const next: Lesson = {
    id,
    kind: input.kind,
    domain: input.domain,
    statement: input.statement,
    action: input.action,
    falsifier: input.falsifier,
    trigger: input.trigger,
    sessions,
    observations,
    confidence: input.confidence ?? Math.min(0.95, 0.4 + 0.1 * sessions.length),
    first_seen: existing?.first_seen || now,
    last_seen: now > (existing?.last_seen || "") ? now : existing!.last_seen,
    status,
    invalid_at: null,
    supersedes: existing?.supersedes || [],
    scope: input.scope || "professional",
    source: input.source,
    injected: existing?.injected ?? 0,
    helped: existing?.helped ?? 0,
    tier,
    ...(input.cites?.length ? { cites: input.cites } : {}),
    ...(input.sig ? { sig: input.sig } : existing?.sig ? { sig: existing.sig } : {}),
    // Accumulate every signature ever seen for this lesson rather than keeping only the
    // first. Re-mining under a second signature used to be invisible to coverage.
    ...(() => {
      const all = [...new Set([...(existing?.sigs || []), ...(existing?.sig ? [existing.sig] : []), ...(input.sig ? [input.sig] : [])])];
      return all.length ? { sigs: all } : {};
    })(),
  };
  append(next);
  if (!existing) return status === "active" ? "promoted" : "inserted";
  return existing.status !== "active" && status === "active" ? "promoted" : "reinforced";
}

/**
 * Fold `dup` into `keep`: the surviving lesson absorbs the duplicate's evidence, then
 * the duplicate is tombstoned pointing at its survivor.
 *
 * Retiring a duplicate outright THROWS AWAY the sessions that duplicate was observed
 * in, which is the opposite of what should happen. Fragmentation already understates
 * evidence: one finding mined under five phrasings becomes five records each carrying
 * a fifth of the support, and since the budget ranks by session count, five weak
 * records can be evicted while the finding they all describe is the most-recurring
 * thing in the domain. Merging consolidates the count instead of discarding it.
 *
 * The duplicate's trigger term is folded into the survivor's `when` list for the same
 * reason: two phrasings of one remedy usually fire on different terms, and dropping
 * one silently narrows when the rule reaches the model.
 */
export function mergeLesson(keepId: string, dupId: string, why: string): boolean {
  const cur = currentLessons();
  const keep = cur.find(x => x.id === keepId), dup = cur.find(x => x.id === dupId);
  if (!keep || !dup) return false;
  const sessions = [...new Set([...keep.sessions, ...dup.sessions])];
  // Union the narrowing conditions only. NOT dup.trigger.match: `match` names the TOOL
  // and `when` names content tokens within its arguments, so folding one into the other
  // turns the tool's own name into a content condition. Observed live: merging two Bash
  // lessons produced `when: ["bash"]`, which fires on any command whose text happens to
  // mention bash, and both merged rules started surfacing on unrelated calls.
  const toolTok = new Set([keep.trigger.match, dup.trigger.match].map(s => String(s).toLowerCase()));
  const terms = new Set(
    [keep.trigger.when, dup.trigger.when]
      .filter(Boolean).flatMap(s => String(s).split(/[,;]\s*/)).map(s => s.trim())
      .filter(s => s && !toolTok.has(s.toLowerCase()))
  );
  append({
    ...keep,
    sessions,
    observations: keep.observations + dup.observations,
    confidence: Math.min(0.95, 0.4 + 0.1 * sessions.length),
    first_seen: keep.first_seen < dup.first_seen ? keep.first_seen : dup.first_seen,
    last_seen: keep.last_seen > dup.last_seen ? keep.last_seen : dup.last_seen,
    trigger: { ...keep.trigger, ...(terms.size ? { when: [...terms].join(", ") } : {}) },
    supersedes: [...new Set([...keep.supersedes, dup.id])],
    source: `${keep.source} | merged ${dup.id}`,
  });
  append({ ...dup, status: "retired", invalid_at: new Date().toISOString().slice(0, 10), source: `${dup.source} | merged into ${keep.id}: ${why}` });
  return true;
}

/** Tombstone (append-only: never rewrite history). */
export function retireLesson(id: string, why: string): boolean {
  const l = currentLessons().find(x => x.id === id);
  if (!l) return false;
  append({ ...l, status: "retired", invalid_at: new Date().toISOString().slice(0, 10), source: `${l.source} | retired: ${why}` });
  return true;
}

/**
 * Enforce the per-domain budget. This is the core quality mechanism, not a
 * performance optimization: the failure mode of every playbook system is 400
 * mediocre rules, and scarcity is what forces the ledger to stay sharp. Ranked by
 * utility (hindsight-graded help rate first, then recurrence, then recency).
 */
export function enforceBudget(budget = DOMAIN_BUDGET): Array<{ domain: string; evicted: number }> {
  const byDomain = new Map<string, Lesson[]>();
  // Bucket by taskType where one exists, else by domain.
  //
  // For tier 1 the domain IS the tool name, which is already a closed vocabulary and the
  // right bucket. For tier 2 the domain was a slug the synthesizer invented per cluster,
  // which produced 22 buckets of exactly one lesson that a per-domain budget could never
  // evict - scarcity is the quality mechanism here, and a bucket of one has no scarcity.
  // `taskType` (task-types.ts) is the closed 27-type vocabulary derived from the corpus,
  // so tier-2 principles now compete against others governing the same KIND of work.
  for (const l of activeLessons()) {
    const k = (l as any).taskType || l.domain;
    (byDomain.get(k) ?? byDomain.set(k, []).get(k)!).push(l);
  }
  const out: Array<{ domain: string; evicted: number }> = [];
  for (const [domain, list] of byDomain) {
    if (list.length <= budget) continue;
    const utility = (l: Lesson) => {
      const help = (l.injected || 0) >= 3 ? (l.helped || 0) / (l.injected || 1) : 0.5;  // unproven = neutral
      return help * 100 + l.sessions.length * 10 + l.observations;
    };
    list.sort((a, b) => utility(b) - utility(a));
    const evict = list.slice(budget);
    for (const l of evict) retireLesson(l.id, `domain budget ${budget} exceeded`);
    out.push({ domain, evicted: evict.length });
  }
  return out;
}

/** Lessons whose trigger matches a pending tool call. Used by the PreToolUse path. */
export function lessonsForTool(tool: string, argsText = ""): Lesson[] {
  const t = tool.toLowerCase(), a = argsText.toLowerCase();
  return activeLessons().filter(l => {
    if (l.trigger.type !== "tool") return false;
    if (!t.includes(l.trigger.match.toLowerCase())) return false;
    if (!l.trigger.when) return true;
    // `when` is a loose content condition; require at least one distinctive token.
    const toks = l.trigger.when.toLowerCase().match(/[a-z0-9_.:>|\-]{3,}/g) || [];
    return toks.length === 0 || toks.some(x => a.includes(x));
  });
}

/** Lessons for a file path being touched. */
export function lessonsForFile(file: string): Lesson[] {
  const f = file.replace(/\\/g, "/").toLowerCase();
  return activeLessons().filter(l => l.trigger.type === "file" && f.includes(l.trigger.match.toLowerCase()));
}

/**
 * Render a compact playbook VIEW. Never written to disk as the source of truth —
 * the ledger is. Budgeted so the injection cannot grow without bound.
 */
/** Truncate on a word boundary. Every tier-2 falsifier shipped mid-word ("...demonstr").
 *  The falsifier-in-injection is the design's best idea; unreadable, it is decoration. */
function trim(t: string, n: number): string {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(" ")) + "...";
}

export function renderPlaybook(opts: { domains?: string[]; max?: number; verbose?: boolean; ceiling?: number } = {}): string {
  let ls = activeLessons();
  // Scope ceiling, same semantics as the retrieval path. PLAYBOOK.md is a static file
  // read by a hook that has no profile awareness, so the ceiling is applied HERE at
  // render time rather than at read time. Without it, personal-scope preferences would
  // ride into every session regardless of the active profile.
  if (opts.ceiling !== undefined) ls = ls.filter(l => scopeRank(l.scope) >= opts.ceiling!);
  if (opts.domains?.length) {
    const want = new Set(opts.domains.map(d => d.toLowerCase()));
    ls = ls.filter(l => want.has(l.domain.toLowerCase()));
  }
  // RESERVED SLOTS, not a single ranking. Ranking purely by recurrence looked
  // principled and was wrong: tool-hygiene lessons recur far more often than
  // preferences or method principles (44 sessions vs 2), so a pure sort buried every
  // high-value entry under the long tail of bash trivia. Measured: with max=22 and
  // recurrence ranking, all 4 active preferences were crowded out entirely.
  //
  // Each class competes only against its own kind, and the classes are ordered by how
  // much a single entry changes behaviour: how the user wants work done > method >
  // which flag to pass.
  const max = opts.max ?? 20;
  const byRecurrence = (a: Lesson, b: Lesson) => b.sessions.length - a.sessions.length || b.observations - a.observations;
  const prefs = ls.filter(l => l.kind === "preference").sort(byRecurrence);
  const method = ls.filter(l => l.kind !== "preference" && (l.tier ?? 1) >= 2).sort(byRecurrence);
  const hygiene = ls.filter(l => l.kind !== "preference" && (l.tier ?? 1) < 2).sort(byRecurrence);
  const prefSlots = Math.min(prefs.length, Math.max(4, Math.round(max * 0.3)));
  const methodSlots = Math.min(method.length, Math.max(3, Math.round(max * 0.2)));
  ls = [
    ...prefs.slice(0, prefSlots),
    ...method.slice(0, methodSlots),
    ...hygiene.slice(0, Math.max(0, max - prefSlots - methodSlots)),
  ];
  if (!ls.length) return "";
  const byDomain = new Map<string, Lesson[]>();
  for (const l of ls) (byDomain.get(l.domain) ?? byDomain.set(l.domain, []).get(l.domain)!).push(l);
  const out: string[] = [];
  for (const [domain, list] of [...byDomain.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`${domain}:`);
    for (const l of list) {
      if (opts.verbose) { out.push(`  - ${l.action}  (${l.statement}) [${l.observations}x/${l.sessions.length}s]`); continue; }
      // Compact: the ACTION is what changes behaviour, so it leads. The statement is
      // justification and stays in the ledger.
      const head = trim(l.action, 220);
      // Tier 2+ carries its falsifier into the injection. This is what turns "check
      // the context you are given" from a platitude into something actionable: the
      // model is told the specific observation that would mean this entry is stale,
      // so it can look for it instead of either obeying or ignoring on vibes.
      //
      // The cap is 300, not 160, and it cuts on a word boundary. At 160 with a raw
      // slice every single rendered falsifier ended mid-word ("...demonstr", "...an"),
      // which is the worst of both: long enough to look complete, too short to state
      // the observation it names. A falsifier the model cannot read is decoration, and
      // this line is the one thing separating a principle from a fortune cookie.
      const stale = l.tier && l.tier >= 2 && l.falsifier
        ? `\n      stale if: ${trim(l.falsifier, 300)}`
        : "";
      out.push(`  - ${head} [${l.sessions.length}s]${stale}`);
    }
  }
  return out.join("\n");
}

/**
 * Write the injectable view to disk. The LEDGER is the source of truth; this is a
 * rendered artifact, regenerated whenever lessons change, so the SessionStart hook
 * can Get-Content it in microseconds instead of paying a tsx cold start on every
 * session. Same pattern as TODAY.md.
 */
export function writePlaybookFile(max = 22, ceiling?: number): string {
  // PLAYBOOK.md is a static file read by a hook that has no profile awareness, so it
  // is rendered at the PROFESSIONAL floor regardless of the vault's own profile. A
  // file rendered under `full` and later read by a `work`-profile session would be a
  // leak, and "does not leak today" is a weaker claim than "cannot leak". Personal
  // preferences are not lost: they are embedded into the store (lesson-embed.ts) and
  // reach sessions through the gate, which IS profile-aware and enforces the ceiling
  // at the retrieval source.
  const c = ceiling ?? scopeRank("professional");
  const body = renderPlaybook({ max, ceiling: c });
  const file = path.join(memDir(), "PLAYBOOK.md");
  const s = stats();
  const content = body
    ? [
        "# Learned playbook (auto-generated from lessons.jsonl — do not edit)",
        `> ${s.byStatus.active || 0} active lessons mined from recurring failures across past sessions.`,
        "> Each line is an action that prevented a failure seen in N separate sessions.",
        "", body, "",
      ].join("\n")
    : "# Learned playbook\n\n(no active lessons yet)\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/**
 * Write the PreToolUse trigger index: a tiny denormalized file the hook can read
 * directly. The hook runs on EVERY tool call, so it cannot afford a tsx cold start,
 * a daemon round-trip or a full ledger replay — it gets a pre-filtered list of
 * tool-triggered active lessons and nothing else.
 *
 * `when` is tokenized here rather than in the hook: the ledger knows the condition is
 * prose, the hook only needs distinctive tokens to match against flattened tool args.
 */
/**
 * Token discriminativeness, measured against real traffic rather than assumed.
 *
 * The audit's finding was that trigger tokens harvested from lesson prose are either
 * unfireable or unfilterable. Raising the minimum length fixed the unfireable half.
 * This fixes the other half: `python` is 6 characters, passes every syntactic filter,
 * and appears in 7,659 of 18,805 Bash calls — so six different python lessons all
 * fired on 59% of Bash traffic and then fought over a 2-slot cap. A token that common
 * predicts nothing; it is a topic, not a trigger.
 *
 * So we count how often each candidate token actually appears in the executable
 * fields of past calls for its tool, and require a rule to be selective. A rule that
 * cannot be made selective is dropped. This is deliberately biased toward silence:
 * an unfired lesson costs nothing, while a rule that fires on most calls teaches the
 * reader to ignore the channel.
 */
const EXEC_FIELDS = ["command", "file_path", "url", "pattern", "notebook_path", "path"];
/** One historical call: its executable text, and whether the result came back an error. */
interface CorpusCall { text: string; err: boolean }

function corpusByTool(): Map<string, CorpusCall[]> {
  const root = path.join(process.env.HOME || process.env.USERPROFILE || "", ".claude", "projects");
  const byTool = new Map<string, CorpusCall[]>();
  const files: string[] = [];
  try {
    (function walk(d: string) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".jsonl")) files.push(p); } })(root);
  } catch { return byTool; }
  for (const f of files) {
    let lines: string[]; try { lines = fs.readFileSync(f, "utf8").split("\n"); } catch { continue; }
    // Outcomes are carried on the tool_result, which arrives in a later message than the
    // tool_use, so calls are held until their result resolves them.
    const pending = new Map<string, { tool: string; call: CorpusCall }>();
    for (const line of lines) {
      if (!line.trim()) continue;
      let m: any; try { m = JSON.parse(line); } catch { continue; }
      const c = m?.message?.content;
      if (!Array.isArray(c)) continue;
      if (m.type === "assistant") {
        for (const b of c) {
          if (b?.type !== "tool_use" || !b.id) continue;
          const fields = EXEC_FIELDS.map(k => b.input?.[k]).filter(Boolean).map(String);
          if (!fields.length) continue;
          pending.set(b.id, { tool: String(b.name || "?"), call: { text: fields.join(" ").toLowerCase(), err: false } });
        }
      } else if (m.type === "user") {
        for (const b of c) {
          if (b?.type !== "tool_result" || !b.tool_use_id) continue;
          const p = pending.get(b.tool_use_id); if (!p) continue;
          pending.delete(b.tool_use_id);
          const txt = typeof b.content === "string" ? b.content
            : Array.isArray(b.content) ? (b.content.find((x: any) => x?.type === "text")?.text || "") : "";
          p.call.err = b.is_error === true
            || /^(Error|error):|Traceback|command not found|No such file|Exit code [1-9]/.test(String(txt).trim());
          (byTool.get(p.tool) ?? byTool.set(p.tool, []).get(p.tool)!).push(p.call);
        }
      }
    }
    for (const p of pending.values()) (byTool.get(p.tool) ?? byTool.set(p.tool, []).get(p.tool)!).push(p.call);
  }
  return byTool;
}

export function writeTriggerIndex(): string {
  // TRIGGER DERIVATION. Rebuilt 2026-08-05 after an independent audit replayed all
  // rules against 64,441 historical tool calls and found the delivery layer, not the
  // ledger, was the broken part:
  //   - one rule matched the 2-char token `gh` as a SUBSTRING, hitting "highlight",
  //     "through", "right" and every path containing those letters: 4,752 fires,
  //     30 relevant, 0.6% precision.
  //   - 32 of 81 rules never matched anything, because their tokens were harvested
  //     from lesson prose ("contains", "resolves", "whose") which never appears in a
  //     serialized tool input.
  //   - 60.6% of firings delivered the SAME near-duplicate pair, because upsert
  //     dedupes on a statement-prefix hash and five phrasings of one finding hash
  //     differently.
  // The three fixes below are why the token rules are now conservative to the point
  // of being boring: an unfired lesson costs nothing, a lesson that cries wolf on
  // 23.8% of all tool calls costs the credibility of every other lesson.
  const STOP = /^(with|that|this|when|from|into|file|path|call|tool|using|value|string|every|before|after|never|always|instead|command|commands|should|which|there|their|contains|resolves|established|whose|argument|invocation|content|output|result|error|first|second)$/;
  // MIN 4 CHARS, and no substring-prone fragments. `gh` is a real distinction to a
  // human and noise to a substring matcher.
  const clean = (arr: string[]) => [...new Set(arr.map(t => t.toLowerCase().trim()).filter(t => t.length >= 4 && !STOP.test(t)))];
  const codeTerms = (t: string) => clean([...t.matchAll(/`([^`]{4,24})`/g)].map(m => m[1]!));
  const wordTerms = (t: string) => clean(t.toLowerCase().match(/[a-z0-9_.:>|\-]{4,}/g) || []);

  let ls = activeLessons().filter(l => l.trigger.type === "tool");

  // COLLAPSE near-duplicates before emitting. Same tool + overlapping action wording
  // means one slot, not two: the 2-slot delivery cap was being spent saying the same
  // thing twice on three quarters of all firings.
  const words = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9_]{4,}/g) || []));
  const jaccard = (x: Set<string>, y: Set<string>) => {
    let i = 0; for (const w of x) if (y.has(w)) i++;
    return i / (x.size + y.size - i || 1);
  };
  ls.sort((a, b) => b.sessions.length - a.sessions.length);
  const kept: Lesson[] = [];
  for (const l of ls) {
    const w = words(l.action);
    if (kept.some(k => k.trigger.match === l.trigger.match && jaccard(words(k.action), w) >= 0.5)) continue;
    kept.push(l);
  }

  // Fire-rate ceiling: a rule may match at most this share of its tool's traffic.
  const MAX_FIRE = 0.12;
  const corpus = corpusByTool();
  const rate = (tool: string, toks: string[]): number => {
    const calls = corpus.get(tool);
    if (!calls || !calls.length) return 0;                    // no evidence: allow
    let n = 0;
    for (const c of calls) if (toks.every(t => c.text.includes(t))) n++;
    return n / calls.length;
  };
  // FAILURE LIFT. A trigger exists to fire on the calls that are about to go wrong, so
  // among the calls it matches, the failure rate should exceed the tool's base rate.
  // Fire rate alone cannot see this and hid a whole class of junk rules for a full
  // review cycle: 40 of 53 rules keyed on prose words like `immediately` and `prints`
  // produced a healthy-looking 1.3% union fire rate while predicting nothing.
  // Measured over 64k historical calls, lift by token provenance came out 4.64x for
  // code tokens in trigger.when, 3.81x for code in the action, 2.41x for plain words —
  // the exact ordering the tier partition assumes, which is why the tiers stay.
  const MIN_LIFT = 1.5;
  const lift = (tool: string, toks: string[]): number => {
    const calls = corpus.get(tool);
    if (!calls || calls.length < 40) return MIN_LIFT;          // too little evidence to judge: allow
    const base = calls.filter(c => c.err).length / calls.length;
    if (base <= 0) return MIN_LIFT;                            // tool never fails here: lift undefined
    const hit = calls.filter(c => toks.every(t => c.text.includes(t)));
    if (hit.length < 8) return MIN_LIFT;                       // too few matches to estimate
    return (hit.filter(c => c.err).length / hit.length) / base;
  };

  const rules = kept.map(l => {
    // Candidate pool, best-first: an explicit condition, then backticked code from the
    // action, then its distinctive words.
    // PROVENANCE-RANKED, not rarity-ranked. Pooling every candidate and sorting by
    // rarity looked principled and produced a channel that mostly fires on nothing:
    // 40 of 53 live rules were keyed on a single English word scavenged from action
    // PROSE — `immediately`, `backslash`, `prints`, `opens`, `lines`, `target`,
    // `cannot`. Those words are individually uncommon inside command text, so they sail
    // through the rarity sort and the 12% fire ceiling and produce a healthy-looking
    // 1.3% overall fire rate, while what they actually predict is nothing: the word
    // "prints" appearing in a command has no relationship to the UTF-8 lesson it fired.
    //
    // A low fire rate was never the goal. Firing on the calls that are about to fail is
    // the goal, and only a token the lesson's own author put in `trigger.when`, or a
    // token that looks like code rather than English, carries that information.
    //
    // Tiers are tried best-first and a later tier is only reached if the earlier ones
    // yield nothing, so a rule keyed on real code is never diluted by prose.
    const isCodeish = (t: string) => /[^a-z]/.test(t);   // flag, dot, dash, slash, digit, underscore
    const whenToks = l.trigger.when ? wordTerms(l.trigger.when) : [];
    const tiers = [
      [...(l.trigger.when ? codeTerms(l.trigger.when) : []), ...whenToks.filter(isCodeish)],
      [...codeTerms(l.action), ...codeTerms(l.statement)],
      whenToks.filter(t => !isCodeish(t)),               // author-supplied plain words: allowed
      wordTerms(l.action).filter(isCodeish),             // prose, but code-shaped (e.g. `--force`, `utf-8`)
      // Deliberately absent: bare English words from action prose. That tier is the
      // entire source of the junk rules and admitting it is what this change reverses.
    ];
    // The tool's own name is never a narrowing condition. `match` already selects the
    // tool; repeating it in `when` asserts only "the command mentions the tool it is",
    // which is true of a large slice of real traffic and of nothing in particular. The
    // fire-rate ceiling below does not catch it either, because the token is genuinely
    // uncommon inside command TEXT while being useless as a predictor.
    const notTool = (t: string) => t.toLowerCase() !== l.trigger.match.toLowerCase();
    // A usable token is rare BUT PRESENT. Sorting purely by rarity picks the tokens
    // that occur in NO real command — prose fragments like "7-bit" or "tool-level" —
    // which took the fire rate from 25.3% to 0.0%: technically selective, entirely
    // useless. So candidates must be attested in real traffic first (r > 0), and only
    // then is the most selective one preferred.
    const MIN_FIRE = 0.0005;
    const SOURCE = ["when-code", "action-code", "when-word", "action-codeish"] as const;
    let when: string[] = [];
    let tokenSource: string | null = null;
    // Walk the tiers in order and STOP at the first that yields a usable token. Pooling
    // them and re-sorting by rarity would silently undo the partition, since a rare
    // prose word always beats a common code token on rarity alone.
    for (let ti = 0; ti < tiers.length && !when.length; ti++) {
      const scored = [...new Set(tiers[ti]!)].filter(notTool)
        .map(t => ({ t, r: rate(l.trigger.match, [t]) }))
        .filter(x => x.r >= MIN_FIRE)
        .sort((a, b) => a.r - b.r);
      const pick: string[] = [];
      for (const { t } of scored) {
        pick.push(t);
        // Conjunction is what turns a topic into a trigger: `python` fires on 59% of
        // Bash calls, `python` AND `-c` on a fraction of that.
        if (rate(l.trigger.match, pick) <= MAX_FIRE) break;
        if (pick.length >= 3) break;
      }
      // Admit only if it is both selective AND predictive. A rule below MIN_LIFT fires
      // on calls that were going to succeed, which is worse than staying silent: it
      // spends one of the two delivery slots and teaches the reader to discount the
      // channel. Observed at 0.55x and 0.70x on the highest-volume rules in the index.
      if (pick.length && rate(l.trigger.match, pick) <= MAX_FIRE && lift(l.trigger.match, pick) >= MIN_LIFT) {
        when = pick; tokenSource = SOURCE[ti]!;
      }
    }
    return {
      id: l.id,
      match: l.trigger.match,
      when: when.length ? when : null,
      tokenSource,
      action: trim(l.action, 240),
      sessions: l.sessions.length,
      // Specificity beats popularity at delivery time. A rule whose tokens are long
      // and rare predicted THIS call; a popular rule merely happens a lot. Measured
      // failure: `python3 script.py` was answered with the two UTF-8 lessons (44 and
      // 21 sessions) while the two python3-is-a-Store-alias lessons (12, 11) were
      // crowded out — the right answer lost to the frequent one.
      spec: when.length ? Math.round(when.reduce((n, t) => n + t.length, 0) / when.length) : 0,
    };
  })
  // A rule with no usable token is DROPPED, not made unconditional: an unconditional
  // rule on a high-traffic tool fires on everything.
  .filter(r => r.when && r.when.length)
  .sort((a, b) => b.spec - a.spec || b.sessions - a.sessions);

  const file = path.join(memDir(), "lesson-triggers.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), rules }, null, 1));
  return file;
}

export function stats() {
  const cur = currentLessons();
  const byStatus: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  for (const l of cur) {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    if (l.status === "active") byDomain[l.domain] = (byDomain[l.domain] || 0) + 1;
  }
  return { total: cur.length, byStatus, byDomain };
}

// ---- CLI -------------------------------------------------------------------
/**
 * Collapse near-duplicate ACTIVE lessons.
 *
 * upsertLesson dedupes on a hash of domain|trigger|statement-prefix, so five phrasings
 * of one finding hash differently and all five survive. Two things about the earlier
 * version of this pass were wrong, and it reported "0 duplicates" on a ledger that had
 * 356 pairs above 0.80 cosine:
 *
 *  1. It only compared lessons whose `trigger.match` was IDENTICAL. That sounds
 *     conservative and is in fact the bug: the surviving phrasings of "write the python
 *     to a temp file" fire on `python -c`, `python`, `python3` and two backticked
 *     variants, so no two of them ever entered the same comparison. Scope is the DOMAIN.
 *  2. It scored word-set Jaccard. Jaccard misses paraphrase, and paraphrase is exactly
 *     what a per-cluster model call produces: the same remedy is re-worded every time it
 *     is mined, so lexical overlap is weakest precisely where duplication is worst.
 *
 * Similarity is on the ACTION, because the action is what gets delivered: two lessons
 * that tell you to do the same thing are one lesson however their rationales are worded.
 */
export async function dedupe(a: string[]): Promise<void> {
  const APPLY = a.includes("--apply");
  // 0.94, chosen from a sweep rather than picked: at 0.86 the pass proposed merging
  // "on SSL error use WebSearch" into "on a .pdf URL download instead", and "re-read
  // the user's own introduction" into "write research prose in we-found style" —
  // different remedies that share a tool and a register. At 0.90 there were still
  // three such pairs. At 0.94 all 12 proposals were the same remedy under two
  // phrasings, verified by reading them. Prefer leaving a duplicate over merging two
  // distinct rules: a redundant lesson wastes a budget slot, a bad merge deletes a rule.
  const THRESH = Number(a.find(x => x.startsWith("--sim="))?.slice(6) || 0.94);
  const act = activeLessons().sort((x, y) => y.sessions.length - x.sessions.length || y.observations - x.observations);
  const { embedPassages } = await import("./vector-engine");
  const vec = await embedPassages(act.map(l => l.action));
  const cos = (p: number[], q: number[]) => {
    let d = 0, a2 = 0, b2 = 0;
    for (let i = 0; i < p.length; i++) { d += p[i]! * q[i]!; a2 += p[i]! * p[i]!; b2 += q[i]! * q[i]!; }
    return d / (Math.sqrt(a2) * Math.sqrt(b2) || 1e-12);
  };
  const kept: Array<{ l: Lesson; i: number }> = [];
  const drops: Array<{ dup: Lesson; keep: Lesson; sim: number }> = [];
  act.forEach((l, i) => {
    let best: { l: Lesson; sim: number } | null = null;
    for (const k of kept) {
      if (k.l.domain !== l.domain) continue;
      // Never merge across tiers: an episode-level principle and a tool-hygiene rule can
      // read alike while doing completely different jobs.
      if ((k.l.tier ?? 1) !== (l.tier ?? 1)) continue;
      const s = cos(vec[k.i]!, vec[i]!);
      if (s >= THRESH && (!best || s > best.sim)) best = { l: k.l, sim: s };
    }
    if (best) drops.push({ dup: l, keep: best.l, sim: best.sim });
    else kept.push({ l, i });
  });
  console.log(`${act.length} active -> ${kept.length} distinct, ${drops.length} duplicate(s) at cosine >= ${THRESH}`);
  const perDomain = new Map<string, number>();
  for (const d of drops) perDomain.set(d.keep.domain, (perDomain.get(d.keep.domain) || 0) + 1);
  for (const d of drops)
    console.log(`\n  MERGE ${d.dup.id} (${d.dup.sessions.length}s) -> ${d.keep.id} (${d.keep.sessions.length}s)  cos ${d.sim.toFixed(3)}  [${d.keep.domain}]` +
      `\n    dup : ${d.dup.action.replace(/\s+/g, " ").slice(0, 100)}` +
      `\n    keep: ${d.keep.action.replace(/\s+/g, " ").slice(0, 100)}`);
  console.log(`\nby domain: ${[...perDomain].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`);
  if (!APPLY) { console.log(`\nDRY RUN - add --apply to merge these`); return; }
  for (const d of drops) mergeLesson(d.keep.id, d.dup.id, `action cosine ${d.sim.toFixed(3)}`);
  writePlaybookFile(); writeTriggerIndex();
  console.log(`\nmerged ${drops.length} into their survivors; playbook + trigger index re-rendered`);
}

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a[0] === "--playbook") {
    const out = renderPlaybook({ domains: a.slice(1).filter(x => !x.startsWith("--")), max: 30, verbose: a.includes("--verbose") });
    console.log(out || "(no active lessons yet — run npm run learn:mine)");
  } else if (a[0] === "--render") {
    console.log("wrote " + writePlaybookFile());
    console.log("wrote " + writeTriggerIndex());
  } else if (a[0] === "--budget") {
    const r = enforceBudget();
    console.log(r.length ? r.map(x => `${x.domain}: evicted ${x.evicted}`).join("\n") : "all domains within budget");
  } else if (a[0] === "--proposals") {
    // The promotion surface. Without this, tier 2 is write-only and can never reach a
    // session: synthesized principles land as `proposed` by design and only a human
    // moves them. Reviewing them IS the gate, not a formality.
    const tierArg = a.includes("--tier") ? Number(a[a.indexOf("--tier") + 1]) : 0;
    const props = currentLessons().filter(l => l.status === "proposed").filter(l => !tierArg || (l.tier ?? 1) === tierArg).sort((x, y) => (y.tier ?? 1) - (x.tier ?? 1) || y.observations - x.observations);
    if (!props.length) { console.log("no proposals pending."); }
    for (const l of props) {
      console.log(`\n${l.id}  [tier ${l.tier ?? 1}] [${l.kind}/${l.domain}] [${l.scope}] ${l.cites ? `cites ${l.cites.length} episodes` : `${l.sessions.length} session(s)`}`);
      console.log(`  claim : ${l.statement}`);
      console.log(`  do    : ${l.action}`);
      console.log(`  stale if: ${l.falsifier}`);
    }
    if (props.length) console.log(`\n${props.length} pending. Promote: npm run learn -- --promote <id>   Reject: npm run learn -- --retire <id> <why>`);
  } else if (a[0] === "--promote" && a[1]) {
    const l = currentLessons().find(x => x.id === a[1]);
    if (!l) { console.log("not found"); }
    else if (l.status === "active") { console.log("already active"); }
    else {
      const r = upsertLesson({
        kind: l.kind, domain: l.domain, statement: l.statement, action: l.action, falsifier: l.falsifier,
        trigger: l.trigger, sessions: l.sessions, observations: 0, confidence: l.confidence,
        scope: l.scope, tier: l.tier, cites: l.cites,
        source: `${l.source} | promoted by hand`, status: "active",
      });
      console.log(r === "rejected" ? "rejected (failed a write gate)" : `promoted ${l.id}`);
      writePlaybookFile();
      console.log("playbook view re-rendered");
    }
  } else if (a[0] === "--dedupe") {
    void dedupe(a);
  } else if (a[0] === "--retire" && a[1]) {
    const ok = retireLesson(a[1], a.slice(2).join(" ") || "manual");
    if (ok) writePlaybookFile();
    console.log(ok ? "retired" : "not found");
  } else {
    const s = stats();
    console.log(`lessons: ${s.total} total  ${JSON.stringify(s.byStatus)}`);
    console.log(`active by domain: ${Object.entries(s.byDomain).sort((x, y) => y[1] - x[1]).map(([d, n]) => `${d}(${n})`).join(" ") || "(none)"}`);
    console.log(`\nledger: ${LEDGER()}`);
  }
}
