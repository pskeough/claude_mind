// PreToolUse lesson trigger: node port of lkhs-pretool-lesson.ps1 (2026-10-26).
//
// WHY A PORT. The PowerShell version cost 750-920 ms per tool call on this host
// (powershell.exe cold start plus ConvertFrom-Json on a 30 KB index), on EVERY tool
// call in every session. Node does the same work in roughly a third of that. The
// contract, the matching rules, the per-session dedupe and the fire log are unchanged;
// see the .ps1 for the reasoning behind each, which is kept there as the reference.
//
// CONTRACT. stdin is the PreToolUse payload. Emit additionalContext when a lesson
// matches, stay silent otherwise, never block, never throw.
import { readFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const vault = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // <vault>/.claude/hooks -> <vault>
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try { run(); } catch { /* never let a lesson hint break a tool call */ }
  process.exit(0);
});

function run() {
  if (!raw) return;
  const payload = JSON.parse(raw);
  const tool = String(payload.tool_name ?? "");
  if (!tool) return;

  let index = join(vault, ".claude", "memory", "lesson-triggers.json");
  if (!existsSync(index)) return;
  const rules = JSON.parse(readFileSync(index, "utf8").replace(/^﻿/, "")).rules;
  if (!rules?.length) return;

  // Executable fields only, never `description` (see the .ps1).
  const ti = payload.tool_input ?? {};
  const fields = ["command", "file_path", "url", "pattern", "notebook_path", "path"]
    .map((k) => ti[k]).filter(Boolean).map(String);
  if (!fields.length) return;
  const argText = fields.join(" ").toLowerCase();
  const toolLower = tool.toLowerCase();

  let hits = rules.filter((r) => {
    if (!toolLower.includes(String(r.match).toLowerCase())) return false;
    if (r.re?.length) {
      // PowerShell -match is case-insensitive; keep that.
      return r.re.every((rx) => { try { return new RegExp(rx, "i").test(argText); } catch { return false; } });
    }
    if (r.when?.length) return r.when.every((t) => argText.includes(String(t).toLowerCase()));
    return true;
  });
  if (!hits.length) return;

  // One fire per lesson per session.
  let seenPath = null;
  const sid = String(payload.session_id ?? "").replace(/[^A-Za-z0-9\-_]/g, "");
  if (sid) {
    const seenDir = join(vault, ".claude", "memory", "lesson-session");
    seenPath = join(seenDir, `${sid}.txt`);
    let seen = "";
    try { seen = readFileSync(seenPath, "utf8"); } catch { }
    if (seen) {
      hits = hits.filter((h) => !seen.includes(`|${h.id}|`));
      if (!hits.length) return;
    } else {
      try {
        if (!existsSync(seenDir)) mkdirSync(seenDir, { recursive: true });
        else {
          const cut = Date.now() - 14 * 864e5;
          for (const f of readdirSync(seenDir)) {
            if (!f.endsWith(".txt")) continue;
            const p = join(seenDir, f);
            try { if (statSync(p).mtimeMs < cut) unlinkSync(p); } catch { }
          }
        }
      } catch { }
    }
  }

  // Specificity first, popularity second; cap at 2.
  hits = hits
    .sort((a, b) => (parseInt(b.spec) || 0) - (parseInt(a.spec) || 0) || (parseInt(b.sessions) || 0) - (parseInt(a.sessions) || 0))
    .slice(0, 2);

  try {
    const fire = { ts: new Date().toISOString(), session: String(payload.session_id ?? ""), tool, ids: hits.map((h) => h.id), cwd: String(payload.cwd ?? "") };
    appendFileSync(join(vault, ".claude", "memory", "lesson-fires.jsonl"), JSON.stringify(fire) + "\n", "utf8");
  } catch { }
  if (seenPath) {
    try { appendFileSync(seenPath, hits.map((h) => `|${h.id}|`).join("\n") + "\n", "utf8"); } catch { }
  }

  const lines = hits.map((h) => `- ${h.action}  [seen in ${h.sessions} past sessions; check whether it applies here]`);
  const ctx = `Prior experience with ${tool} in this environment, surfaced because you are about to call it:\n${lines.join("\n")}\nConsider it against what you are actually doing - if it does not apply here, ignore it and carry on.`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: ctx } }));
}
