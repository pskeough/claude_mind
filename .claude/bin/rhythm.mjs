#!/usr/bin/env node
/**
 * rhythm.mjs - CLI for the usage-rhythm layer. See docs/rhythm.md.
 *
 *   node .claude/bin/rhythm.mjs scan                 nightly: rebuild days, baseline, level, report
 *   node .claude/bin/rhythm.mjs status               plain summary (what Claude reads on request)
 *   node .claude/bin/rhythm.mjs live                 today so far vs baseline, JSON
 *   node .claude/bin/rhythm.mjs note --state manic [--until 5d] ["what she said"]
 *        states: manic | hypomanic | mixed | low | ok | note   (ok ends a report)
 *   node .claude/bin/rhythm.mjs ack [--outcome talked|declined|not-now]   a check-in happened
 *   node .claude/bin/rhythm.mjs pause 14d            no check-ins for a while (logging continues)
 *
 * Writes only under .claude/memory/rhythm/ and persona_clinical/rhythm.md.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  rhythmConfig, paths, readMessages, dayFeatures, withZeroDays, baselineOf, zOf, judgeDay,
  dayKey, fmtHour, readJsonl, activeSelfReport, selfReportedDays, FEATURES,
} from "./rhythm-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CFG = rhythmConfig(ROOT);
const P = paths(ROOT);
const [cmd = "status", ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
const DAY = 86400_000;

function parseDur(s) {
  const m = /^(\d+)\s*([dh])$/.exec(String(s || "").trim());
  return m ? +m[1] * (m[2] === "d" ? DAY : 3600_000) : null;
}
const append = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify(o) + "\n"); };
const readState = () => { try { return JSON.parse(fs.readFileSync(P.state, "utf8")); } catch { return null; } };

// ---------------------------------------------------------------- scan ----
function scan() {
  if (!CFG.enabled) { console.log("rhythm: disabled (rhythm.enabled false)"); return; }
  const now = Date.now();
  const since = now - CFG.scanDays * DAY;
  const msgs = readMessages(since);
  const today = dayKey(now, CFG.dayStartHour);
  const rows = withZeroDays(dayFeatures(msgs, CFG), dayKey(since, CFG.dayStartHour), today);
  // the current day is incomplete; judge completed days only
  const complete = rows.filter((r) => r.day < today);
  const episodeDays = selfReportedDays(ROOT, CFG.dayStartHour);

  const P_ = { low: [3, 4], medium: [2, 3] }[CFG.sensitivity] || [3, 4];
  const judged = complete.map((r, i) => {
    const pool = complete.slice(Math.max(0, i - CFG.excludeRecentDays - CFG.baselineDays), Math.max(0, i - CFG.excludeRecentDays))
      .filter((x) => !episodeDays.has(x.day));
    const activeDays = pool.filter((x) => x.msgs > 0).length;
    if (activeDays < CFG.minBaselineDays) return { ...r, learning: true };
    const base = baselineOf(pool);
    const z = zOf(r, base);
    const j = judgeDay(r, z, CFG, base);
    return { ...r, z, elevated: j.elevated, score: +j.score.toFixed(2), reasons: j.reasons };
  });

  fs.mkdirSync(P.dir, { recursive: true });
  fs.writeFileSync(P.days, judged.map((r) => JSON.stringify(r)).join("\n") + "\n");

  // current baseline, for the live check and the report
  const tail = complete.slice(-(CFG.baselineDays + CFG.excludeRecentDays), -CFG.excludeRecentDays || undefined)
    .filter((x) => !episodeDays.has(x.day));
  const learning = tail.filter((x) => x.msgs > 0).length < CFG.minBaselineDays;
  const baseline = learning ? null : baselineOf(tail);

  const window = judged.slice(-P_[1]);
  const elevatedDays = window.filter((r) => r.elevated);
  const lastTwo = judged.slice(-2);
  const extremeRun = lastTwo.length === 2 && lastTwo.every((r) => r.elevated && r.score >= 9);
  let level = "quiet";
  if (learning) level = "learning";
  else if (elevatedDays.length >= P_[0] || extremeRun) level = "elevated";
  else if (elevatedDays.length >= 1) level = "watch";

  const prev = readState() || {};
  const state = {
    updated: new Date(now).toISOString(),
    level,
    since: level === prev.level ? prev.since || today : today,
    sensitivity: CFG.sensitivity,
    window: window.map((r) => ({ day: r.day, elevated: !!r.elevated, score: r.score ?? null, reasons: r.reasons || [] })),
    baseline,
    activeBaselineDays: tail.filter((x) => x.msgs > 0).length,
    pausedUntil: prev.pausedUntil || null,
    lastCheckin: prev.lastCheckin || null,
  };
  fs.writeFileSync(P.state, JSON.stringify(state, null, 2));
  writeReport(judged, state);
  console.log(`rhythm: ${judged.length} days, level ${level}${learning ? ` (baseline ${state.activeBaselineDays}/${CFG.minBaselineDays} active days)` : ""}`);
}

// ------------------------------------------------------------- report ----
function writeReport(judged, state) {
  const last = judged.slice(-28);
  const notes = readJsonl(P.notes).slice(-12);
  const checkins = readJsonl(P.checkins).slice(-8);
  const b = state.baseline;
  const L = [];
  L.push("---", "title: Usage rhythm", "domain: wellbeing", `updated: ${state.updated.slice(0, 10)}`,
    "provenance: generated nightly by .claude/bin/rhythm.mjs from Claude Code session timestamps; counts only, no message text", "---", "");
  L.push("# Usage rhythm", "");
  L.push(`Current read: **${state.level}** since ${state.since}. Sensitivity: ${state.sensitivity}.`, "");
  L.push("This file is a record, not a diagnosis. It measures one thing, how and when Claude Code is used, against this person's own usual pattern. Late-night use and a jump in volume or parallel projects together are the combination worth noticing; any one of them alone is ordinary.", "");
  if (b) {
    L.push("## Usual pattern (rolling baseline)", "", "| Measure | Typical day | Normal spread |", "|---|---|---|");
    const label = { activeMin: "active minutes", msgs: "messages typed", sessions: "sessions", projects: "projects touched", nightMsgs: "messages after midnight", lastHour: "last active", words: "words typed" };
    for (const f of FEATURES) L.push(`| ${label[f]} | ${f === "lastHour" ? fmtHour(b[f].median) : b[f].median} | ${f === "lastHour" ? `${b[f].spread} h` : `±${b[f].spread}`} |`);
    L.push("");
  } else {
    L.push(`Still learning the usual pattern: ${state.activeBaselineDays} of ${CFG.minBaselineDays} active days collected. Nothing is flagged until then.`, "");
  }
  L.push("## Last four weeks", "", "| Day | Active min | Msgs | Sessions | Projects | After midnight | Last active | Flag |", "|---|---|---|---|---|---|---|---|");
  for (const r of last) L.push(`| ${r.day} | ${r.activeMin} | ${r.msgs} | ${r.sessions} | ${r.projects}${r.newProjects ? ` (+${r.newProjects} new)` : ""} | ${r.nightMsgs} | ${fmtHour(r.lastHour)} | ${r.learning ? "learning" : r.elevated ? "elevated" : ""} |`);
  L.push("");
  if (notes.length) {
    L.push("## Self-reports", "");
    for (const n of notes) L.push(`- ${n.at.slice(0, 16).replace("T", " ")}: ${n.state}${n.until ? ` (until ${n.until.slice(0, 10)})` : ""}${n.text ? `. "${n.text}"` : ""}`);
    L.push("");
  }
  if (checkins.length) {
    L.push("## Check-ins", "");
    for (const c of checkins) L.push(`- ${c.at.slice(0, 16).replace("T", " ")}: ${c.outcome || "done"}${c.level ? ` (level ${c.level})` : ""}`);
    L.push("");
  }
  fs.mkdirSync(path.dirname(P.report), { recursive: true });
  fs.writeFileSync(P.report, L.join("\n"));
}

// --------------------------------------------------------------- live ----
function live() {
  const now = Date.now();
  const today = dayKey(now, CFG.dayStartHour);
  const msgs = readMessages(now - 30 * 3600_000).filter((m) => dayKey(m.t, CFG.dayStartHour) === today);
  const row = dayFeatures(msgs, CFG)[0] || { day: today, msgs: 0, activeMin: 0, sessions: 0, projects: 0, nightMsgs: 0, lastHour: null, words: 0 };
  const st = readState();
  const out = { today: row, localTime: fmtHour(new Date().getHours() + new Date().getMinutes() / 60) };
  if (st?.baseline) {
    const b = st.baseline;
    out.vsUsual = {
      activeMin: `${row.activeMin} vs usual ${Math.round(b.activeMin.median)}`,
      sessions: `${row.sessions} vs usual ${b.sessions.median}`,
      projects: `${row.projects} vs usual ${b.projects.median}`,
      usualLastActive: fmtHour(b.lastHour.median),
    };
  }
  return out;
}

// ------------------------------------------------------------ dispatch ----
if (cmd === "scan") scan();
else if (cmd === "live") console.log(JSON.stringify(live(), null, 2));
else if (cmd === "note") {
  const state = flag("state") || "note";
  if (!["manic", "hypomanic", "mixed", "low", "ok", "note"].includes(state)) { console.error("state must be manic|hypomanic|mixed|low|ok|note"); process.exit(1); }
  const dur = parseDur(flag("until")) ?? (["manic", "hypomanic", "mixed"].includes(state) ? 5 * DAY : null);
  const rec = { at: new Date().toISOString(), state, text: positional.join(" ").slice(0, 500) || undefined };
  if (dur && state !== "ok" && state !== "note") rec.until = new Date(Date.now() + dur).toISOString();
  append(P.notes, rec);
  console.log(`noted: ${state}${rec.until ? ` until ${rec.until.slice(0, 10)}` : ""}`);
} else if (cmd === "ack") {
  const st = readState() || {};
  const rec = { at: new Date().toISOString(), outcome: flag("outcome") || "talked", level: st.level };
  append(P.checkins, rec);
  st.lastCheckin = rec.at;
  fs.mkdirSync(P.dir, { recursive: true });
  fs.writeFileSync(P.state, JSON.stringify(st, null, 2));
  console.log(`check-in recorded (${rec.outcome}); next one no sooner than ${CFG.cooldownDays} days`);
} else if (cmd === "pause") {
  const dur = parseDur(positional[0]) ?? 14 * DAY;
  const st = readState() || {};
  st.pausedUntil = new Date(Date.now() + dur).toISOString();
  fs.mkdirSync(P.dir, { recursive: true });
  fs.writeFileSync(P.state, JSON.stringify(st, null, 2));
  console.log(`check-ins paused until ${st.pausedUntil.slice(0, 10)}; logging continues`);
} else {
  const st = readState();
  const sr = activeSelfReport(ROOT);
  if (!st) { console.log("rhythm: no scan yet. Run: node .claude/bin/rhythm.mjs scan"); process.exit(0); }
  console.log(`level: ${st.level} since ${st.since} (sensitivity ${st.sensitivity})`);
  if (sr) console.log(`self-report in force: ${sr.state}${sr.until ? ` until ${sr.until.slice(0, 10)}` : ""}`);
  for (const w of st.window || []) console.log(`  ${w.day} ${w.elevated ? "ELEVATED " + w.reasons.join("; ") : "-"}`);
  console.log(`report: ${path.relative(ROOT, P.report)}`);
}
