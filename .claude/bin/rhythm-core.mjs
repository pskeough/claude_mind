/**
 * rhythm-core.mjs - the usage-rhythm layer (wellbeing module).
 *
 * Reads the owner's Claude use from three places and turns it into one row of
 * behavioural features per day:
 *   - Claude Desktop: a pulse the mind-wellbeing MCP server logs at the start of
 *     every reply (time, chat id, word count of her message; never the text);
 *   - claude.ai data exports she drops in (exact timestamps for every message,
 *     desktop, web and phone), which also seed the baseline on day one;
 *   - Claude Code transcripts (~/.claude/projects).
 * For any day an export covers, the export replaces that day's pulses so the
 * same messages are never counted twice. It produces: how much, how late, how
 * many threads at once, how many new projects. Nothing is sent anywhere and no
 * message text is stored, only counts and times.
 *
 * Each day is compared against the owner's own rolling baseline (median and
 * MAD, robust to the odd big day). A single busy day never counts. The alert
 * level only rises on PERSISTENCE: several recent days where late-night use
 * AND volume or breadth are both well outside her usual range. That is a
 * deliberately high bar; the design goal is that most weeks nothing happens.
 *
 * Plain node, no dependencies, so both the nightly refresh and the
 * SessionStart hook can import it.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const DEFAULTS = {
  enabled: false,         // opt-in: scripts/install-wellbeing.mjs turns it on
  dayStartHour: 5,        // 00:00-04:59 belongs to the previous day ("last night")
  nightStart: 0,          // night window, local hours, [nightStart, dayStartHour)
  baselineDays: 42,
  minBaselineDays: 14,    // active days needed before any level above "learning"
  excludeRecentDays: 3,   // keep the days being judged out of their own baseline
  sensitivity: "low",     // low | medium; low is the default and the intended setting
  cooldownDays: 4,        // after a check-in, no new one for this many days
  minNightMsgs: 8,        // absolute floor so 3 messages at 1am is never "night use"
  scanDays: 120,
};

const PROFILES = {
  low:    { z: 2.5, zExtreme: 3.5, need: 3, of: 4 },
  medium: { z: 2.0, zExtreme: 3.0, need: 2, of: 3 },
};

export function rhythmConfig(root) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; } };
  const g = read(path.join(os.homedir(), ".claude", "lkhs-capture-config.json"));
  const l = read(path.join(root, ".claude", "lkhs.config.json"));
  return { ...DEFAULTS, ...(g.rhythm || {}), ...(l.rhythm || {}) };
}

export const paths = (root) => {
  const dir = path.join(root, ".claude", "memory", "rhythm");
  return {
    dir,
    days: path.join(dir, "days.jsonl"),
    state: path.join(dir, "state.json"),
    notes: path.join(dir, "self-reports.jsonl"),
    checkins: path.join(dir, "checkins.jsonl"),
    pulses: path.join(dir, "desktop-pulses.jsonl"),
    exported: path.join(dir, "chat-export.jsonl"),
    report: path.join(root, "persona_clinical", "rhythm.md"),
    plan: path.join(root, "persona_clinical", "my-plan.md"),
  };
};

// ---- transcript reading ---------------------------------------------------

function transcriptFiles(sinceMs) {
  const base = path.join(os.homedir(), ".claude", "projects");
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    const p = path.join(base, d.name);
    let files = [];
    try { files = fs.readdirSync(p).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) {
      const fp = path.join(p, f);
      try { if (fs.statSync(fp).mtimeMs >= sinceMs) out.push(fp); } catch {}
    }
  }
  return out;
}

/** Text the person actually typed, or null for tool results, meta lines and injected context. */
function typedText(o) {
  if (o.type !== "user" || o.isSidechain || o.isMeta) return null;
  // headless runs (claude -p from miners, judges, scripts) are not her using Claude
  if (typeof o.entrypoint === "string" && o.entrypoint.startsWith("sdk")) return null;
  const c = o.message?.content;
  let t = null;
  if (typeof c === "string") t = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b?.type === "tool_result")) return null;
    t = c.filter((b) => b?.type === "text").map((b) => b.text).join("\n");
  }
  if (!t) return null;
  const s = t.trim();
  if (!s || s.startsWith("<command-") || s.startsWith("<local-command") || s.startsWith("Caveat:") ||
      s.startsWith("[Request interrupted") || s.includes("<system-reminder>") && s.length > 4000) return null;
  return s;
}

