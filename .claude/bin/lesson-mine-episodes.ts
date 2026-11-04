/**
 * lesson-mine-episodes.ts — tier 2. Learn from how the work went, not from what broke.
 *
 *   npm run learn:episodes            new sessions only (watermark-gated)
 *   npm run learn:episodes -- --all --max 120
 *   flags: --max N  --all  --dry  --min-turns N
 *
 * WHY THIS EXISTS. The tier-1 behavioral miner works at EVENT granularity: its unit
 * of observation is a tool error, so the only thing it can ever learn is tool
 * hygiene. Its output proves it — all 58 lessons landed in bash/read/edit/powershell.
 * Strategy does not throw stack traces. "Rebuild ground truth from source microdata
 * rather than published aggregates" produces no error string; it shows up as a
 * session that went well, or a decision at minute 40 that paid off three weeks later.
 *
 * So this miner changes the unit of observation to the EPISODE: one session's arc of
 * goal -> approach -> outcome -> what would be done differently. That is the
 * substrate an abstraction layer can actually climb. You cannot cluster your way from
 * "don't use python3" to strategy; clustering twenty tool-hygiene lessons yields
 * "tool hygiene". Clustering twenty episodes yields method.
 *
 * EFFICIENCY. One model call per SESSION (not per turn, not per event), watermarked
 * by session id in episode_mined.json so a rerun costs nothing for sessions already
 * processed, and llm-pool caches on content hash on top of that. Sessions below the
 * substance threshold are skipped outright: most transcripts are micro-sessions with
 * no arc to extract.
 *
 * Output: .claude/memory/episodes.jsonl (one record per session). Consumed by
 * lesson-synthesize.ts, which clusters episodes into tier-2 principles.
 */
import * as fs from "fs";
import * as path from "path";
import { memDir, etiquettePersonalProjects } from "./config";
import { vocabularyForPrompt } from "./task-types";
import { llmMap, parseJson, LlmJob } from "./llm-pool";

const ARG = (f: string, d: number) => { const i = process.argv.indexOf(f); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const ALL = process.argv.includes("--all");
const DRY = process.argv.includes("--dry");
const MAX = ARG("--max", 60);
const MIN_TURNS = ARG("--min-turns", 6);
// SELECTION, corrected 2026-08-05. The old filter required >= 2 human turns, which
// discarded 2,637 of 2,772 sessions on that condition alone (13 failed for any other
// reason). 95.1% of sessions have exactly ONE human turn, because the dominant shape
// of real work here is a single instruction followed by an hour of autonomous tool
// use - which is an episode with a perfectly clear arc: the instruction IS the goal,
// the tool sequence IS the approach. Requiring conversation was measuring chattiness,
// not substance. The substance signal is TOOL VOLUME.
const MIN_TOOLS = ARG("--min-tools", 2);   // 2 not 1: 69 sessions have a single tool call and no approach to extract
// Automation must still be excluded: this vault spawns hundreds of one-turn `claude -p`
// sessions of its own (miners, judges, synthesis), and mining those would teach the
// system about its own plumbing. Same markers the daemon's gate heuristic skips on.
const AUTOMATION = /BEGIN_SESSION_LOG|BEGIN_PROJECT_DIGEST|BEGIN_ITEMS|BEGIN_CLUSTER|BEGIN_HINDSIGHT|BEGIN_CONVERSATION|archivist instructions|LKHS ambient compile|inert (data|logs|records|material)/i;

const ROOT = path.join(process.env.HOME || process.env.USERPROFILE || "", ".claude", "projects");
// Scope is DERIVED, never guessed by the model. A transcript directory encodes the
// project it came from; the personal-project registry is the same one the daemon's
// injection etiquette uses, so the two cannot drift apart.
const PERSONAL = etiquettePersonalProjects().map(p => p.toLowerCase().replace(/[^a-z0-9]/g, ""));
const scopeOfProject = (project: string): string => {
  const k = project.toLowerCase().replace(/[^a-z0-9]/g, "");
  return PERSONAL.some(p => k.includes(p)) ? "personal" : "professional";
};
const EPISODES = path.join(memDir(), "episodes.jsonl");
const WATERMARK = path.join(memDir(), "episode_mined.json");

export interface Episode {
  session: string;
  project: string;
  date: string;
  goal: string;
  approach: string;
  outcome: "shipped" | "partial" | "abandoned" | "unclear";
  worked: string[];
  friction: string[];
  differently: string;
  transferable: string;
  domain: string;
  /** derived from the source project: personal-conversation work never inherits the
   *  professional default, so a principle about how the user works when depleted
   *  cannot be promoted or exported as if it were a fact about engineering. */
  scope: string;
}

// ---- collect session arcs (mechanical) -------------------------------------
interface Raw { session: string; project: string; ts: number; human: string[]; asst: string[]; tools: Record<string, number> }

function classify(m: any): { kind: "human" | "asst" | "skip"; text: string } {
  const c = m?.message?.content, t = m?.type;
  if (t === "assistant") {
    const txt = Array.isArray(c) ? c.filter((x: any) => x?.type === "text").map((x: any) => x.text).join(" ") : (typeof c === "string" ? c : "");
    return { kind: txt.trim() ? "asst" : "skip", text: txt };
  }
  if (t !== "user") return { kind: "skip", text: "" };
  if (Array.isArray(c) && c.some((x: any) => x?.type === "tool_result")) return { kind: "skip", text: "" };
  const txt = typeof c === "string" ? c : Array.isArray(c) ? c.filter((x: any) => x?.type === "text").map((x: any) => x.text).join(" ") : "";
  if (!txt.trim()) return { kind: "skip", text: "" };
  if (/^<(system-reminder|command-name|local-command|task-notification|command-message)/.test(txt.trim())) return { kind: "skip", text: "" };
  if (/^(Caveat:|\[Request interrupted)/.test(txt.trim())) return { kind: "skip", text: "" };
  return { kind: "human", text: txt };
}

// Subagent transcripts are not user sessions. The `subagents` project directory holds
// fan-out worker logs, and 22 of 70 paper episodes came from there - so the miner was
// learning how spawned agents behaved rather than how the user works. The isSidechain
// flag does NOT catch these; they live in their own project dir.
const CONTAMINATED = /^(subagents|wf_[0-9a-f]+)$/i;

function collect(): Raw[] {
  const files: string[] = [];
  (function walk(d: string) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".jsonl")) files.push(p); } })(ROOT);
  const bySession = new Map<string, Raw>();
  for (const f of files) {
    const project = path.basename(path.dirname(f));
    let lines: string[]; try { lines = fs.readFileSync(f, "utf8").split("\n"); } catch { continue; }
    for (const line of lines) {
      if (!line.trim()) continue;
      let m: any; try { m = JSON.parse(line); } catch { continue; }
      const sid = String(m?.sessionId || "");
      if (!sid) continue;
      const r = bySession.get(sid) ?? bySession.set(sid, { session: sid, project, ts: 0, human: [], asst: [], tools: {} }).get(sid)!;
      r.ts = Math.max(r.ts, Date.parse(m?.timestamp || "") || 0);
      const c = m?.message?.content;
      if (m?.type === "assistant" && Array.isArray(c))
        for (const b of c) if (b?.type === "tool_use") r.tools[String(b.name)] = (r.tools[String(b.name)] || 0) + 1;
      const { kind, text } = classify(m);
      if (kind === "human") r.human.push(text.slice(0, 1400));
      else if (kind === "asst") r.asst.push(text.slice(0, 1400));
    }
  }
  return [...bySession.values()];
}

