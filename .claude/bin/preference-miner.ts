/**
 * preference-miner.ts — synthesis P3: mine voice-preference signal from captured
 * session transcripts (the in-chat iteration loop is the signal source; the
 * hindsight pass is the structural template).
 *
 * Pipeline per transcript: find mimesis compose events (mcp__mimesis*__
 * compose_in_voice tool_use blocks) -> collect the following draft/feedback
 * turns -> a `claude -p` judge (summaryModel, per the model policy) reconstructs
 * the chain: contrastive (rejected, feedback, revised) pairs with a feedback
 * class, plus the accepted final if the user kept one.
 *
 * SIGNAL HYGIENE (the load-bearing rule): only `stylistic` pairs feed the voice
 * loop. `substantive` (factual) corrections are logged for the memory side but
 * NEVER written to the voice artifacts; `mixed`/`unclear` are dropped. The
 * judge is told to prefer dropping over guessing.
 *
 * Writes (with --apply; report-only otherwise):
 *   - accepted finals   -> <mimesis>/profiles/<voice>/accepted/accepted.jsonl
 *   - stylistic pairs   -> <mimesis>/profiles/<voice>/accepted/edit_pairs.jsonl
 *     (both in the exact shapes accepted.py produces, so _anchor_block and
 *      recalibration consume them with no changes)
 *   - stylistic feedback -> .claude/memory/voice-rule-proposals.jsonl
 *     (recurring corrections; surfaced for review, never auto-applied)
 * Idempotency: sha1(transcript#chainStart) keys in .claude/memory/preference_mined.json;
 * re-runs skip mined chains. No silent caps: every skip/drop is counted + printed.
 *
 *   npx tsx .claude/bin/preference-miner.ts                dry-run, last 26h
 *   flags: --hours N | --all | --file <transcript.jsonl> | --apply | --max-chains N
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import { memDir, summaryModel, claudeBin, mimesisProfilesRoot, vaultRoot } from "./config";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const ALL = argv.includes("--all");
const argOf = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const HOURS = Number(argOf("--hours") || 26);
const ONLY_FILE = argOf("--file");
const MAX_CHAINS = Number(argOf("--max-chains") || 20);
// Voice-attribution guard: when a compose call did not pass an explicit voice,
// the chain's voice is a RETROACTIVE guess (today's active voice, which may not
// have been active when the session ran). Writing a guessed-voice draft into a
// profile's recalibration set contaminates its fingerprint, so --apply SKIPS
// fallback-attributed chains (and leaves them out of the ledger, so a later
// run can still mine them). --assume-voice <slug> overrides for a deliberate
// retro-mine into one profile. The forward path has no such ambiguity: the
// Mimesis event log records the RESOLVED voice at call time.
const ASSUME_VOICE = argOf("--assume-voice");
// Review aids: --chain k1,k2 restricts to specific chain keys; --verbose prints
// the extracted texts (finals + pair sides) so a dry-run doubles as a human
// review artifact before any --assume-voice apply.
const ONLY_CHAINS = argOf("--chain") ? new Set(String(argOf("--chain")).split(",").map(s => s.trim())) : null;
const VERBOSE = argv.includes("--verbose");

const LEDGER = path.join(memDir(), "preference_mined.json");
const RULE_PROPOSALS = path.join(memDir(), "voice-rule-proposals.jsonl");
const sha1 = (s: string) => crypto.createHash("sha1").update(s, "utf-8").digest("hex").slice(0, 16);

// ---- transcript parsing -------------------------------------------------------

export interface Turn { role: "user" | "assistant"; text: string; composeVoices: string[]; idx: number }

/** Flatten one Claude Code transcript jsonl into role/text turns; tag turns that
 *  invoked a mimesis compose tool with the requested voice (or "" = active).
 *  Exported for test-miner.ts (deterministic, no-LLM coverage of the parse layer). */
