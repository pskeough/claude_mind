#!/usr/bin/env node
/**
 * morning-brief.mjs — deliver the nightly brief instead of waiting to be asked.
 *
 * The judgment already exists: salience.ts runs each night and writes
 * "if I could tell you three things this morning, what are they and why",
 * grounded in state.json, the reconcile proposals, fired intentions and the
 * hindsight headline, with invented urgency forbidden by its prompt. The
 * problem is purely delivery: today it surfaces only when the user opens
 * Claude Code and starts a session, which means the one artifact designed to
 * be read at the start of the day is the one thing you have to go looking for.
 *
 * This renders it as a standalone page and pushes it: a macOS notification, or
 * opening the page, or just writing the file. It is a READER over artifacts the
 * nightly pass already produced. It computes nothing and judges nothing, so it
 * cannot invent urgency that the salience prompt was careful to exclude.
 *
 * Off by default. Enable in .claude/lkhs.config.json:
 *
 *   "briefs": { "morning": true, "mode": "notify" }
 *
 * mode: "notify" (default, macOS banner) | "open" (open the page) | "both" | "file"
 *
 *   node scripts/morning-brief.mjs           (respects config)
 *   node scripts/morning-brief.mjs --open    (force open, ignore config mode)
 *   node scripts/morning-brief.mjs --force   (render even if the module is off)
 *   node scripts/morning-brief.mjs --dry     (print the sections, write nothing)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

const VAULT = process.env.LKHS_VAULT_ROOT || process.cwd();
const MEM = path.join(VAULT, ".claude", "memory");
const OUT_DIR = path.join(MEM, "reports");
const OUT = path.join(OUT_DIR, "morning-brief.html");

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const FORCE = argv.includes("--force");
const FORCE_OPEN = argv.includes("--open");
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT_PATH = flag("out") || OUT;

const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const readJson = (p) => { try { return JSON.parse(read(p)); } catch { return null; } };

// Module flag, merged the same way config.ts does it: global base, repo overlay.
const cfg = {
  ...(readJson(path.join(os.homedir(), ".claude", "lkhs-capture-config.json")) || {}),
  ...(readJson(path.join(VAULT, ".claude", "lkhs.config.json")) || {}),
};
const briefs = cfg.briefs || {};
if (!briefs.morning && !FORCE) {
  console.log('morning brief off (set "briefs": { "morning": true } in .claude/lkhs.config.json)');
  process.exit(0);
}
const mode = FORCE_OPEN ? "open" : (briefs.mode || "notify");

// ---------------------------------------------------------------------------
// Source artifacts. TODAY.md is the digest and already embeds the salience
// brief at its top while fresh; salience.md is read separately so a STALE
// brief can be labelled as stale rather than shown as if it were this morning's.
// ---------------------------------------------------------------------------
const today = read(path.join(MEM, "TODAY.md"));
if (!today) {
  console.error(`no TODAY.md at ${path.join(MEM, "TODAY.md")}\n  FIX: npm run state`);
  process.exit(1);
}

const salienceRaw = read(path.join(MEM, "salience.md"));
const genMatch = salienceRaw.match(/<!--\s*generated\s+(\S+)/);
const salienceAgeH = genMatch ? (Date.now() - Date.parse(genMatch[1])) / 3_600_000 : Infinity;
const salienceFresh = salienceAgeH < 36; // same freshness contract as state-rollup
// Strip the generation comment first, THEN the heading: the heading is only at
// offset 0 once the comment and its trailing newline are gone.
const salienceBody = salienceRaw.replace(/<!--[\s\S]*?-->/, "").trim().replace(/^##.*\n/, "").trim();

/**
 * Pull one labelled block out of TODAY.md. The digest is a flat list of
 * `Label:` headers each followed by indented `  - item` lines, so a section
 * runs until the next unindented line.
 */
function section(label) {
  const lines = today.split("\n");
  const start = lines.findIndex((l) => l.startsWith(label));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line)) break;
    const item = line.replace(/^\s*-\s*/, "").trim();
    if (item) out.push(item);
  }
  return out;
}

const deadlines = section("Dated deadlines:");
const lanes = section("Active lanes");
const attention = section("Attention:");
const reconcile = section("Reconcile inbox:");
const inbox = section("Memory inbox:");
const health = (today.match(/^Nightly health:.*$/m) || [""])[0];