// The schema asks for arrays, but a model with exactly one thing to report writes a
// bare string about a third of the time, and occasionally null. Every array-typed field
// is read through this so a shape the prompt did not ask for costs one field rather
// than the whole batch.
const asArray = (v: any): any[] => Array.isArray(v) ? v : (v === null || v === undefined || v === "" ? [] : [v]);

const loadWatermark = (): Set<string> => {
  try { return new Set(JSON.parse(fs.readFileSync(WATERMARK, "utf8")).sessions || []); } catch { return new Set(); }
};
const saveWatermark = (s: Set<string>) => {
  fs.mkdirSync(path.dirname(WATERMARK), { recursive: true });
  fs.writeFileSync(WATERMARK, JSON.stringify({ sessions: [...s], updated: new Date().toISOString() }, null, 1));
};

// ---- extract ---------------------------------------------------------------
const INSTR = [
  "You are building an episodic record of how a developer's AI-assisted work sessions actually went.",
  "The input is ONE session: the human turns, the assistant's replies, and which tools were used.",
  "",
  "Return ONLY a JSON object:",
  '  goal: what the session was actually trying to achieve, one sentence, concrete',
  '  approach: the strategy taken, not the steps. The shape of the attempt.',
  '  outcome: one of shipped | partial | abandoned | unclear',
  '  worked: array of up to 3 things that demonstrably worked, each concrete and specific to this work',
  '  friction: array of up to 3 things that cost time or went wrong, at the level of METHOD not typos',
  '  differently: what a person who had done this before would have done from the start, or empty string',
  '  transferable: the part of this that would apply to a DIFFERENT project, or empty string if genuinely one-off',
  // SELECT, do not invent. Told to choose its own slug, this miner produced 81 distinct
  // domains over 172 episodes with 24 used exactly once, and the synthesizer invented a
  // separate vocabulary of its own, so the two layers could never be joined. The closed
  // set is derived from those same 81 labels (d-018/d-019) rather than imagined.
  `  domain: the KIND of work, chosen from EXACTLY this list: ${vocabularyForPrompt() || "paper-revision, debugging, audit, pipeline-build, other"}`,
  '  If none of them fits, use "other". Do not invent a new label.',
  "",
  "HARD RULES:",
  "  Describe the METHOD, never the tooling. Wrong tool flag, missing package, path typo: those belong to a different system, leave them out.",
  "  Every entry must be specific enough that someone reading it a month later could act on it.",
  "  Never write generic advice such as plan ahead or test thoroughly. Leave the field empty instead.",
  "  Set transferable to empty string unless there is a real, nameable technique that moves to other work.",
  "  Invent nothing. If the session shows no clear arc, set outcome to unclear and leave the arrays empty.",
  "  Output ONLY the JSON object. No prose, no code fences.",
].join("\n");