export function parseTranscript(file: string): Turn[] {
  const turns: Turn[] = [];
  let lines: string[];
  try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); } catch { return []; }
  for (const line of lines) {
    if (!line.trim()) continue;
    let j: any; try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== "user" && j.type !== "assistant") continue;
    const content = j.message?.content;
    let text = "";
    const composeVoices: string[] = [];
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === "text" && b.text) text += (text ? "\n" : "") + b.text;
        if (b?.type === "tool_use" && /^mcp__mimesis[^_]*(-v2)?__compose_in_voice$/.test(String(b.name || "")))
          composeVoices.push(String(b.input?.voice || ""));
      }
    }
    if (!text.trim() && composeVoices.length === 0) continue;
    turns.push({ role: j.type, text: text.trim(), composeVoices, idx: turns.length });
  }
  return turns;
}

export interface Chain { file: string; startIdx: number; voice: string; voiceExplicit: boolean; key: string; turns: Turn[] }

/** Chains: compose event -> following turns until the next compose event / cap. */
export function extractChains(file: string, turns: Turn[], activeVoiceFallback: string): Chain[] {
  const chains: Chain[] = [];
  const starts = turns.filter(t => t.composeVoices.length > 0);
  for (const s of starts) {
    const next = starts.find(t => t.idx > s.idx);
    const end = Math.min(next ? next.idx : turns.length, s.idx + 25);
    const seq = turns.slice(s.idx, end).filter(t => t.text);
    // Minable = the user REACTED after the compose. The draft often lives in the
    // compose turn itself, so "one user turn after" is the right floor — a bare
    // compose with no reaction carries no preference signal. (test-miner.ts
    // caught the earlier ">=2 any-role turns" rule dropping minimal accepts.)
    if (!seq.some(t => t.idx > s.idx && t.role === "user")) continue;
    chains.push({
      file, startIdx: s.idx, voice: s.composeVoices[0] || activeVoiceFallback,
      voiceExplicit: !!s.composeVoices[0],
      key: sha1(`${file}#${s.idx}`), turns: seq,
    });
  }
  return chains;
}

// ---- judge extraction ---------------------------------------------------------

interface MinedPair { rejected: string; feedback: string; revised: string; feedback_class: string }
interface Mined { accepted: boolean; final_text: string | null; pairs: MinedPair[] }

function judgeChain(c: Chain): Mined | null {
  const convo = c.turns.map(t => `${t.role === "user" ? "USER" : "ASSISTANT"}${t.composeVoices.length ? " [invoked compose_in_voice]" : ""}:\n${t.text.slice(0, 1600)}`).join("\n\n---\n\n");
  const instruction = "Read the conversation and instructions in the input and output ONLY the requested JSON object. No prose, no code fences.";
  const stdin = [
    "This is a conversation excerpt where an assistant drafted text in the user's own voice and the user iterated on it in chat.",
    "Extract the preference signal:",
    '1. pairs: for each case where USER feedback led to a revised draft, one entry {"rejected": "<the draft text before>", "feedback": "<the user words>", "revised": "<the draft text after>", "feedback_class": "stylistic"|"substantive"|"mixed"|"unclear"}.',
    "   - stylistic = register, tone, length, rhythm, structure, word choice.",
    "   - substantive = factual corrections, content additions/removals, scope changes.",
    "   - mixed = both; unclear = cannot tell. PREFER unclear OVER GUESSING.",
    "   - rejected/revised must be VERBATIM draft text from the conversation (trim to the draft body; no commentary). Never fabricate.",
    '2. accepted + final_text: if the user clearly kept a final version (said so, or stopped iterating after a positive signal), final_text = that draft verbatim; else accepted=false, final_text=null.',
    "If the conversation contains no genuine draft iteration, return {\"accepted\": false, \"final_text\": null, \"pairs\": []}.",
    "",
    "BEGIN_CONVERSATION",
    convo,
    "END_CONVERSATION",
    "",
    'Output exactly: {"accepted": true|false, "final_text": "..."|null, "pairs": [...]}',
  ].join("\n");
  const res = spawnSync(claudeBin(), ["-p", instruction, "--model", summaryModel(), "--output-format", "text"], {
    cwd: vaultRoot(), input: stdin, shell: true, env: { ...process.env, LKHS_CAPTURE: "1" }, maxBuffer: 10 * 1024 * 1024, timeout: 300_000,
  });
  const raw = (res.stdout ? Buffer.from(res.stdout).toString("utf8") : "").trim();
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (res.status !== 0 || s < 0 || e < s) { console.error(`  judge failed for ${c.key} (status ${res.status})`); return null; }
  try {
    const j = JSON.parse(raw.slice(s, e + 1));
    return {
      accepted: !!j.accepted,
      final_text: typeof j.final_text === "string" && j.final_text.trim() ? j.final_text.trim() : null,
      pairs: (Array.isArray(j.pairs) ? j.pairs : []).filter((p: any) => p && p.rejected && p.revised && p.feedback_class)
        .map((p: any) => ({ rejected: String(p.rejected), feedback: String(p.feedback || ""), revised: String(p.revised), feedback_class: String(p.feedback_class).toLowerCase() })),
    };
  } catch (err: any) { console.error(`  judge parse failed for ${c.key}: ${err.message}`); return null; }
}

