/**
 * persona-extract.ts — one-shot: turn the Claude chat export into workflow-ready
 * batches for the persona synthesis pass.
 *
 * Inputs (the export dir, passed as argv[2]):
 *   conversations.json  — 1,049 convos, ~3.5M tokens
 *   projects/*.json     — Claude Projects (incl. teenage-story corpus, bipolar interview)
 *
 * Outputs (.claude/memory/persona_raw/):
 *   timeline.json / timeline.md   — every conversation: date, title, msg count (programmatic, no LLM)
 *   batch-NN.md                   — chronological conversation batches (~140k tokens each)
 *   projects-personal.md          — project instructions + the personal/biographical docs
 *   stories-juvenilia.md          — the age 15–18 short-story corpus (its own batch)
 *   manifest.json                 — list of batch files for the workflow to iterate
 */
import * as fs from "fs";
import * as path from "path";

const EXPORT = process.argv[2];
if (!EXPORT) { console.error("usage: tsx persona-extract.ts <export-dir>"); process.exit(1); }

const OUT = path.join(__dirname, "..", "memory", "persona_raw");
fs.mkdirSync(OUT, { recursive: true });

const CHARS_PER_BATCH = 560_000; // ~140k tokens
const USER_CAP = 4000;           // trim giant pasted documents, keep substance
const ASST_CAP = 1200;           // assistant context, not the focus

function msgText(m: any): string {
  if (m.text && m.text.trim()) return m.text;
  const parts = Array.isArray(m.content) ? m.content : [];
  return parts.map((p: any) => p?.text || "").filter(Boolean).join("\n");
}
function role(m: any): string {
  const s = (m.sender || m.role || "").toLowerCase();
  return s.includes("human") || s === "user" ? "USER" : "ASSISTANT";
}

// ---- conversations -> timeline + batches ----------------------------------
const convs: any[] = JSON.parse(fs.readFileSync(path.join(EXPORT, "conversations.json"), "utf8"));
convs.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

const timeline: any[] = [];
for (const c of convs) {
  const msgs = c.chat_messages || [];
  const firstUser = msgs.find((m: any) => role(m) === "USER");
  timeline.push({
    date: String(c.created_at || "").slice(0, 10),
    title: c.name || "(untitled)",
    msgs: msgs.length,
    open: (msgText(firstUser || {}) || "").replace(/\s+/g, " ").slice(0, 160),
  });
}
fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify(timeline, null, 0));
fs.writeFileSync(
  path.join(OUT, "timeline.md"),
  "# Conversation timeline (programmatic, every conversation)\n\n" +
    timeline.map(t => `- ${t.date} — **${t.title}** (${t.msgs} msgs)${t.open ? `\n    opener: ${t.open}` : ""}`).join("\n"),
);

const manifest: string[] = [];
let batch: string[] = [];
let batchChars = 0;
let batchN = 0;
function flush() {
  if (!batch.length) return;
  const name = `batch-${String(batchN).padStart(2, "0")}.md`;
  fs.writeFileSync(path.join(OUT, name), batch.join("\n"));
  manifest.push(name);
  batch = []; batchChars = 0; batchN++;
}
for (const c of convs) {
  const msgs = c.chat_messages || [];
  if (!msgs.length) continue;
  const head = `\n\n========================================\n## ${String(c.created_at).slice(0, 10)} — ${c.name || "(untitled)"}\n`;
  const body: string[] = [head];
  for (const m of msgs) {
    const r = role(m);
    let t = msgText(m).trim();
    if (!t) continue;
    const cap = r === "USER" ? USER_CAP : ASST_CAP;
    if (t.length > cap) t = t.slice(0, cap) + ` …[+${t.length - cap} chars]`;
    body.push(`${r}: ${t}`);
  }
  const block = body.join("\n");
  if (batchChars + block.length > CHARS_PER_BATCH && batch.length) flush();
  batch.push(block);
  batchChars += block.length;
}
flush();

// ---- projects -> personal context + juvenilia -----------------------------
const PDIR = path.join(EXPORT, "projects");
const SKIP_SOURCE = /lionsmane|hericium|erinacine|funder|personality puzzle|lesson \d|unit \d|practice questions|study guide|course schedule/i;
const projFiles = fs.existsSync(PDIR) ? fs.readdirSync(PDIR) : [];

const projOut: string[] = ["# Claude Projects — instructions + personal/biographical docs\n"];
const storyOut: string[] = ["# Juvenilia: short-story corpus written age 15–18 (project: 'writings, reflcetions')\n"];
for (const f of projFiles) {
  const p = JSON.parse(fs.readFileSync(path.join(PDIR, f), "utf8"));
  const o = Array.isArray(p) ? p[0] : p;
  const isStories = /writings|reflcetions|reflections/i.test(o.name || "");
  projOut.push(`\n## Project: ${o.name}\n- description: ${o.description || ""}\n- created: ${String(o.created_at).slice(0,10)}`);
  if (o.prompt_template) projOut.push(`- instructions: ${o.prompt_template}`);
  for (const d of o.docs || []) {
    const content = d.content || d.text || "";
    if (!content) continue;
    if (isStories) { storyOut.push(`\n--- ${d.filename || d.uuid} ---\n${content}`); continue; }
    if (SKIP_SOURCE.test(d.filename || "")) { projOut.push(`- [source material skipped: ${d.filename}]`); continue; }
    projOut.push(`\n### Doc: ${d.filename}\n${content.slice(0, 30000)}`);
  }
}
fs.writeFileSync(path.join(OUT, "projects-personal.md"), projOut.join("\n"));
manifest.push("projects-personal.md");
if (storyOut.length > 1) { fs.writeFileSync(path.join(OUT, "stories-juvenilia.md"), storyOut.join("\n")); manifest.push("stories-juvenilia.md"); }

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

// ---- report ----
const sizes = manifest.map(m => ({ file: m, KB: Math.round(fs.statSync(path.join(OUT, m)).size / 1024) }));
console.log("conversations:", convs.length, "| timeline rows:", timeline.length);
console.log("batches + context files:");
console.table(sizes);
console.log("total batch chars (approx tokens):", sizes.reduce((a, b) => a + b.KB * 1024, 0), "(~" + Math.round(sizes.reduce((a, b) => a + b.KB * 1024, 0) / 4 / 1000) + "k tokens)");
console.log("OUT:", OUT);