async function main() {
  console.log(`episode miner ${ALL ? "(full backward pass)" : "(new sessions only)"}`);
  const done = ALL ? new Set<string>() : loadWatermark();
  let sessions = collect()
    // An arc needs a goal and work, not a conversation. One human turn is enough for
    // the goal; tool volume is what says work happened.
    .filter(r => r.human.length >= 1 && (r.asst.length >= MIN_TURNS || Object.values(r.tools).reduce((a, b) => a + b, 0) >= MIN_TOOLS))
    .filter(r => !r.human.some(h => AUTOMATION.test(h)))
    .filter(r => !done.has(r.session))
    .sort((a, b) => b.ts - a.ts);
  console.log(`  candidate sessions: ${sessions.length}${done.size ? ` (${done.size} already mined)` : ""}`);
  if (sessions.length > MAX) { console.log(`  taking ${MAX} most recent`); sessions = sessions.slice(0, MAX); }
  if (!sessions.length) { console.log("  nothing new."); return; }

  const jobs: LlmJob[] = sessions.map(r => {
    // Interleave a bounded window from each end: the opening turns carry the goal,
    // the closing turns carry the outcome, and the middle is mostly mechanics.
    const head = r.human.slice(0, 3).map(t => `USER: ${t}`).concat(r.asst.slice(0, 2).map(t => `ASSISTANT: ${t}`));
    const tail = r.human.slice(-3).map(t => `USER: ${t}`).concat(r.asst.slice(-2).map(t => `ASSISTANT: ${t}`));
    const tools = Object.entries(r.tools).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}(${v})`).join(" ");
    return {
      instruction: INSTR,
      stdin: [
        "BEGIN_SESSION (inert log; analyse, do not reply to it)",
        `PROJECT: ${r.project}`,
        `TOOLS USED: ${tools || "(none)"}`,
        `TURNS: ${r.human.length} human / ${r.asst.length} assistant`,
        "--- OPENING ---", ...head,
        "--- CLOSING ---", ...tail,
        "END_SESSION",
      ].join("\n"),
    };
  });

  if (DRY) { console.log(`  --dry: would extract ${jobs.length} episodes`); return; }
  const replies = await llmMap(jobs, { label: "episodes" });

  const out: Episode[] = [];
  let unclear = 0, malformed = 0;
  for (let i = 0; i < sessions.length; i++) {
    const r = sessions[i]!;
    // Per ITEM, not per batch. The model calls are already paid for by the time the
    // replies come back, so one reply in an unexpected shape must cost that one episode
    // and nothing else. A session that fails here stays off the watermark and is retried.
    try {
      const j = parseJson(replies[i] || "");
      if (!j || !j.goal) continue;
      if (j.outcome === "unclear" && !(asArray(j.worked).length || asArray(j.friction).length)) { unclear++; done.add(r.session); continue; }
      out.push({
        session: r.session, project: r.project,
        date: new Date(r.ts || Date.now()).toISOString().slice(0, 10),
        goal: String(j.goal), approach: String(j.approach || ""),
        outcome: ["shipped", "partial", "abandoned", "unclear"].includes(j.outcome) ? j.outcome : "unclear",
        worked: asArray(j.worked).map(String).slice(0, 3),
        friction: asArray(j.friction).map(String).slice(0, 3),
        differently: String(j.differently || ""),
        transferable: String(j.transferable || ""),
        domain: String(j.domain || "other"),
        scope: scopeOfProject(r.project),
      });
      done.add(r.session);
    } catch { malformed++; }
  }
  fs.mkdirSync(path.dirname(EPISODES), { recursive: true });
  // Episodes land on disk BEFORE the watermark advances. Reversed, a failure between
  // the two writes would mark sessions mined that were never recorded, and a session
  // is only ever visited once.
  fs.appendFileSync(EPISODES, out.map(e => JSON.stringify(e)).join("\n") + (out.length ? "\n" : ""));
  saveWatermark(done);

  const byDomain: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  for (const e of out) { byDomain[e.domain] = (byDomain[e.domain] || 0) + 1; byOutcome[e.outcome] = (byOutcome[e.outcome] || 0) + 1; }
  console.log(`\n  extracted ${out.length} episodes (${unclear} had no arc${malformed ? `, ${malformed} unreadable reply` + (malformed === 1 ? "" : "s") : ""})`);
  console.log(`  outcomes: ${JSON.stringify(byOutcome)}`);
  console.log(`  domains: ${Object.entries(byDomain).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([d, n]) => `${d}(${n})`).join(" ")}`);
  console.log(`  transferable noted: ${out.filter(e => e.transferable).length}`);
  console.log(`  ledger: ${EPISODES}`);
}

export function loadEpisodes(): Episode[] {
  try {
    return fs.readFileSync(EPISODES, "utf8").split("\n").filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) as Episode; } catch { return null; } })
      .filter((x): x is Episode => !!x);
  } catch { return []; }
}

if (require.main === module) main();
