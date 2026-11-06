/**
 * rhythm-hook.mjs - the only place the wellbeing layer ever speaks.
 *
 * Imported by the global SessionStart hook (lkhs-project-card.mjs), so it runs
 * in every project, not just the vault. Returns "" (silence) unless:
 *   (a) she has told Claude she is in an episode -> pacing mode for the period
 *       she chose, every session, short; or
 *   (b) the nightly scan reads "elevated", no check-in inside the cooldown,
 *       check-ins not paused, and no session has offered one today -> one
 *       check-in, once.
 */
import fs from "node:fs";
import path from "node:path";
import {
  rhythmConfig, paths, activeSelfReport, dayKey, readMessages, dayFeatures, fmtHour,
} from "./rhythm-core.mjs";

/** opts.via: "cli" (Claude Code hook, default) or "mcp" (Claude Desktop, via the mind-wellbeing tools). opts.claim=false peeks without using up today's one check-in. */
export function rhythmBlock(vault, opts = {}) {
  const mcp = opts.via === "mcp";
  const cfg = rhythmConfig(vault);
  if (!cfg.enabled) return "";
  const P = paths(vault);
  const cli = `node "${path.join(vault, ".claude", "bin", "rhythm.mjs")}"`;
  const okCmd = mcp ? "call wellbeing_note with state ok" : `${cli} note --state ok`;
  const ackCmd = mcp ? "call wellbeing_checkin_done with outcome talked, declined or not-now" : `${cli} ack --outcome talked|declined|not-now`;
  const stance = mcp ? "Follow the mind-wellbeing guidance (server instructions)." : "Use the mind-companion skill for stance.";
  let st = null;
  try { st = JSON.parse(fs.readFileSync(P.state, "utf8")); } catch {}
  const sr = activeSelfReport(vault);
  const now = Date.now();
  const today = dayKey(now, cfg.dayStartHour);

  const liveLine = () => {
    const msgs = readMessages(now - 30 * 3600_000, vault, cfg.dayStartHour).filter((m) => dayKey(m.t, cfg.dayStartHour) === today);
    const r = dayFeatures(msgs, cfg)[0];
    const d = new Date();
    const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (!r) return `Local time ${clock}. First activity of the day.`;
    const b = st?.baseline;
    const u = (f) => (b ? ` (usual ${Math.round(b[f].median)})` : "");
    return `Local time ${clock}. Today so far: ${r.activeMin} active minutes${u("activeMin")}, ${r.sessions} chats/sessions${u("sessions")}${r.newProjects ? `, ${r.newProjects} new` : ""}${r.nightMsgs ? `, ${r.nightMsgs} messages after midnight` : ""}.${b ? ` Usually done by ${fmtHour(b.lastHour.median)}.` : ""}`;
  };
  const planNote = fs.existsSync(P.plan) ? (mcp ? " She has a plan written while well: read it with wellbeing_status before raising anything, and use her words and signs." : ` Her own plan, written while well: ${P.plan} (read it before raising anything; use her words and signs).`) : "";

  if (sr) {
    return `=== WELLBEING: PACING MODE (she turned this on) ===
On ${sr.at.slice(0, 10)} she told Claude she was ${sr.state}${sr.text ? ` ("${sr.text}")` : ""}. Pacing mode runs until ${sr.until ? sr.until.slice(0, 10) : "she says she is ok"}.
${liveLine()}${planNote}
Do the work she asks for; this mode never blocks anything. ${stance} Notice pace, hour and new threads and name them briefly only when relevant (a new big project at 2am, a third parallel build, a large purchase, a public post or a message she might regret). Offer to park new ideas in a list instead of starting them, and to hold big money, relationship or public decisions for 48 hours. Do not amplify grand plans or flatter their scale. Say any one thing once per session. When she says she is fine: ${okCmd}`;
  }

  if (!st || st.level !== "elevated") return "";
  if (st.pausedUntil && Date.parse(st.pausedUntil) > now) return "";
  if (st.lastCheckin && now - Date.parse(st.lastCheckin) < cfg.cooldownDays * 86400_000) return "";
  const marker = path.join(P.dir, `offered-${today}`);
  if (fs.existsSync(marker)) return "";
  if (opts.claim !== false) try {
    for (const f of fs.readdirSync(P.dir)) if (f.startsWith("offered-")) fs.unlinkSync(path.join(P.dir, f));
    fs.writeFileSync(marker, new Date(now).toISOString());
  } catch { return ""; }

  const days = (st.window || []).filter((w) => w.elevated).map((w) => `${w.day}: ${w.reasons.join("; ")}`).join("\n");
  return `=== WELLBEING: ONE CHECK-IN OFFERED (usage rhythm "elevated" since ${st.since}) ===
Her Claude use over the last few days is well outside her own usual pattern on more than one measure at once:
${days}
${liveLine()}${planNote}
She set this up so Claude would raise it, gently, once. ${stance} Help with what she came for first. At a natural pause, say what you see in one or two plain sentences, as an observation about usage rather than a judgement about her, and ask how she is sleeping and feeling. If she does not want to talk about it, drop it completely. Then record the outcome: ${ackCmd}. No other session will raise this today.`;
}