// ---- artifact writes (accepted.py-compatible shapes) --------------------------

function readJsonl(file: string): any[] {
  try { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}
function appendJsonl(file: string, rec: any): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(rec) + "\n");
}

function writeArtifacts(c: Chain, m: Mined, kept: MinedPair[]): { accepts: number; pairs: number } {
  const root = mimesisProfilesRoot();
  if (!root) return { accepts: 0, pairs: 0 };
  const profDir = path.join(root, c.voice);
  if (!fs.existsSync(path.join(profDir, "config.json"))) {
    console.error(`  no mimesis profile '${c.voice}' at ${profDir}; skipping writes for ${c.key}`);
    return { accepts: 0, pairs: 0 };
  }
  const ts = new Date().toISOString().slice(0, 19) + "Z";
  const session = path.basename(c.file, ".jsonl");
  let accepts = 0, pairs = 0;
  if (m.accepted && m.final_text) {
    const accFile = path.join(profDir, "accepted", "accepted.jsonl");
    const existing = readJsonl(accFile);
    appendJsonl(accFile, { id: `acc_${String(existing.length).padStart(3, "0")}`, text: m.final_text, task: null, source: "mined", timestamp: ts, session, mined_key: c.key });
    accepts++;
  }
  if (kept.length) {
    const pairFile = path.join(profDir, "accepted", "edit_pairs.jsonl");
    for (const p of kept) {
      const existing = readJsonl(pairFile);
      appendJsonl(pairFile, { id: `edit_${String(existing.length).padStart(3, "0")}`, ai_text: p.rejected, human_text: p.revised, move: "mined-chat", granularity: "document", task: null, timestamp: ts, session, mined_key: c.key });
      pairs++;
    }
  }
  return { accepts, pairs };
}

// ---- main ---------------------------------------------------------------------

function activeVoice(): string {
  const root = mimesisProfilesRoot();
  if (root) { try { const st = JSON.parse(fs.readFileSync(path.join(root, "state.json"), "utf8")); if (st.active) return String(st.active); } catch { /* */ } }
  return "personal";
}