/** All typed messages since sinceMs, every source: { t: epochMs, words, session, cwd, src }. */
export function readMessages(sinceMs, root, dayStartHour = DEFAULTS.dayStartHour) {
  const msgs = readCodeMessages(sinceMs);
  if (root) {
    const P = paths(root);
    const exported = readJsonl(P.exported).filter((m) => m.t >= sinceMs);
    const covered = new Set(exported.map((m) => dayKey(m.t, dayStartHour)));
    const pulses = readJsonl(P.pulses).filter((m) => m.t >= sinceMs && !covered.has(dayKey(m.t, dayStartHour)));
    for (const m of [...exported, ...pulses]) msgs.push({ t: m.t, words: Math.min(500, m.words || 0), session: m.session, cwd: m.session, src: m.src });
  }
  return msgs.sort((a, b) => a.t - b.t);
}

/** claude.ai export (conversations.json) -> human message rows. Text is counted, never kept. */
export function exportRows(convs) {
  const rows = [];
  for (const c of convs || []) {
    for (const m of c.chat_messages || []) {
      if (m.sender !== "human") continue;
      const t = Date.parse(m.created_at);
      if (!Number.isFinite(t)) continue;
      const text = m.text || (m.content || []).filter((b) => b?.type === "text").map((b) => b.text).join(" ");
      rows.push({ t, words: Math.min(500, String(text).split(/\s+/).filter(Boolean).length), session: `chat:${c.uuid}`, src: "export" });
    }
  }
  return rows.sort((a, b) => a.t - b.t);
}

