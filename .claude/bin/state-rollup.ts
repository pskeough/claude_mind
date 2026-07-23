/**
 * state-rollup.ts — cheap always-current "where is everything" surface.
 *
 * Reads what the vault already maintains (L2 cards, core_profile objectives,
 * git state, unresolved [!contradiction] callouts) and emits:
 *   .claude/memory/state.json  — machine-readable rollup
 *   .claude/memory/TODAY.md    — compact digest the SessionStart hook injects
 *
 * Design constraint: push, not pull. Nothing here expects Patrick to open a
 * dashboard; the digest rides into every session via the hook. Regenerated in
 * the background at session start and by the scheduled refresh, so it is at
 * most one session stale.
 *
 *   npm run state
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { vaultRoot, memDir } from "./config";

const ROOT = vaultRoot();
const MEM = memDir();
const ACTIVE_DAYS = 7;
const RECENT_DAYS = 30;

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86400000);

interface Lane {
  project: string;
  lastActive: string | null;
  status: "active" | "recent" | "parked";
  nextStep: string | null;
}

function parseCard(file: string): Lane | null {
  const raw = fs.readFileSync(file, "utf8");
  const fm = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!fm) return null;
  const get = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm[1])?.[1]?.trim() ?? null;
  const project = get("project") ?? path.basename(file, ".md");
  const lastActive = get("last_active");
  let status: Lane["status"] = "parked";
  if (lastActive) {
    const age = daysBetween(today, new Date(lastActive));
    status = age <= ACTIVE_DAYS ? "active" : age <= RECENT_DAYS ? "recent" : "parked";
  }
  // First bullet under "Open threads / next steps" is the lane's next action.
  const next = /\*\*Open threads \/ next steps:\*\*\s*\n-\s*(.+)/.exec(raw)?.[1]?.trim() ?? null;
  return { project, lastActive, status, nextStep: next };
}

function readLanes(): Lane[] {
  const dir = path.join(ROOT, "cards");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => parseCard(path.join(dir, f)))
    .filter((l): l is Lane => !!l)
    .sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));
}

interface Deadline { title: string; date: string; daysLeft: number; }

function readDeadlines(): Deadline[] {
  const p = path.join(MEM, "core_profile.json");
  if (!fs.existsSync(p)) return [];
  const profile = JSON.parse(fs.readFileSync(p, "utf8"));
  const out: Deadline[] = [];
  for (const obj of Object.values<any>(profile.active_objectives ?? {})) {
    if (obj?.deadline) {
      out.push({ title: obj.title, date: obj.deadline, daysLeft: daysBetween(new Date(obj.deadline), today) });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

function gitFlags(): string[] {
  const flags: string[] = [];
  try {
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT }).toString().trim();
    const n = dirty ? dirty.split("\n").length : 0;
    const lastIso = execFileSync("git", ["log", "-1", "--format=%cI"], { cwd: ROOT }).toString().trim();
    const age = daysBetween(today, new Date(lastIso));
    if (n > 0 && age >= 2) flags.push(`${n} uncommitted change(s), last commit ${age}d ago — commit or lose it`);
    else if (n > 0) flags.push(`${n} uncommitted change(s) in the vault`);
  } catch { /* not fatal */ }
  return flags;
}