function main() {
  const ledger: { keys: string[] } = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { keys: [] };
  const mined = new Set(ledger.keys);

  let files: string[] = [];
  if (ONLY_FILE) files = [path.resolve(ONLY_FILE)];
  else {
    const projRoot = path.join(os.homedir(), ".claude", "projects");
    const cutoff = ALL ? 0 : Date.now() - HOURS * 3600_000;
    try {
      for (const dir of fs.readdirSync(projRoot)) {
        const d = path.join(projRoot, dir);
        let entries: string[]; try { entries = fs.readdirSync(d); } catch { continue; }
        for (const f of entries) if (f.endsWith(".jsonl")) {
          const p = path.join(d, f);
          try { if (fs.statSync(p).mtimeMs >= cutoff) files.push(p); } catch { /* */ }
        }
      }
    } catch { /* no projects dir */ }
  }

  const fallback = activeVoice();
  const chains: Chain[] = [];
  for (const f of files) {
    const turns = parseTranscript(f);
    if (!turns.some(t => t.composeVoices.length)) continue;
    chains.push(...extractChains(f, turns, fallback));
  }
  const candidates = ONLY_CHAINS ? chains.filter(c => ONLY_CHAINS.has(c.key)) : chains;
  const fresh = candidates.filter(c => !mined.has(c.key));
  console.log(`transcripts scanned: ${files.length} | compose chains: ${chains.length}${ONLY_CHAINS ? ` | selected: ${candidates.length}` : ""} | already mined: ${candidates.length - fresh.length} | fresh: ${fresh.length}${fresh.length > MAX_CHAINS ? ` (capped to ${MAX_CHAINS} this run — remainder next run)` : ""}`);
  const work = fresh.slice(0, MAX_CHAINS);
  if (!work.length) { console.log("nothing to mine."); return; }

  const counts = { accepts: 0, pairsKept: 0, dropSubstantive: 0, dropMixed: 0, dropUnclear: 0, ruleProps: 0, voiceSkipped: 0 };
  for (const c of work) {
    if (ASSUME_VOICE && !c.voiceExplicit) c.voice = ASSUME_VOICE;
    if (APPLY && !c.voiceExplicit && !ASSUME_VOICE) {
      counts.voiceSkipped++;
      console.log(`\nskipping ${c.key}: voice is a retroactive guess (${c.voice}); pass --assume-voice ${c.voice} to mine it deliberately`);
      continue; // NOT added to the ledger — stays minable later
    }
    console.log(`\nmining ${c.key} [voice=${c.voice}${c.voiceExplicit ? "" : " (fallback)"}] ${path.basename(c.file)}#${c.startIdx} (${c.turns.length} turns, ${APPLY ? "APPLY" : "DRY-RUN"})`);
    const m = judgeChain(c);
    if (!m) continue;
    const kept = m.pairs.filter(p => p.feedback_class === "stylistic");
    counts.dropSubstantive += m.pairs.filter(p => p.feedback_class === "substantive").length;
    counts.dropMixed += m.pairs.filter(p => p.feedback_class === "mixed").length;
    counts.dropUnclear += m.pairs.filter(p => !["stylistic", "substantive", "mixed"].includes(p.feedback_class) || p.feedback_class === "unclear").length;
    console.log(`  judge: accepted=${m.accepted} pairs=${m.pairs.length} (stylistic ${kept.length})`);
    for (const p of kept) console.log(`    pair [${p.feedback_class}] "${p.feedback.slice(0, 70)}"`);
    if (VERBOSE) {
      if (m.accepted && m.final_text) console.log(`  FINAL (would append to accepted.jsonl):\n    ${m.final_text.slice(0, 500).replace(/\n/g, "\n    ")}`);
      for (const p of kept) console.log(`  PAIR rejected:\n    ${p.rejected.slice(0, 350).replace(/\n/g, "\n    ")}\n  PAIR revised:\n    ${p.revised.slice(0, 350).replace(/\n/g, "\n    ")}`);
    }
    if (APPLY) {
      const w = writeArtifacts(c, m, kept);
      counts.accepts += w.accepts; counts.pairsKept += w.pairs;
      for (const p of kept) if (p.feedback.trim()) {
        appendJsonl(RULE_PROPOSALS, { ts: new Date().toISOString(), voice: c.voice, feedback: p.feedback.slice(0, 300), session: path.basename(c.file, ".jsonl"), mined_key: c.key });
        counts.ruleProps++;
      }
      mined.add(c.key);
    } else {
      counts.accepts += m.accepted && m.final_text ? 1 : 0; counts.pairsKept += kept.length;
    }
  }

  if (APPLY) fs.writeFileSync(LEDGER, JSON.stringify({ keys: [...mined] }, null, 0));
  console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN (nothing written)"}: accepts=${counts.accepts} stylistic-pairs=${counts.pairsKept} | dropped: substantive=${counts.dropSubstantive} mixed=${counts.dropMixed} unclear=${counts.dropUnclear} | rule-proposals=${counts.ruleProps}${counts.voiceSkipped ? ` | voice-guess chains skipped: ${counts.voiceSkipped} (still minable via --assume-voice)` : ""}`);
}

if (require.main === module) main();
