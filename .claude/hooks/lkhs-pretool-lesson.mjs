#!/usr/bin/env node
/**
 * PreToolUse lesson trigger — deliver a lesson at the moment it applies.
 *
 * Node port of the PowerShell original. The dev vault is Windows-only and could get away
 * with a .ps1; this fork installs on macOS and Linux, where PowerShell is absent, so a
 * .ps1 hook is not merely awkward, it silently never fires. Every other global hook here
 * is .mjs for the same reason.
 *
 * WHY THIS EXISTS AT ALL. Coverage analysis says active lessons cover ~44% of past tool
 * errors, but SessionStart is the wrong moment to deliver them: a lesson read at boot has
 * to survive forty turns before the call it applies to, while a lesson delivered when the
 * call is PENDING cannot be forgotten. Retrieval confirms the same split from the other
 * side — the store finds a python/utf8 lesson at 0.767 cosine for a matching query, and
 * the cross-encoder still withholds it, correctly, because "I'm about to run python" is
 * not a memory question. Relevance retrieval and action triggering are different problems.
 *
 * CONTRACT. stdin is the PreToolUse payload ({tool_name, tool_input, session_id, cwd}).
 * Emits additionalContext when a lesson matches, stays silent otherwise. NEVER blocks a
 * call; the framing is "consider", not "must", matching the register used everywhere else.
 *
 * PERFORMANCE. Runs on every tool call, so it must stay cheap: a direct read of the
 * trigger index written by lesson-embed. No tsx, no daemon, no model. If the index is
 * missing or malformed it exits silently rather than costing a call.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Match against EXECUTABLE fields only, never `description`. A replay over 64,441
 *  historical calls found a `find` rule firing on the word "Find" in a prose description
 *  — 61% of that rule's fires were commentary, not code. The description is what the
 *  assistant SAYS it is doing; the command is what will actually run. */
const EXEC_FIELDS = ["command", "file_path", "url", "pattern", "notebook_path", "path"];
const CAP = 2;

function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) return;
  let payload;
  try { payload = JSON.parse(raw); } catch { return; }
  const tool = String(payload?.tool_name || "");
  if (!tool) return;

  // Resolve the index from THIS SCRIPT'S location, not the active project. Lessons are
  // mined from every project's transcripts but live in one vault, so when the hook is
  // registered globally the active project is usually NOT that vault: keying off
  // CLAUDE_PROJECT_DIR made it silently find nothing everywhere except the vault itself.
  const vault = path.resolve(HERE, "..", "..");
  let index = path.join(vault, ".claude", "memory", "lesson-triggers.json");
  if (!fs.existsSync(index)) {
    if (process.env.CLAUDE_PROJECT_DIR)
      index = path.join(process.env.CLAUDE_PROJECT_DIR, ".claude", "memory", "lesson-triggers.json");
    if (!fs.existsSync(index)) return;
  }

  let rules;
  try { rules = JSON.parse(fs.readFileSync(index, "utf8")).rules; } catch { return; }
  if (!Array.isArray(rules) || !rules.length) return;

  const fields = EXEC_FIELDS.map(k => payload?.tool_input?.[k]).filter(Boolean).map(String);
  if (!fields.length) return;              // nothing executable to match against
  const args = fields.join(" ").toLowerCase();
  const toolLower = tool.toLowerCase();

  const hits = rules.filter(r => {
    if (!toolLower.includes(String(r.match || "").toLowerCase())) return false;
    // `when` is a narrowing condition: EVERY token must appear. A rule with no condition
    // would fire on every use of its tool, which is the bug that once surfaced a `gh`
    // lesson on `git status`; the index is built with 0 unconditional rules.
    if (!r.when || !r.when.length) return false;
    return r.when.every(t => args.includes(String(t).toLowerCase()));
  });
  if (!hits.length) return;

  // SPECIFICITY first, popularity second. Ranking by recurrence alone answered
  // `python3 script.py` with two UTF-8 lessons (44 and 21 sessions) while the two
  // python3-is-an-alias lessons that address that exact call were crowded out of the
  // 2-slot cap. `spec` is mean matched-token length: a rule matching on long rare tokens
  // predicted THIS call; a popular rule merely happens a lot.
  hits.sort((a, b) => (Number(b.spec) || 0) - (Number(a.spec) || 0) || (Number(b.sessions) || 0) - (Number(a.sessions) || 0));
  const top = hits.slice(0, CAP);

  // Record the fire. Without this, `injected`/`helped` on every lesson stay 0 forever and
  // the per-domain budget can only evict by how OFTEN a rule was mined, never by whether
  // it ever prevented anything. One append-only line, wrapped so a logging failure can
  // never cost a tool call.
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      session: String(payload?.session_id || ""),
      tool,
      ids: top.map(h => h.id),
      cwd: String(payload?.cwd || ""),
    });
    fs.appendFileSync(path.join(vault, ".claude", "memory", "lesson-fires.jsonl"), line + "\n", "utf8");
  } catch { /* logging is best-effort */ }

  const lines = top.map(h => `- ${h.action}  [this failed in ${h.sessions} previous sessions]`).join("\n");
  const ctx = [
    `Prior experience with ${tool} in this environment, surfaced because you are about to call it:`,
    lines,
    `Consider it against what you are actually doing - if it does not apply here, ignore it and carry on.`,
  ].join("\n");

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: ctx },
  }));
}

try { main(); } catch { /* never let a lesson hint break a tool call */ }