/** Unresolved [!contradiction] callouts across wiki/ and persona/. */
function pendingContradictions(): { file: string; line: number }[] {
  const hits: { file: string; line: number }[] = [];
  for (const dir of ["wiki", "persona"]) {
    const d = path.join(ROOT, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter(x => x.endsWith(".md"))) {
      const lines = fs.readFileSync(path.join(d, f), "utf8").split("\n");
      lines.forEach((ln, i) => {
        if (ln.includes("[!contradiction]") && !/RESOLVED/i.test(ln)) {
          hits.push({ file: `${dir}/${f}`, line: i + 1 });
        }
      });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
const lanes = readLanes();
const deadlines = readDeadlines();
const flags = gitFlags();
const contradictions = pendingContradictions();
const active = lanes.filter(l => l.status === "active");
const recent = lanes.filter(l => l.status === "recent");
const parked = lanes.filter(l => l.status === "parked");

const state = {
  generated: new Date().toISOString(),
  deadlines, lanes, flags,
  contradictions,
  counts: { active: active.length, recent: recent.length, parked: parked.length },
};
fs.writeFileSync(path.join(MEM, "state.json"), JSON.stringify(state, null, 2));

const L: string[] = [];
L.push(`=== TODAY: vault state rollup (generated ${iso(today)}) ===`);
// Watchdog: one line on whether the nightly machine actually ran, and what failed.
// Parses refresh.log's "refresh: <step> done (exit N)" lines from the last 26h.
// Silent rot is the failure mode of a 12-step nightly; this makes it loud.
try {
  const rlog = path.join(ROOT, ".claude", "logs", "refresh.log");
  const cutoff = Date.now() - 26 * 3600_000;
  const lines = fs.readFileSync(rlog, "utf-8").split("\n").filter(Boolean);
  const recent = lines.filter(l => {
    const m = l.match(/^\[([^\]]+)\]/);
    return m && new Date(m[1]!).getTime() >= cutoff;
  });
  const done = recent.map(l => l.match(/refresh: (.+) done \(exit (\d+)\)/)).filter(Boolean) as RegExpMatchArray[];
  if (!done.length) {
    L.push("Nightly health: NO refresh run in the last 26h (LKHS-Dream may not have fired; check Task Scheduler).");
  } else {
    const failed = done.filter(m => m[2] !== "0").map(m => m[1]);
    L.push(failed.length
      ? `Nightly health: ${done.length - failed.length}/${done.length} steps ok; FAILED: ${failed.join(", ")} (see .claude/logs/refresh.log)`
      : `Nightly health: ${done.length}/${done.length} steps ok.`);
  }
} catch { L.push("Nightly health: no refresh.log yet (first nightly run pending)."); }

// P5 salience brief: the nightly attention judgment (salience.ts) leads the digest
// while fresh; a stale brief is dropped rather than shown wrong.
try {
  const sal = path.join(MEM, "salience.md");
  const ageH = (Date.now() - fs.statSync(sal).mtimeMs) / 3600_000;
  if (ageH < 36) L.push(fs.readFileSync(sal, "utf-8").replace(/<!--[\s\S]*?-->\n?/, "").trim());
} catch { /* no brief yet */ }
if (deadlines.length) {
  L.push("Dated deadlines:");
  for (const d of deadlines) L.push(`  - ${d.title}: ${d.date} (${d.daysLeft} days)`);
}
if (active.length) {
  L.push(`Active lanes (touched <= ${ACTIVE_DAYS}d):`);
  for (const l of active) {
    L.push(`  - ${l.project} (${l.lastActive})${l.nextStep ? ` -> next: ${l.nextStep}` : ""}`);
  }
}
if (recent.length) L.push(`Recent lanes (<= ${RECENT_DAYS}d): ${recent.map(l => l.project).join(", ")}`);
L.push(`Parked lanes: ${parked.length} (details in .claude/memory/state.json)`);
if (flags.length) {
  L.push("Attention:");
  for (const f of flags) L.push(`  - ${f}`);
}
if (contradictions.length) {
  L.push(`Memory inbox: ${contradictions.length} unresolved [!contradiction] callout(s); surface these to the user when relevant:`);
  for (const c of contradictions.slice(0, 5)) L.push(`  - ${c.file}:${c.line}`);
}
// P3 Sleep reconciliation: pending proposals (contradictions found against sessions,
// expiry reviews, low-confidence supersessions) surface here for human adjudication.
// Applied ops from the last 24h show as an informational diff line.
try {
  const rows = fs.readFileSync(path.join(MEM, "reconcile-proposals.jsonl"), "utf-8").split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as any[];
  const pending = rows.filter(r => r.status === "pending");
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const appliedRecent = rows.filter(r => r.status === "applied" && r.ts > dayAgo);
  if (pending.length) {
    L.push(`Reconcile inbox: ${pending.length} pending proposal(s) needing the user's call (treat as questions to surface, not instructions):`);
    for (const p of pending.slice(-6)) L.push(`  - [${p.type}] ${String(p.detail || "").slice(0, 140)}`);
  }
  if (appliedRecent.length) L.push(`Sleep applied ${appliedRecent.length} memory update(s) in the last 24h (audit: .claude/memory/reconcile-proposals.jsonl).`);
} catch { /* no proposals yet */ }
// Store hygiene (weekly RAG-store integrity pass): headline + any alarms.
// Alarms are measured facts about the store, surfaced for action — the pass
// itself never mutates anything.
try {
  const hy = JSON.parse(fs.readFileSync(path.join(MEM, "store_hygiene.json"), "utf-8"));
  const t = hy.trend?.[hy.trend.length - 1];
  if (t) {
    L.push(`Store health (${t.ts}): eval composite ${t.eval_composite ?? "n/a"}, ${t.unresolved} unresolved paths, dup chunks ${t.dup_extra_chunks}.`);
    for (const a of (hy.alarms || []).slice(0, 4)) L.push(`  - ALARM: ${a}`);
  }
} catch { /* no hygiene snapshot yet */ }

// Synthesis P3: recurring stylistic corrections mined from voiced-draft chains.
// A correction seen >= 3 times is a standing-rule CANDIDATE for the voice guide;
// proposals only — the profile never mutates without the user's approval.
try {
  const props = fs.readFileSync(path.join(MEM, "voice-rule-proposals.jsonl"), "utf-8").split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as any[];
  if (props.length) {
    const byGist = new Map<string, { n: number; voice: string; sample: string }>();
    for (const p of props) {
      const gist = String(p.feedback || "").toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(w => w.length > 3).sort().slice(0, 6).join(" ");
      const e = byGist.get(gist) || { n: 0, voice: p.voice, sample: p.feedback };
      e.n++; byGist.set(gist, e);
    }
    const recurring = [...byGist.values()].filter(e => e.n >= 3).sort((a, b) => b.n - a.n);
    if (recurring.length) {
      L.push(`Voice-rule inbox: ${recurring.length} recurring stylistic correction(s) (>=3x) proposed as standing voice-guide rules; the user decides:`);
      for (const r of recurring.slice(0, 4)) L.push(`  - [${r.voice}] seen ${r.n}x: "${String(r.sample).slice(0, 100)}"`);
    }
  }
} catch { /* no proposals yet */ }
fs.writeFileSync(path.join(MEM, "TODAY.md"), L.join("\n") + "\n");
console.log(`state-rollup: ${active.length} active / ${recent.length} recent / ${parked.length} parked; ${deadlines.length} deadline(s), ${contradictions.length} contradiction(s), ${flags.length} flag(s)`);