if (DRY) {
  console.log(`salience: ${salienceFresh ? `fresh (${salienceAgeH.toFixed(1)}h)` : "STALE, would be labelled"}`);
  console.log(`deadlines ${deadlines.length} | lanes ${lanes.length} | attention ${attention.length} | decisions ${reconcile.length + inbox.length}`);
  console.log(`mode ${mode} -> ${OUT_PATH}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Render. Self-contained, no network, follows the reader's light/dark setting.
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// The salience brief is written as markdown with **bold** leads and `code` refs.
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");

const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

const list = (items, cls = "") => items.length
  ? `<ul class="${cls}">${items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`
  : "";

const block = (title, body, note = "") => body
  ? `<section><h2>${esc(title)}</h2>${note ? `<p class="note">${esc(note)}</p>` : ""}${body}</section>`
  : "";

const salienceHtml = salienceBody
  ? `<div class="salience">${salienceBody.split(/\n\s*\n/).map((p) => `<p>${inline(p.replace(/^\d+\.\s*/, ""))}</p>`).join("")}</div>`
  : `<p class="note">No brief was generated last night. Run <code>npm run salience</code>.</p>`;

const decisions = [...reconcile, ...inbox];

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Morning brief — ${esc(dateLabel)}</title>
<style>
  :root { color-scheme: light dark;
    --bg:#fbfbfa; --fg:#1c1c1a; --muted:#6b6b66; --line:#e4e4df; --card:#fff; --accent:#7a5c3e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16161a; --fg:#e8e8e4; --muted:#9a9a94; --line:#2c2c32; --card:#1e1e23; --accent:#c9a87c; } }
  * { box-sizing:border-box; }
  body { margin:0; padding:2.5rem 1.25rem 4rem; background:var(--bg); color:var(--fg);
    font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,sans-serif; }
  main { max-width:46rem; margin:0 auto; }
  header { border-bottom:1px solid var(--line); padding-bottom:1rem; margin-bottom:2rem; }
  h1 { font-size:1.5rem; margin:0 0 .25rem; letter-spacing:-.01em; }
  .date { color:var(--muted); font-size:.9rem; }
  section { margin-bottom:2.25rem; }
  h2 { font-size:.78rem; text-transform:uppercase; letter-spacing:.09em; color:var(--muted);
    font-weight:600; margin:0 0 .85rem; }
  .salience p { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--accent);
    border-radius:6px; padding:.9rem 1.1rem; margin:0 0 .7rem; }
  ul { margin:0; padding-left:1.15rem; }
  li { margin-bottom:.45rem; }
  .flag li { color:var(--accent); }
  .note { color:var(--muted); font-size:.88rem; margin:0 0 .6rem; }
  code { background:var(--card); border:1px solid var(--line); border-radius:3px;
    padding:.05rem .3rem; font-size:.86em; }
  footer { border-top:1px solid var(--line); padding-top:1rem; color:var(--muted); font-size:.8rem; }
</style></head>
<body><main>
<header><h1>Morning brief</h1><div class="date">${esc(dateLabel)}</div></header>
${block("Three things", salienceHtml, salienceFresh ? "" : `This brief is ${Math.round(salienceAgeH)}h old; last night's pass may not have run.`)}
${block("Deadlines", list(deadlines))}
${block("What you're working on", list(lanes), lanes.length ? "Each line is the lane and its next action." : "")}
${block("Needs your call", list(decisions, "flag"), decisions.length ? "Questions the system surfaced. Nothing here has been acted on." : "")}
${block("Attention", list(attention, "flag"))}
<footer>${esc(health)} &middot; generated from TODAY.md and salience.md &middot; nothing here was inferred by this page</footer>
</main></body></html>`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_PATH, html);
console.log(`brief written: ${OUT_PATH}`);

// ---------------------------------------------------------------------------
// Deliver. Failures here are logged, never fatal: the page is on disk either
// way, and a nightly job must not exit non-zero because a banner did not show.
// ---------------------------------------------------------------------------
const lead = (salienceBody.split("\n").find((l) => l.trim()) || "Your brief is ready.")
  .replace(/^\d+\.\s*/, "").replace(/[*`"\\]/g, "").slice(0, 170);

try {
  if ((mode === "notify" || mode === "both") && process.platform === "darwin") {
    spawnSync("osascript", ["-e", `display notification "${lead}" with title "Morning brief" sound name "Ping"`]);
  } else if (mode === "notify" || mode === "both") {
    console.log(`(notifications are macOS-only; page written)\n  ${lead}`);
  }
  if (mode === "open" || mode === "both") {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", OUT_PATH] : [OUT_PATH];
    spawnSync(opener, args, { detached: true });
  }
} catch (e) {
  console.error(`delivery failed (page still written): ${e.message}`);
}
