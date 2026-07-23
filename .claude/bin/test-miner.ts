/**
 * test-miner.ts — deterministic (no-LLM) unit test for the preference miner's
 * parse layer: transcript flattening, compose-event tagging, chain extraction,
 * voice-attribution flags, and idempotency keys. The judge/extraction layer is
 * covered separately by the live fixture run (see SYNTHESIS-BUILD-SPEC P3 log).
 *
 *   npx tsx .claude/bin/test-miner.ts   (also: npm run test:miner)
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseTranscript, extractChains } from "./preference-miner";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.error(`  FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
}

const tmp = path.join(os.tmpdir(), `miner-parse-test-${process.pid}.jsonl`);
const lines = [
  { type: "user", message: { content: "write a note in my voice" } },
  { type: "assistant", message: { content: [ { type: "tool_use", name: "mcp__mimesis-v2__compose_in_voice", input: { task: "note", voice: "example" } }, { type: "text", text: "Draft one." } ] } },
  { type: "user", message: { content: "shorter" } },
  { type: "assistant", message: { content: [{ type: "text", text: "Draft two." }] } },
  // second compose, v1 server name, NO explicit voice -> fallback + new chain boundary
  { type: "assistant", message: { content: [ { type: "tool_use", name: "mcp__mimesis__compose_in_voice", input: { task: "another" } }, { type: "text", text: "Other draft." } ] } },
  { type: "user", message: { content: "good" } },
  // noise that must be ignored: unrelated tool, tool_result-only user turn, blank
  { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__lkhs-memory__search_memory", input: { q: "x" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", content: "..." }] } },
  { type: "summary", summary: "not a turn" },
];
fs.writeFileSync(tmp, lines.map(l => JSON.stringify(l)).join("\n") + "\n");

console.log("parseTranscript:");
const turns = parseTranscript(tmp);
check("turn count (noise/toolresult/summary excluded)", turns.length === 6, `got ${turns.length}`);
check("compose tags on both server name variants", turns.filter(t => t.composeVoices.length).length === 2);
check("explicit voice captured", turns[1]!.composeVoices[0] === "example");
check("missing voice -> empty string sentinel", turns[4]!.composeVoices[0] === "");
check("text assembled from blocks", turns[1]!.text === "Draft one.");

console.log("extractChains:");
const chains = extractChains(tmp, turns, "fallback-voice");
check("two chains (second compose starts a new one)", chains.length === 2, `got ${chains.length}`);
check("chain 1 explicit voice", chains[0]!.voice === "example" && chains[0]!.voiceExplicit === true);
check("chain 2 fallback voice + flagged inexplicit", chains[1]!.voice === "fallback-voice" && chains[1]!.voiceExplicit === false);
check("chain 1 ends at chain 2's compose", chains[0]!.turns.every(t => t.idx < chains[1]!.startIdx));
check("stable idempotency keys", chains[0]!.key.length === 16 && chains[0]!.key !== chains[1]!.key);
const again = extractChains(tmp, parseTranscript(tmp), "fallback-voice");
check("keys deterministic across re-parse", again[0]!.key === chains[0]!.key && again[1]!.key === chains[1]!.key);

fs.unlinkSync(tmp);
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