function readCodeMessages(sinceMs) {
  const msgs = [];
  for (const fp of transcriptFiles(sinceMs)) {
    let raw;
    try { raw = fs.readFileSync(fp, "utf8"); } catch { continue; }
    for (const line of raw.split("\n")) {
      if (!line || !line.includes('"type":"user"') || line.includes('"tool_result"')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const text = typedText(o);
      if (!text || !o.timestamp) continue;
      const t = Date.parse(o.timestamp);
      if (!Number.isFinite(t) || t < sinceMs) continue;
      // capped: a pasted document is not typing
      msgs.push({ t, words: Math.min(500, text.split(/\s+/).filter(Boolean).length), session: o.sessionId || fp, cwd: o.cwd || "", src: "code" });
    }
  }
  return msgs;
}

// ---- day features ---------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");
/** Local "rhythm day" key: a message at 02:30 belongs to the day before. */
export function dayKey(t, dayStartHour) {
  const d = new Date(t - dayStartHour * 3600_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Hours since local midnight of the rhythm day (so 02:30 the next morning = 26.5). */
function rhythmHour(t, dayStartHour) {
  const d = new Date(t);
  const h = d.getHours() + d.getMinutes() / 60;
  return h < dayStartHour ? h + 24 : h;
}

export function dayFeatures(msgs, cfg, knownCwdsBefore = new Set()) {
  const byDay = new Map();
  for (const m of msgs) {
    const k = dayKey(m.t, cfg.dayStartHour);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(m);
  }
  const seen = new Set(knownCwdsBefore);
  const rows = [];
  for (const k of [...byDay.keys()].sort()) {
    const ms = byDay.get(k);
    const buckets = new Set(ms.map((m) => Math.floor(m.t / 300_000)));
    const hours = ms.map((m) => rhythmHour(m.t, cfg.dayStartHour));
    const cwds = new Set(ms.map((m) => m.cwd).filter(Boolean));
    let newProjects = 0;
    for (const c of cwds) if (!seen.has(c)) { newProjects++; seen.add(c); }
    const words = ms.reduce((s, m) => s + m.words, 0);
    rows.push({
      day: k,
      msgs: ms.length,
      words,
      wordsPerMsg: +(words / ms.length).toFixed(1),
      activeMin: buckets.size * 5,
      sessions: new Set(ms.map((m) => m.session)).size,
      projects: cwds.size,
      newProjects,
      nightMsgs: hours.filter((h) => h >= 24 + cfg.nightStart).length,
      firstHour: +Math.min(...hours).toFixed(2),
      lastHour: +Math.max(...hours).toFixed(2),
    });
  }
  return rows;
}

/** Fill calendar gaps with zero rows so "a day off" is part of the baseline. */
export function withZeroDays(rows, fromKey, toKey) {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  const d = new Date(fromKey + "T12:00:00");
  const end = new Date(toKey + "T12:00:00");
  while (d <= end) {
    const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    out.push(map.get(k) || { day: k, msgs: 0, words: 0, wordsPerMsg: 0, activeMin: 0, sessions: 0, projects: 0, newProjects: 0, nightMsgs: 0, firstHour: null, lastHour: null });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// ---- baseline + scoring ---------------------------------------------------

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

// Per-feature floor on spread, so a person who is usually at zero does not
// produce z = 40 the first time she does anything.
const SPREAD_FLOOR = { activeMin: 30, msgs: 15, sessions: 1.5, projects: 1, nightMsgs: 4, lastHour: 1.5, words: 300 };
export const FEATURES = Object.keys(SPREAD_FLOOR);

export function baselineOf(rows) {
  const b = {};
  for (const f of FEATURES) {
    const xs = rows.map((r) => r[f]).filter((x) => x != null);
    const m = median(xs);
    const mad = median(xs.map((x) => Math.abs(x - m))) * 1.4826;
    b[f] = { median: +m.toFixed(2), spread: +Math.max(mad, SPREAD_FLOOR[f], 0.15 * Math.abs(m)).toFixed(2) };
  }
  return b;
}

export function zOf(row, base) {
  const z = {};
  for (const f of FEATURES) {
    const x = row[f];
    z[f] = x == null ? 0 : +((x - base[f].median) / base[f].spread).toFixed(2);
  }
  return z;
}

/**
 * A day is "elevated" only when two independent things are both well above her
 * own normal: sleep-window use (the strongest early sign in the literature) AND
 * volume or breadth. Or, without the night signal, volume and breadth both
 * extreme together. Returns reasons in plain words.
 */
export function judgeDay(row, z, cfg, base) {
  const P = PROFILES[cfg.sensitivity] || PROFILES.low;
  const night = (z.nightMsgs >= P.z && row.nightMsgs >= cfg.minNightMsgs) || (z.lastHour >= P.z && row.lastHour >= 25);
  const volume = z.activeMin >= P.z || z.msgs >= P.z;
  const breadth = z.sessions >= P.z || z.projects >= P.z || row.newProjects >= 3;
  const extremeNoNight = z.activeMin >= P.zExtreme && (z.sessions >= P.zExtreme || z.projects >= P.zExtreme);
  const elevated = (night && (volume || breadth)) || extremeNoNight;
  const reasons = [];
  if (night) reasons.push(`${row.nightMsgs} messages after midnight, last at ${fmtHour(row.lastHour)}`);
  if (volume) reasons.push(`${row.activeMin} active minutes (usual about ${base ? Math.round(base.activeMin.median) : "?"})`);
  if (breadth) reasons.push(`${row.sessions} sessions across ${row.projects} projects${row.newProjects ? `, ${row.newProjects} new` : ""}`);
  return { elevated, night, volume, breadth, score: +Math.max(z.nightMsgs, z.lastHour, 0) + Math.max(z.activeMin, z.msgs, 0) + Math.max(z.sessions, z.projects, 0), reasons };
}

export function fmtHour(h) {
  if (h == null) return "-";
  const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60);
  return `${pad(hh)}:${pad(mm === 60 ? 59 : mm)}`;
}

// ---- self-reports ---------------------------------------------------------

export function readJsonl(f) {
  try { return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

/** The self-report currently in force (state manic|hypomanic|mixed|low, not expired), or null. */
export function activeSelfReport(root, now = Date.now()) {
  const notes = readJsonl(paths(root).notes).filter((n) => n.state && n.state !== "note");
  const last = notes[notes.length - 1];
  if (!last || last.state === "ok") return null;
  if (last.until && Date.parse(last.until) < now) return null;
  return last;
}

/** Days covered by any elevated self-report, so episodes stay out of the baseline. */
export function selfReportedDays(root, dayStartHour) {
  const notes = readJsonl(paths(root).notes).filter((n) => n.state);
  const days = new Set();
  notes.forEach((n, i) => {
    if (!["manic", "hypomanic", "mixed"].includes(n.state)) return;
    const start = Date.parse(n.at);
    const nextAt = notes[i + 1] ? Date.parse(notes[i + 1].at) : Date.now();
    const end = Math.min(n.until ? Date.parse(n.until) : start + 7 * 86400_000, nextAt);
    for (let t = start; t <= end; t += 86400_000) days.add(dayKey(t, dayStartHour));
  });
  return days;
}
